import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const group = (label) => page.getByRole('group', { name: label, exact: true });
async function settle() {
  await page.waitForTimeout(650);
}
function integer(value) {
  return Number(value.replace(/[^0-9]/g, ''));
}
try {
  await page.goto(origin);
  await page.locator('.app-sidebar').hover();
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await page.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
  await page.locator('.ap-trend .ag-trend-svg').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await settle();
  const sidebar = page.locator('.app-sidebar');
  assert.equal(await sidebar.getAttribute('data-expandable'), 'false');
  const sidebarWidth = (await sidebar.boundingBox()).width;
  await sidebar.hover();
  await settle();
  assert.equal(await sidebar.getAttribute('data-expanded'), 'false');
  assert.equal((await sidebar.boundingBox()).width, sidebarWidth);
  await page.getByRole('link', { name: 'Аналитика', exact: true }).focus();
  assert.equal(await sidebar.getAttribute('data-expanded'), 'false');
  assert.equal(new URL(page.url()).pathname, '/analytics');
  assert.equal(
    await page.getByRole('link', { name: 'Аналитика', exact: true }).getAttribute('aria-current'),
    'page',
  );
  assert.equal(await page.locator('.analytics-page canvas').count(), 0);
  assert.equal(await page.locator('.ap-kpi-value').count(), 5);
  await page.getByRole('heading', { name: 'Рост аудитории', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Источники просмотров', exact: true }).waitFor();
  assert.equal(await page.locator('.analytics-page section.ag-card').count(), 3);
  assert.equal(await page.getByRole('heading', { name: 'Площадки', exact: true }).count(), 0);
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /демо|демонстрац|Журнал сбора|Публикации|Время публикации/iu,
  );
  await group('Площадка аналитики').getByRole('button', { name: 'TikTok', exact: true }).click();
  await group('Период аналитики').getByRole('button', { name: '7 дней', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.analytics-page section.ag-card').count(), 3);
  assert.equal(await page.getByRole('heading', { name: 'Площадки', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Данные', exact: true }).click();
  await page.locator('.ag-data-scroll tbody tr').first().waitFor();
  assert.equal(await page.locator('.ag-data-scroll tbody tr').count(), 7);
  assert.equal(await page.locator('.ag-data-scroll thead th').count(), 2);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
  const file = await event;
  assert.equal(file.suggestedFilename(), 'e-content-analytics-7d-tiktok.csv');
  const records = fs
    .readFileSync(await file.path(), 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .slice(1)
    .map((row) => row.split(';'));
  assert.equal(records.length, 7);
  assert.ok(records.every((row) => row[1] === 'TikTok'));
  const values = await page.locator('.ap-kpi-value').allTextContents();
  assert.equal(integer(values[0]), Number(records.at(-1)[2]));
  assert.equal(
    integer(values[1]),
    records.reduce((sum, row) => sum + Number(row[3]), 0),
  );
  assert.equal(
    integer(values[2]),
    records.reduce((sum, row) => sum + Number(row[4]), 0),
  );
  for (const [kpi, column] of [
    [3, 5],
    [4, 6],
  ]) {
    assert.equal(
      integer(values[kpi]),
      records.reduce((sum, row) => sum + Number(row[column]), 0),
    );
  }
  const growth = Number(
    await page.locator('[data-growth-change]').getAttribute('data-growth-change'),
  );
  assert.equal(
    growth,
    records.reduce((sum, row) => sum + Number(row[7]), 0),
  );
  const growthStart = Number(
    await page.locator('[data-growth-start]').getAttribute('data-growth-start'),
  );
  const growthEnd = Number(await page.locator('[data-growth-end]').getAttribute('data-growth-end'));
  assert.equal(growthEnd - growthStart, growth);
  assert.equal(growthEnd, Number(records.at(-1)[2]));
  await page.locator('.ap-sources-empty').waitFor();
  assert.equal(await page.locator('[data-source-views]').count(), 0);
  await group('Показатель аналитики')
    .getByRole('button', { name: /^Лайки/ })
    .click();
  assert.equal(new URL(page.url()).searchParams.get('metric'), 'reactions');
  const reactionCells = await page
    .locator('.ag-data-scroll tbody tr td:last-child')
    .allTextContents();
  assert.deepEqual(
    reactionCells.map(integer),
    records.map((row) => Number(row[5])),
  );
  await group('Показатель аналитики')
    .getByRole('button', { name: /^Репосты/ })
    .click();
  const shareCells = await page.locator('.ag-data-scroll tbody tr td:last-child').allTextContents();
  assert.deepEqual(
    shareCells.map(integer),
    records.map((row) => Number(row[6])),
  );
  await page.getByRole('button', { name: 'График', exact: true }).click();
  await group('Показатель аналитики')
    .getByRole('button', { name: /^Комментарии/ })
    .click();
  await page.locator('.ap-trend .ag-trend-svg').focus();
  await page.keyboard.press('ArrowLeft');
  await page.locator('.ap-trend .ag-tooltip').waitFor();
  await group('Вид графика').getByRole('button', { name: 'Линии', exact: true }).click();
  await group('Ряды графика')
    .getByRole('button', { name: /^TikTok/ })
    .click();
  await page.getByText('Выберите ряд на легенде', { exact: true }).waitFor();
  await group('Ряды графика')
    .getByRole('button', { name: /^TikTok/ })
    .click();
  await page.reload();
  await group('Площадка аналитики').getByRole('button', { name: 'TikTok', exact: true }).waitFor();
  assert.equal(
    await group('Площадка аналитики')
      .getByRole('button', { name: 'TikTok', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await group('Период аналитики')
      .getByRole('button', { name: '7 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await group('Площадка аналитики')
    .getByRole('button', { name: 'Все площадки', exact: true })
    .click();
  await group('Период аналитики').getByRole('button', { name: '30 дней', exact: true }).click();
  await settle();
  await page.locator('[data-sources-total]').waitFor();
  const sourceTotal = Number(
    await page.locator('[data-sources-total]').getAttribute('data-sources-total'),
  );
  const sourceRows = await page.locator('[data-source-views]').evaluateAll((rows) =>
    rows.map((row) => ({
      views: Number(row.getAttribute('data-source-views')),
      share: Number(row.getAttribute('data-source-share')),
    })),
  );
  assert.equal(
    sourceRows.reduce((sum, row) => sum + row.views, 0),
    sourceTotal,
  );
  assert.ok(Math.abs(sourceRows.reduce((sum, row) => sum + row.share, 0) - 100) < 0.00001);
  const allDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
  const allFile = await allDownload;
  const allRecords = fs
    .readFileSync(await allFile.path(), 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .slice(1)
    .map((row) => row.split(';'));
  assert.equal(allRecords.length, 60);
  assert.equal(
    sourceTotal,
    allRecords.filter((row) => row[1] === 'Telegram').reduce((sum, row) => sum + Number(row[3]), 0),
  );
  assert.equal(
    Number(await page.locator('[data-growth-change]').getAttribute('data-growth-change')),
    allRecords.reduce((sum, row) => sum + Number(row[7]), 0),
  );
  const sourceButton = group('Распределение просмотров').getByRole('button').first();
  await sourceButton.click();
  assert.equal(await sourceButton.getAttribute('aria-pressed'), 'true');
  await sourceButton.click();
  assert.equal(await sourceButton.getAttribute('aria-pressed'), 'false');
  await group('Площадка источников просмотров')
    .getByRole('button', { name: 'TikTok', exact: true })
    .click();
  await page.locator('.ap-sources-empty').waitFor();
  await group('Площадка источников просмотров')
    .getByRole('button', { name: 'Telegram', exact: true })
    .click();
  await settle();
  await page.locator('[data-sources-total]').waitFor();
  await page.locator('.ap-growth .ag-trend-svg').focus();
  await page.keyboard.press('Home');
  await page.locator('.ap-growth .ag-tooltip').waitFor();
  assert.equal(await page.locator('.ap-growth .ag-tooltip > span').count(), 2);
  await page.keyboard.press('End');
  const growthTooltipValues = await page.locator('.ap-growth .ag-tooltip b').allTextContents();
  assert.equal(
    growthTooltipValues.reduce((sum, value) => sum + integer(value), 0),
    Number(await page.locator('[data-growth-change]').getAttribute('data-growth-change')),
  );
  assert.equal(await page.locator('.analytics-page .ag-trend-svg').count(), 2);
  assert.equal(await page.locator('.ap-growth rect').count(), 0);
  const gradientIds = await page
    .locator('.analytics-page linearGradient')
    .evaluateAll((items) => items.map((item) => item.id));
  assert.equal(new Set(gradientIds).size, gradientIds.length);
  await page.locator('h1').click();
  async function stableSources(action) {
    const heights = page.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = [];
          const start = performance.now();
          function sample() {
            samples.push(document.querySelector('.ap-sources').getBoundingClientRect().height);
            if (performance.now() - start < 550) requestAnimationFrame(sample);
            else resolve(samples);
          }
          sample();
        }),
    );
    await action();
    const measured = await heights;
    assert.ok(
      Math.max(...measured) - Math.min(...measured) < 1,
      'Sources card changes height while switching',
    );
    await settle();
  }
  await stableSources(() =>
    group('Площадка источников просмотров')
      .getByRole('button', { name: 'TikTok', exact: true })
      .click(),
  );
  await stableSources(() =>
    group('Площадка источников просмотров')
      .getByRole('button', { name: 'Telegram', exact: true })
      .click(),
  );
  for (const period of ['7', '90', '30'])
    await stableSources(() =>
      group('Период аналитики')
        .getByRole('button', { name: `${period} дней`, exact: true })
        .click(),
    );
  fs.mkdirSync('.qa/analytics', { recursive: true });
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    await settle();
    assert.equal(await sidebar.getAttribute('data-expanded'), 'false');
    assert.equal(
      await page.getByRole('link', { name: 'Аналитика', exact: true }).isVisible(),
      true,
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Page overflow at ' + width,
    );
    assert.equal(
      await page.locator('.analytics-page').evaluate((root) => {
        const outer = root.getBoundingClientRect();
        return [...root.querySelectorAll('.ag-card, .ap-filters, .ap-kpis')].some(
          (node) => node.getBoundingClientRect().right > outer.right + 1,
        );
      }),
      false,
      'Card overflow at ' + width,
    );
    if (width === 1440 || width === 390) {
      await page.locator('.ap-growth .ag-plot').scrollIntoViewIfNeeded();
      await settle();
      await page.screenshot({ path: '.qa/analytics/checked-' + width + '.png', fullPage: true });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stableSources(() =>
    group('Площадка источников просмотров')
      .getByRole('button', { name: 'TikTok', exact: true })
      .click(),
  );
  await stableSources(() =>
    group('Площадка источников просмотров')
      .getByRole('button', { name: 'Telegram', exact: true })
      .click(),
  );
  await group('Период аналитики').getByRole('button', { name: '7 дней', exact: true }).focus();
  await page.keyboard.press('End');
  assert.equal(
    await group('Период аналитики')
      .getByRole('button', { name: '90 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.goto(origin + '/analytics?source=invalid&period=invalid&metric=invalid');
  await group('Период аналитики').getByRole('button', { name: '30 дней', exact: true }).waitFor();
  assert.equal(
    await group('Период аналитики')
      .getByRole('button', { name: '30 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('.app-sidebar').hover();
  await page.getByRole('link', { name: 'Цех агентов', exact: true }).click();
  await page.getByRole('heading', { name: 'Цех агентов', exact: true }).waitFor();
  assert.equal(await page.locator('.app-nav a[href="/"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(errors, []);
  console.log(
    'Analytics checks passed: navigation, five metrics, CSV/KPI/growth consistency, view-source totals and availability, chart/table/legend, persisted URL, responsive layouts, keyboard, reduced motion, invalid URLs and return to workshop.',
  );
} finally {
  await browser.close();
}
