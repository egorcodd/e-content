import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, finish, configuration } from './fixtures.ts';
import { LocalStore } from '../store.ts';

test('local API enforces origin, CSRF, JSON and dynamic code validation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/telegram/configure', 'POST', {})).status, 403);
    assert.equal(
      (await f.request('/connections', 'GET', undefined, { origin: 'https://other.example' }))
        .status,
      403,
    );
    assert.equal((await f.request('/connections')).data.available[0], 'telegram');
    assert.equal(
      (await f.request('/telegram/configure', 'POST', {}, { 'x-csrf-token': 'é'.repeat(43) }))
        .status,
      403,
    );
    assert.equal(
      (await f.request('/telegram/configure', 'POST', { apiId: -1, apiHash: 'bad' })).status,
      400,
    );
    assert.equal(
      (await f.request('/telegram/configure', 'POST', { apiId: 123456, apiHash: 'a'.repeat(32) }))
        .data.phase,
      'phone',
    );
    assert.equal((await f.request('/telegram/code', 'POST', { phone: '123' })).status, 400);
    const sent = await f.request('/telegram/code', 'POST', { phone: '+79000000000' });
    assert.equal(sent.data.codeLength, 5);
    assert.equal((await f.request('/telegram/auth')).data.phase, 'code');
    assert.equal(f.gateway.calls.filter((call) => call === 'sendCode').length, 1);
    assert.equal(
      (await f.request('/telegram/confirm', 'POST', { code: '123456' })).data.error.code,
      'CODE_INVALID',
    );
    assert.equal(
      (await f.request('/telegram/confirm', 'POST', { code: '99999' })).data.error.code,
      'PHONE_CODE_INVALID',
    );
    assert.equal(
      (await f.request('/telegram/confirm', 'POST', { code: '12345' })).data.phase,
      'connected',
    );
    const accounts = (await f.request('/connections')).data;
    assert.equal(accounts.accounts[0].id, 'telegram:7');
    assert.ok(!JSON.stringify(accounts).includes('fixture-secret-session'));
    const rows = f.app.store.db.prepare('SELECT value FROM vault').all();
    assert.ok(!JSON.stringify(rows).includes('fixture-secret-session'));
    assert.ok(!JSON.stringify(rows).includes('a'.repeat(32)));
  } finally {
    await f.close();
  }
});

test('two-factor auth and confirmed revocation preserve data on failure', async () => {
  const f = await fixture();
  try {
    f.gateway.twoFA = true;
    const login = await f.login();
    assert.equal(login.data.phase, 'password');
    assert.equal(
      (await f.request('/telegram/password', 'POST', { password: 'wrong' })).data.error.code,
      'PASSWORD_HASH_INVALID',
    );
    assert.equal(
      (await f.request('/telegram/password', 'POST', { password: 'fixture-password' })).data.phase,
      'connected',
    );
    f.gateway.revokeFailure = true;
    assert.equal((await f.request('/connections/accounts/telegram%3A7', 'DELETE')).status, 400);
    assert.equal(f.app.account.accounts()[0].status, 'connected');
    f.gateway.revokeFailure = false;
    assert.equal((await f.request('/connections/accounts/telegram%3A7', 'DELETE')).status, 204);
    assert.deepEqual(f.app.account.accounts(), []);
    assert.equal(f.app.store.secret('telegram-session'), null);
  } finally {
    await f.close();
  }
});

