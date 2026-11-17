import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, finish, fixture } from '../server/tests/fixtures.ts';
import { rawVideo } from '../server/tests/tiktok-fixtures.ts';

const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
let revision = 0;
let short = false;
let pendingPosts;
const transport = {
  calls: [],
  async get(path) {
    this.calls.push(path);
    if (path.startsWith('/tiktok/user/detail'))
      return {
        userInfo: {
          user: {
            id: '9000000000000000001',
            uniqueId: 'fixture_user',
            nickname: 'Creator',
            secUid: 'fixture-sec',
          },
          statsV2: { followerCount: String(100 + revision * 12), videoCount: '25' },
        },
      };
    assert.ok(path.startsWith('/tiktok/user/posts'), path);
    await pendingPosts;
    const first = path.endsWith('cursor=0');
    const ids = first
      ? Array.from({ length: 16 }, (_, i) => i)
      : [0, ...Array.from({ length: 9 }, (_, i) => i + 16)];
    const itemList = ids.map((i) => ({
      ...rawVideo,
      id: String(BigInt(rawVideo.id) - BigInt(i)),
      desc: `Публикация ${i + 1}`,
      createTime: Math.floor(Date.now() / 1000) - 60 - i * 2 * 86400,
      author: { uniqueId: 'fixture_user' },
      statsV2: {
        playCount: 100 + i + revision * 2,
        commentCount: i,
        diggCount: 2 * i,
        shareCount: 1,
      },
    }));
    return { itemList, hasMore: !short && first, cursor: 16 };
  },
  async close() {},
};
const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
const refreshHistory = async () => (await f.request('/analytics/history')).data;
async function waitForScan(status, after) {
  for (let i = 0; i < 120; i++) {
    const history = await refreshHistory();
    if (history.scan?.status === status && history.scan.id !== after) return history;
    await delay(20);
  }
  throw new Error('Unexpected analytics status: ' + JSON.stringify((await refreshHistory()).scan));
}
async function startScan() {
  const result = await f.request('/analytics/tiktok/scans', 'POST', {});
  assert.equal(result.status, 202);
  return result.data.scan.id;
}
try {
  await f.request('/connections');
  assert.equal(
    (await f.request('/tiktok/connect', 'POST', { handle: '@fixture_user' })).status,
    200,
  );
  for (let i = 0; i < 100 && f.app.tiktok.busy; i++) await delay(5);
  assert.equal(f.app.tiktok.state().phase, 'connected');
  assert.equal(f.app.tiktok.state().selection.latest, 20);
  assert.deepEqual((await refreshHistory()).tiktok, []);
  short = true;
  const incompleteId = await startScan();
  const partial = await waitForScan('partial');
  assert.equal(partial.catalog.id, incompleteId);
  assert.equal(partial.catalog.videos, 16);
  assert.equal(partial.catalog.expectedVideos, 25);
  assert.deepEqual(partial.tiktok, []);
  short = false;

  const browser = await chromium.launch(
    process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH, headless: true }
      : { channel: 'msedge', headless: true },
  );
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url());
      const response = await route.fetch({ url: f.base + u.pathname + u.search });
      await route.fulfill({ response });
    });
    await page.goto(origin);
    const sidebarAnalytics = page.getByRole('link', { name: 'Аналитика', exact: true });
    await sidebarAnalytics.click();
    await page.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
    assert.equal(await sidebarAnalytics.getAttribute('aria-current'), 'page');
    const refresh = page.getByRole('button', { name: 'Обновить статистику' });
    const download = page.getByRole('button', { name: 'Скачать CSV' });
    await page.getByText(/Получено 16 роликов из 25/).waitFor();
    const gate = Promise.withResolvers();
    pendingPosts = gate.promise;
    try {
      await refresh.click();
      await page.getByText(/Собираем весь публичный каталог TikTok/).waitFor();
      assert.equal(await refresh.isDisabled(), true);
      assert.equal((await f.request('/analytics/tiktok/scans', 'POST', {})).status, 409);
    } finally {
      pendingPosts = undefined;
      gate.resolve();
    }
    const first = await waitForScan('complete');
    assert.equal(first.tiktok.length, 1);
    assert.equal(first.catalog.videos, 25);
    assert.deepEqual(first.tiktok[0].counters, {
      views: 2800,
      comments: 300,
      likes: 600,
      shares: 25,
    });
    const { videos } = (await f.request('/analytics/tiktok/catalog?id=' + first.catalog.id)).data;
    assert.equal(videos.length, 25);
    assert.equal(videos.at(-1).title, 'Публикация 25');
    const trend = page.locator('.ap-trend .ag-trend-svg');
    await trend.waitFor();
    assert.equal(await page.getByRole('group', { name: 'Режим аналитики' }).count(), 0);
    await trend.focus();
    await trend.press('Home');
    await page.locator('.ap-trend .ag-tooltip').getByText('124', { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.ap-kpi-value')[1]?.textContent.replace(/\D/g, '') === '2800',
    );
    await page.getByRole('button', { name: 'Данные', exact: true }).click();
    const rows = page.locator('.ap-trend .ag-data-scroll > table tbody tr');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 25);
    const period = page.getByRole('group', { name: 'Период аналитики' });
    await period.getByRole('button', { name: '7 дней' }).click();
    assert.equal(await rows.count(), 4);
    await period.getByRole('button', { name: 'За всё время' }).click();
    const exported = page.waitForEvent('download');
    await download.click();
    const file = await exported;
    assert.equal(file.suggestedFilename(), 'e-content-tiktok-publications-all.csv');
    assert.equal(fs.readFileSync(await file.path(), 'utf8').split('\r\n').length, 26);

    revision = 1;
    await refresh.click();
    const second = await waitForScan('complete', first.catalog.id);
    assert.equal(second.tiktok.length, 2);
    assert.equal(second.tiktok[1].counters.views, 2850);
    assert.equal(second.tiktok[1].followers, 112);
    await page.locator('[data-growth-change="12"]').waitFor();
    await page.getByText('Замеры счётчиков', { exact: true }).click();
    const measurements = page.locator('.ap-measurement-details tbody tr');
    await measurements.nth(1).getByText('+50', { exact: true }).waitFor();
    assert.equal(await measurements.count(), 2);
    short = true;
    await startScan();
    const fallback = await waitForScan('partial');
    assert.equal(fallback.catalog.id, second.catalog.id);
    assert.deepEqual(fallback.tiktok, second.tiktok);
    short = false;

    const config = configuration();
    config.sources = [];
    config.settings.comments = false;
    config.settings.metrics = true;
    await f.app.engine.start('catalog-workshop-test', 'tiktok', f.app.tiktok.configuration(config));
    const workshop = await finish(f.app, 'catalog-workshop-test');
    assert.equal(workshop.counts.posts, 20);
    assert.deepEqual((await refreshHistory()).tiktok, second.tiktok);

    await page.getByRole('button', { name: 'График', exact: true }).click();
    await trend.waitFor();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await delay(320);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Page overflow at ${width}`,
      );
    }
    assert.equal(transport.calls.filter((path) => path.includes('/comments')).length, 0);
    assert.deepEqual(errors, []);
    console.log(
      'Analytics checks passed: 25 public videos, 20 workshop videos, first full baseline, dynamics, partial coverage, archive periods, CSV and responsive layout.',
    );
  } finally {
    await browser.close();
  }
} finally {
  await f.close();
}
