import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../store.ts';
import { TikTokAccount } from '../tiktok/account.ts';
import { accountBrowserFixture } from './tiktok-account-fixture.ts';
import { fixture, configuration, finish } from './fixtures.ts';

async function connected(account: Pick<TikTokAccount, 'state' | 'busy'>) {
  for (let i = 0; i < 450; i++) {
    if (account.state().phase === 'connected' && !account.busy) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(
    'Account not connected: ' +
      JSON.stringify({
        phase: account.state().phase,
        busy: account.busy,
        message: account.state().message,
      }),
  );
}
test('a rejected Google sign-in explains how to continue without losing the TikTok login window', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-tt-google-')),
    browser = accountBrowserFixture();
  const store = new LocalStore(directory),
    account = new TikTokAccount(store, browser.factory);
  try {
    await account.connect('owner');
    const context = browser.contexts.at(-1)!;
    assert.equal(context.pages()[0].url(), 'https://www.tiktok.com/login/qrcode');
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Could not sign you in</h1>' }),
    );
    const popup = await context.newPage();
    await popup.goto('https://accounts.google.com/v3/signin/rejected?reason=test');
    for (let i = 0; i < 40 && !account.state().message?.includes('Google'); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.match(account.state().message ?? '', /Google/);
    assert.match(account.state().message ?? '', /QR/);
    assert.equal(account.state().phase, 'waiting_login');
    assert.equal(account.state().windowOpen, true);
    assert.equal(account.accounts().length, 0);
    assert.equal(context.pages()[0].url(), 'https://www.tiktok.com/login/qrcode');
    await account.connect('owner');
    assert.equal(popup.isClosed(), true);
    assert.equal(context.pages()[0].url(), 'https://www.tiktok.com/login/qrcode');
    assert.equal(account.state().message, undefined);
    await browser.signIn();
    await connected(account);
    assert.equal(account.state().account?.handle, 'fixture_user');
  } finally {
    await account.close();
    store.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('the production TikTok browser launches with Chromium sandbox enabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-tt-sandbox-'));
  const store = new LocalStore(directory);
  store.setSecret('tiktok-account-v1', {
    phase: 'connected',
    account: { id: '9000000000000000001', handle: 'fixture_user', displayName: 'Fixture' },
    selection: { latest: 20, enabled: true },
    videos: [],
    coverage: 'unknown',
  });
  const account = new TikTokAccount(store);
  try {
    const context = await account.acquire(account.source()!);
    assert.equal(context.pages()[0].url(), 'about:blank');
    await context.pages()[0].goto('chrome://version');
    const command = await context.pages()[0].locator('#command_line').innerText();
    assert.ok(!command.includes('--no-sandbox'));
    assert.ok(!command.includes('--disable-setuid-sandbox'));
  } finally {
    await account.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('account login verifies identity, discovers newest videos and survives a server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-tt-account-')),
    browser = accountBrowserFixture();
  let store = new LocalStore(directory),
    account = new TikTokAccount(store, browser.factory);
  try {
    await account.connect('owner');
    assert.equal(account.state().phase, 'waiting_login');
    assert.equal(
      account.accounts().length,
      0,
      'Cookies or an open window are not a verified account',
    );
    await browser.signIn();
    await connected(account);
    assert.equal(account.state().account?.handle, 'fixture_user');
    assert.equal(account.state().videos.length, 20);
    assert.equal(account.state().videos[0].id, browser.videos[0].id);
    assert.ok(!account.state().videos.some((video) => video.id === browser.pinned.id));
    account.select({ latest: 10, enabled: true });
    await account.close();
    store.close();
    store = new LocalStore(directory);
    account = new TikTokAccount(store, browser.factory);
    assert.equal(account.state().selection.latest, 10);
    await account.refresh();
    assert.equal(account.state().phase, 'connected');
    assert.equal(
      new Set(browser.directories).size,
      1,
      'The same persistent profile must be reused',
    );
    browser.expire = true;
    await assert.rejects(account.refresh(), /Сессия TikTok завершилась/);
    assert.equal(account.state().phase, 'expired');
    assert.equal(
      account.state().videos.length,
      20,
      'Expired authorization preserves collected metadata',
    );
  } finally {
    await account.close();
    store.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('API adds own profile without links, applies server selection and keeps source identity authoritative', async () => {
  const browser = accountBrowserFixture(),
    f = await fixture({ tiktokContextFactory: browser.factory });
  try {
    await f.request('/connections');
    assert.equal((await f.request('/tiktok/connect', 'POST', {})).status, 200);
    await browser.signIn();
    await connected(f.app.tiktok);
    const connection = (await f.request('/connections')).data;
    assert.equal(connection.managedSources.length, 1);
    assert.equal(connection.accounts[0].handle, '@fixture_user');
    assert.equal(
      (await f.request('/tiktok/selection', 'POST', { latest: 7, enabled: true })).status,
      400,
    );
    await f.request('/tiktok/selection', 'POST', { latest: 10, enabled: true });
    const config = configuration();
    config.sources = [];
    const response = await f.request('/collection/runs', 'POST', {
      id: 'tiktok-profile-auto-ten',
      mode: 'tiktok',
      configuration: config,
    });
    assert.equal(response.status, 202);
    let run;
    for (let i = 0; i < 600; i++) {
      run = f.app.store.run('tiktok-profile-auto-ten');
      if (run?.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(run?.status, 'completed', run?.error);
    assert.equal(run?.counts.posts, 10);
    assert.equal(run?.counts.comments, 10);
    assert.equal(
      f.app.store.records(run!.id).filter((record) => record.kind === 'post').length,
      10,
    );
    assert.deepEqual(f.gateway.calls, []);
    await f.request('/tiktok/selection', 'POST', { latest: 20, enabled: true });
    config.settings.maxComments = 100;
    await f.request('/collection/runs', 'POST', {
      id: 'tiktok-profile-auto-twenty',
      mode: 'tiktok',
      configuration: config,
    });
    for (let i = 0; i < 600; i++) {
      const twenty = f.app.store.run('tiktok-profile-auto-twenty');
      if (twenty?.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const twenty = f.app.store.run('tiktok-profile-auto-twenty')!;
    assert.equal(twenty.status, 'completed', twenty.error);
    assert.equal(twenty.counts.posts, 20);
    assert.equal(twenty.counts.comments, 20);
    assert.ok(
      !f.app.store
        .records(twenty.id)
        .some((record) => record.platform === 'tiktok' && record.videoId === browser.pinned.id),
    );
    await f.request('/tiktok/selection', 'POST', { latest: 20, enabled: false });
    assert.equal((await f.request('/connections')).data.managedSources[0].enabled, false);
    const records = f.app.store.records(run!.id).length;
    await f.request('/tiktok/disconnect', 'POST', {});
    assert.equal((await f.request('/connections')).data.accounts.length, 0);
    assert.equal(f.app.store.records(run!.id).length, records);
  } finally {
    await f.close();
    await browser.close();
  }
});
test('manual verification is not reloaded while the user is completing it and resumes automatically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-tt-verification-')),
    browser = accountBrowserFixture();
  const store = new LocalStore(directory),
    account = new TikTokAccount(store, browser.factory);
  try {
    await account.connect('owner');
    browser.block = true;
    await browser.signIn();
    for (let i = 0; i < 100 && account.state().phase !== 'verification_required'; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(account.state().phase, 'verification_required');
    assert.equal(account.accounts().length, 0);
    const navigations = browser.requests.filter((path) => path === '/').length;
    await new Promise((r) => setTimeout(r, 3300));
    assert.equal(
      browser.requests.filter((path) => path === '/').length,
      navigations,
      'The manual form must remain in place',
    );
    browser.block = false;
    await browser.contexts
      .at(-1)!
      .pages()[0]
      .locator('body')
      .evaluate((element) => {
        element.textContent = 'Fixture verification completed';
      });
    await connected(account);
    assert.equal(account.state().account?.handle, 'fixture_user');
  } finally {
    await account.close();
    store.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('email verification and too-many-attempts stay untouched even if session cookies appear early', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-tt-email-')),
    browser = accountBrowserFixture();
  const store = new LocalStore(directory),
    account = new TikTokAccount(store, browser.factory);
  try {
    await account.connect('owner');
    const page = browser.contexts.at(-1)!.pages()[0];
    await page.locator('body').evaluate((element) => {
      element.textContent =
        'Подтверждение личности. Введите шестизначный код. Слишком много попыток. Попробуйте позже.';
    });
    const requests = browser.requests.length;
    await browser.signIn();
    for (let i = 0; i < 40 && account.state().phase !== 'verification_required'; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(account.state().phase, 'verification_required');
    assert.match(account.state().message ?? '', /Слишком много попыток/);
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(
      browser.requests.length,
      requests,
      'The connector must not make requests while login is limited',
    );
    await page.locator('body').evaluate((element) => {
      element.textContent = 'Подтверждение личности. Введите шестизначный код.';
    });
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(browser.requests.length, requests, 'The email-code form must stay in place');
    assert.equal(account.state().phase, 'verification_required');
    await page.locator('body').evaluate((element) => {
      element.textContent = 'Fixture login completed';
    });
    await connected(account);
    assert.equal(account.state().account?.handle, 'fixture_user');
  } finally {
    await account.close();
    store.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