test('actual worker pages services and short pages, deduplicates threads and is idempotent', async () => {
  const f = await fixture();
  try {
    await f.login();
    const id = 'fixture-full-cycle';
    const config = configuration();
    const started = await f.request('/collection/runs', 'POST', {
      id,
      mode: 'cycle',
      configuration: config,
    });
    assert.equal(started.status, 202);
    const result = await finish(f.app, id);
    assert.equal(result.status, 'completed');
    assert.equal(result.counts.posts, 2);
    assert.equal(result.counts.comments, 3);
    assert.equal(result.counts.ideas, 1);
    assert.ok(result.done.includes('orchestrator'));
    assert.ok(!result.done.includes('tiktok'));
    const records = f.app.store.records(id);
    assert.equal(
      records.find((item) => item.platform === 'telegram' && item.messageId === 906)?.parentId,
      'telegram:channel:999:907',
    );
    assert.ok(
      result.ideas[0].evidence.every((item) =>
        item.url?.startsWith('https://t.me/fixture_channel/'),
      ),
    );
    const calls = f.gateway.calls.length;
    await f.request('/collection/runs', 'POST', { id, mode: 'cycle', configuration: config });
    assert.equal(f.gateway.calls.length, calls);
    await f.request('/collection/runs', 'POST', {
      id: 'fixture-local-ideas',
      mode: 'ideas',
      configuration: config,
    });
    const local = await finish(f.app, 'fixture-local-ideas');
    assert.equal(local.counts.requests, 0);
    assert.equal(local.counts.ideas, 1);
    assert.equal(f.gateway.calls.length, calls);
    const exported = await f.request(`/collection/runs/${id}/export.md`);
    assert.ok(exported.data.includes('Как проверить стабильность'));
    assert.ok(exported.data.includes('?comment=906'));
    assert.equal(
      (await f.request(`/collection/runs/${id}/records?offset=1&limit=2`)).data.items.length,
      2,
    );
  } finally {
    await f.close();
  }
});

test('configured source/global limits and reply filtering apply to fetched records', async () => {
  const f = await fixture();
  try {
    await f.login();
    const config = configuration();
    config.runLimits.maxComments = 2;
    config.platforms.telegram.threads = false;
    const id = 'fixture-reply-limits';
    await f.app.engine.start(id, 'cycle', config);
    const result = await finish(f.app, id);
    assert.equal(result.counts.comments, 1);
    assert.equal(f.app.store.records(id).filter((item) => item.kind === 'comment').length, 1);
    assert.ok(f.gateway.calls.includes('comments:0:2'));
    assert.ok(!f.gateway.calls.some((call) => call.startsWith('comments:906')));
    const config2 = configuration();
    config2.runLimits.maxRequests = 2;
    await f.app.engine.start('fixture-request-limit', 'cycle', config2);
    const limited = await finish(f.app, 'fixture-request-limit');
    assert.equal(limited.counts.requests, 2);
    assert.equal(limited.status, 'failed');
    assert.match(limited.error!, /предел.*запросов/);
  } finally {
    await f.close();
  }
});

test('cancel, active conflict, flood wait and server restart keep collected snapshots', async () => {
  const f = await fixture();
  try {
    await f.login();
    f.gateway.delay = 25;
    const config = configuration();
    const id = 'fixture-cancelled';
    await f.app.engine.start(id, 'cycle', config);
    await assert.rejects(
      f.app.engine.start('fixture-conflict', 'cycle', config),
      /уже выполняется/,
    );
    for (let i = 0; i < 50 && !f.app.store.run(id)?.counts.posts; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    f.app.engine.cancel(id);
    const cancelled = await finish(f.app, id);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.counts.posts > 0);
    const snapshot = f.app.store.records(id);
    assert.ok(snapshot.length > 0);
    f.gateway.delay = 0;
    f.gateway.flood = true;
    await f.app.engine.start('fixture-flood-wait', 'cycle', config);
    const flood = await finish(f.app, 'fixture-flood-wait');
    assert.equal(flood.status, 'failed');
    assert.ok(flood.retryAt);
    await f.app.engine.start('fixture-flood-retry', 'cycle', config);
    const retry = await finish(f.app, 'fixture-flood-retry');
    assert.equal(retry.counts.requests, 0);
    assert.ok(retry.retryAt);
    const interrupted = { ...cancelled, id: 'fixture-interrupted', status: 'running' as const };
    f.app.store.saveRun(interrupted);
    await f.app.close();
    const reopened = new LocalStore(f.directory);
    try {
      assert.equal(reopened.run(interrupted.id)?.status, 'interrupted');
      assert.deepEqual(reopened.records(id), snapshot);
      assert.ok(reopened.secret('telegram-session'));
    } finally {
      reopened.close();
    }
    const file = await readFile(join(f.directory, 'content.sqlite'));
    assert.ok(!file.includes(Buffer.from('fixture-secret-session')));
  } finally {
    if (f.app.server.listening) await f.close();
    else {
      const { rm } = await import('node:fs/promises');
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});
