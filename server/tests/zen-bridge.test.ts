import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, configuration } from './fixtures.ts';
import { rawVideo, rawComment } from './tiktok-fixtures.ts';

const origin = 'moz-extension://11111111-2222-3333-4444-555555555555';
const identity = {
  user_id_str: '9000000000000000001',
  username: 'fixture_user',
  screen_name: 'Zen Creator',
};
const videos = Array.from({ length: 25 }, (_, i) => ({
  ...rawVideo,
  id: String(BigInt(rawVideo.id) + BigInt(i)),
  author: { uniqueId: 'fixture_user' },
  createTime: Math.floor(Date.now() / 1000) - 60 - i * 60,
  stats: { commentCount: 1 },
}));

test('Zen bridge pairs explicitly, collects own 10/20 videos into the workshop and revokes stale tokens', async () => {
  const f = await fixture();
  let token = '';
  const ext = async (path: string, body?: unknown, claimed = origin) => {
    const response = await fetch(f.base + '/api/zen-bridge/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: claimed,
        'X-EContent-Extension': claimed,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const event = (id: string, type: string, data?: unknown) => ext('event', { id, type, data });
  const next = async () => {
    for (let i = 0; i < 100; i++) {
      const result = await ext('poll');
      if (result.data.task) return result.data.task;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('No Zen task');
  };
  try {
    await f.request('/connections');
    assert.equal((await ext('poll')).status, 403);
    const setup = await f.request('/tiktok/connect', 'POST', {});
    assert.equal(setup.data.transport, 'zen');
    assert.equal(
      (await ext('pair', { code: setup.data.extension.pairing.code }, 'https://evil.example'))
        .status,
      403,
    );
    const paired = await ext('pair', { code: setup.data.extension.pairing.code });
    assert.equal(paired.status, 200);
    token = paired.data.token;
    assert.equal((await ext('pair', { code: setup.data.extension.pairing.code })).status, 403);
    assert.equal(
      (await ext('poll', undefined, origin.replace('11111111', '99999999'))).status,
      403,
    );
    const probe = await next();
    assert.equal(probe.kind, 'probe');
    assert.equal((await event(probe.id, 'identity', identity)).status, 200);
    const pinned = { ...videos[0], id: String(BigInt(rawVideo.id) + 1000n), createTime: 1 };
    await event(probe.id, 'profile', { items: [pinned, ...videos], complete: true });
    await event(probe.id, 'done');
    for (let i = 0; i < 30 && f.app.tiktok.state().phase !== 'connected'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(f.app.tiktok.state().account?.handle, 'fixture_user');
    assert.equal(f.app.tiktok.state().videos.length, 20);
    assert.ok(!f.app.tiktok.state().videos.some((v) => v.id === pinned.id));
    assert.equal((await event(probe.id, 'identity', identity)).status, 409);
    for (const count of [10, 20] as const) {
      await f.request('/tiktok/selection', 'POST', { latest: count, enabled: true });
      const config = configuration();
      config.sources = [];
      config.settings.maxComments = 100;
      config.runLimits.maxRequests = 500;
      const id = 'zen-workshop-selection-' + count;
      assert.equal(
        (await f.request('/collection/runs', 'POST', { id, mode: 'tiktok', configuration: config }))
          .status,
        202,
      );
      const task = await next();
      assert.equal(task.maxVideos, count);
      await event(task.id, 'identity', identity);
      await event(task.id, 'profile', { items: videos.slice(0, count), complete: true });
      for (const video of videos.slice(0, count)) {
        assert.equal((await event(task.id, 'permit')).data.allowed, true);
        assert.equal((await event(task.id, 'video', video)).status, 200);
        const comment = {
          ...rawComment(String(BigInt(video.id) + 2000n)),
          aweme_id: video.id,
          create_time: video.createTime,
        };
        await event(task.id, 'comments', {
          videoId: video.id,
          page: { status_code: 0, comments: [comment], has_more: false, cursor: '0' },
        });
        await event(task.id, 'comments', {
          videoId: video.id,
          page: { status_code: 0, comments: [comment], has_more: false, cursor: '0' },
        });
      }
      await event(task.id, 'progress', { status: 'completed' });
      await event(task.id, 'done');
      for (let i = 0; i < 200 && f.app.store.run(id)?.status === 'running'; i++)
        await new Promise((r) => setTimeout(r, 10));
      const run = f.app.store.run(id)!;
      assert.equal(run.status, 'completed', run.error);
      assert.equal(run.counts.posts, count);
      assert.equal(run.counts.comments, count);
      assert.equal(run.counts.requests, count);
      assert.ok(run.counts.ideas > 0);
      assert.match((await f.request('/collection/runs/' + id + '/export.md')).data, /TikTok/);
    }
    const failedId = 'zen-comments-unavailable-run';
    const failedConfig = configuration();
    failedConfig.sources = [];
    await f.request('/collection/runs', 'POST', {
      id: failedId,
      mode: 'tiktok',
      configuration: failedConfig,
    });
    const failedTask = await next();
    await event(failedTask.id, 'identity', identity);
    await event(failedTask.id, 'profile', { items: videos.slice(0, 20), complete: true });
    await event(failedTask.id, 'video', videos[0]);
    await event(failedTask.id, 'error', {
      code: 'ZEN_READ',
      message: 'TikTok не выдал комментарии этого ролика.',
    });
    for (let i = 0; i < 100 && f.app.store.run(failedId)?.status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(f.app.store.run(failedId)?.status, 'partial');
    assert.equal(f.app.store.run(failedId)?.counts.posts, 1);
    assert.equal(
      f.app.tiktok.state().phase,
      'connected',
      'A comment-fetch failure must not revoke a verified account',
    );
    const rows = f.app.store.records('zen-workshop-selection-20').length;
    await f.request('/tiktok/disconnect', 'POST', {});
    assert.equal((await ext('poll')).status, 403);
    assert.equal(f.app.store.records('zen-workshop-selection-20').length, rows);
    const archive = await f.request('/zen/extension.zip');
    assert.equal(archive.status, 200);
    assert.equal(archive.response.headers.get('content-type'), 'application/zip');
  } finally {
    await f.close();
  }
});

test('Zen cancellation rejects stale events and disallows website origins', async () => {
  const f = await fixture();
  try {
    const bridge = f.app.zen;
    const pairing = bridge.startPairing().pairing!;
    const { token } = bridge.pair(pairing.code, origin);
    bridge.authorize('Bearer ' + token, origin);
    const control = new AbortController();
    const task = bridge.run(
      { kind: 'probe', maxVideos: 20, maxComments: 0, comments: false, replies: false },
      () => {},
      undefined,
      control.signal,
    );
    const id = bridge.poll().task!.id;
    control.abort(new Error('cancelled'));
    await assert.rejects(task, /cancelled/);
    await assert.rejects(bridge.message({ id, type: 'done' }), /завершена/);
    assert.equal(bridge.poll().activeId, null);
    const request = await fetch(f.base + '/api/zen-bridge/poll', {
      headers: {
        Origin: 'https://evil.example',
        'X-EContent-Extension': origin,
        Authorization: 'Bearer ' + token,
      },
    });
    assert.equal(request.status, 403);
  } finally {
    await f.close();
  }
});
test('a missing TikTok page receiver has an actionable Russian message', async () => {
  const f = await fixture();
  try {
    const pairing = f.app.zen.startPairing().pairing!;
    const { token } = f.app.zen.pair(pairing.code, origin);
    f.app.zen.authorize('Bearer ' + token, origin);
    await f.app.tiktok.connect('owner');
    const task = f.app.zen.poll().task!;
    await f.app.zen.message({
      id: task.id,
      type: 'error',
      data: {
        code: 'ZEN_READ',
        message: 'Could not establish connection. Receiving end does not exist.',
      },
    });
    for (let i = 0; i < 20 && f.app.tiktok.state().phase === 'checking'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.match(f.app.tiktok.state().message ?? '', /Обновите расширение/);
    assert.doesNotMatch(f.app.tiktok.state().message ?? '', /Receiving end/);
    assert.equal(f.app.tiktok.state().phase, 'unavailable');
    assert.equal(f.app.zen.paired, true);
  } finally {
    await f.close();
  }
});
