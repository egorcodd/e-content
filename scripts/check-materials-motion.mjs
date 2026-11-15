import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 600 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(origin + '/materials');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => scrollTo({ top: 120, behavior: 'instant' }));
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => scrollY > 50), 'Scenario must begin on a scrolled page');
  for (const [label, option] of [
    ['Сортировать идеи', 'Сначала новые'],
    ['Источник идей', 'TikTok'],
  ]) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.evaluate(() => {
      window.materialMotionFrames = [];
      const end = performance.now() + 750;
      const capture = () => {
        const top = (selector) => document.querySelector(selector)?.getBoundingClientRect().top;
        window.materialMotionFrames.push({
          scroll: scrollY,
          table: top('.mi-table'),
          firstRow: top('.mi-row'),
          filters: top('.mi-filters'),
        });
        if (performance.now() < end) requestAnimationFrame(capture);
      };
      capture();
    });
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.waitForTimeout(850);
    const shifts = await page.evaluate(() => {
      const frames = window.materialMotionFrames;
      return Object.fromEntries(
        ['scroll', 'table', 'firstRow', 'filters'].map((key) => {
          const values = frames.map((frame) => frame[key]).filter(Number.isFinite);
          return [key, Math.max(...values) - Math.min(...values)];
        }),
      );
    });
    assert.ok(
      Object.values(shifts).every((value) => value <= 1),
      `${label}: ${JSON.stringify(shifts)}`,
    );
  }
  assert.equal(
    await page.getByRole('columnheader', { name: 'Упоминания', exact: true }).count(),
    1,
  );
  assert.equal(await page.locator('.mi-activity-total,.mi-activity-context').count(), 0);
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
    assert.ok(
      await page
        .locator('.mi-frequency-chart')
        .evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().width === 120)),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'Material motion passed: scrolled filter/sort changes have no list or viewport jump; mention count appears once; charts stay 120px wide at responsive sizes.',
  );
} finally {
  await browser.close();
}
