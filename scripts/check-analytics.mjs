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
        shareCount: 1 - revision,
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
    await refresh.getByText('Ошибка обновления', { exact: true }).waitFor();
    const chartPanel = page.getByRole('region', { name: 'Показатели TikTok' });
    const chartTop = (await chartPanel.boundingBox()).y;
    const refreshBox = await refresh.boundingBox();
    const gate = Promise.withResolvers();
    pendingPosts = gate.promise;
    try {
      await refresh.click();
      await refresh.getByText('Обновляем…', { exact: true }).waitFor();
      assert.equal(await refresh.getAttribute('aria-busy'), 'true');
      assert.deepEqual(await refresh.boundingBox(), refreshBox);
      assert.equal((await chartPanel.boundingBox()).y, chartTop);
      assert.equal(await refresh.isDisabled(), true);
      assert.equal((await f.request('/analytics/tiktok/scans', 'POST', {})).status, 409);
    } finally {
      pendingPosts = undefined;
      gate.resolve();
    }
    const first = await waitForScan('complete');
    await refresh.locator(`time[datetime="${first.catalog.finishedAt}"]`).waitFor();
    assert.equal((await chartPanel.boundingBox()).y, chartTop);
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
    await page.route('**/api/analytics/tiktok/cover?*', (route) => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64'),
    }));
    await page.getByText(/История началась с первого замера/).waitFor();
    const kpis = page.locator('.ap-kpi-value');
    const comparisons = page.locator('.ap-kpis .ag-delta');
    const period = page.getByRole('group', { name: 'Период аналитики' });
    const selectPeriod = name => period.getByRole('button', { name, exact: true }).click();
    const values = () => kpis.allTextContents();
    await page.waitForFunction(() => document.querySelectorAll('.ap-kpi-value')[1]?.textContent.replace(/\D/g,'') === '2800');
    assert.equal(await comparisons.count(), 0);
    for (const name of ['7 дней', '30 дней']) {
      await selectPeriod(name);
      await page.getByText(/Есть один замер/).waitFor();
      assert.deepEqual(await values(), Array(5).fill('—'));
      assert.equal(await download.isDisabled(), true);
    }
    await selectPeriod('За всё время');
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
    assert.equal(await comparisons.count(), 0);
    await selectPeriod('7 дней');
    await page.waitForFunction(() => document.querySelectorAll('.ap-kpi-value')[1]?.textContent === '+50');
    assert.equal(await comparisons.count(), 0);
    await page.locator('.ap-measured-range').waitFor();
    const growth = page.getByRole('region', { name: 'Ролики с приростом' });
    const growthRows = growth.locator('tbody tr');
    await growthRows.first().waitFor();
    const preview = growthRows.first().locator('.ap-video-cover img');
    await preview.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.ap-video-cover img')?.naturalWidth > 0);
    assert.equal(await growthRows.count(), 6);
    assert.deepEqual(await growthRows.first().locator('td').allTextContents(), ['+2', '-1', '0']);
    const sortComments = growth.getByRole('button', { name: 'Комментарии', exact: true });
    await sortComments.scrollIntoViewIfNeeded();
    const rankingPosition = await growth.boundingBox();
    await sortComments.click();
    await growth.getByRole('columnheader', { name: 'Комментарии' })
      .and(growth.locator('[aria-sort="descending"]')).waitFor();
    assert.deepEqual(await growth.boundingBox(), rankingPosition);
    assert.equal(await growthRows.first().locator('td').first().evaluate((cell) =>
      getComputedStyle(cell.querySelector('.ap-video-rank-glyphs')).transform), 'none');
    await growth.getByRole('button', { name: 'Все ролики (25)' }).click();
    assert.equal(await growthRows.count(), 25);
    await growth.getByRole('button', { name: 'Свернуть' }).click();
    await trend.waitFor();
    await page.getByRole('button', { name: 'Данные', exact: true }).click();
    const rows = page.locator('.ap-trend .ag-data-scroll > table tbody tr');
    await rows.nth(1).getByText('+50',{exact:true}).waitFor();
    assert.equal(await rows.count(), 2);
    const growthDownload = page.waitForEvent('download');
    await download.click();
    const growthFile = await growthDownload;
    assert.equal(growthFile.suggestedFilename(),'e-content-tiktok-growth-7.csv');
    assert.match(fs.readFileSync(await growthFile.path(),'utf8').split('\r\n').at(-1), /;12;50;0;0;-25$/);
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

    const lastDate = Date.parse(second.tiktok[1].date);
    const withHistory = [
      { id: 'start', daysAgo: 14, views: 2700, followers: 100 },
      { id: 'middle', daysAgo: 7, views: 2800, followers: 102, change: 100 },
      { id: 'end', daysAgo: 0, views: 2850, followers: 106, change: 50 },
    ].map(({ id, daysAgo, views, followers, change }) => ({
      id,
      date: new Date(lastDate - daysAgo * 86400000).toISOString(),
      videos: 25,
      counters: { views },
      followers,
      change: change === undefined ? undefined : { counters: { views: change }, coverageChanged: false },
    }));
    await page.route('**/api/analytics/history', (route) => route.fulfill({
      json: { ...second, tiktok: withHistory },
    }));
    await page.reload();
    await comparisons.first().waitFor();
    assert.deepEqual(await comparisons.locator('.ag-delta-badge').allTextContents(), ['100%', '50%']);
    assert.deepEqual(await comparisons.locator('.ag-delta-suffix').allTextContents(), [
      'к прошлым 7 дням',
      'к прошлым 7 дням',
    ]);
    assert.match(await comparisons.first().getAttribute('class'), /\bis-up\b/);
    assert.match(await comparisons.last().getAttribute('class'), /\bis-down\b/);
    console.log(
      'Analytics checks passed: 25 public videos, 20 workshop videos, first full baseline, dynamics, partial coverage, archive periods, CSV and responsive layout.',
    );
  } finally {
    await browser.close();
  }
} finally {
  await f.close();
}
