import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  for (const endpoint of ['Home', 'End']) {
    for (const name of ['Публикации', 'Комментарии']) {
      await page.getByRole('slider', { name, exact: true }).focus();
      await page.keyboard.press(endpoint);
    }
    for (const width of [1100, 1600, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const overflow = await page.locator('.platform-limits .source-range').evaluateAll((labels) =>
        labels.flatMap((label) => {
          const bounds = label.getBoundingClientRect();
          return [...label.querySelectorAll('.source-range-heading > *, .source-range-rail')]
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.right > bounds.right + 1 || box.left < bounds.left - 1;
            })
            .map((element) => element.textContent);
        }),
      );
      assert.deepEqual(overflow, [], `Slider content overlaps at ${width}, ${endpoint}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
  }
  await page.setViewportSize({ width: 1100, height: 950 });
  await page.locator('button.dk-step-head', { hasText: 'Источники' }).click();
  const input = page.getByLabel('Ссылка на источник Telegram', { exact: true });
  await input.focus();
  const field = page.locator('.dk-link');
  assert.equal(await field.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
  await input.fill('t.me/qualityqa');
  assert.equal(await field.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
  assert.equal(await input.evaluate((element) => element === document.activeElement), true);
  console.log(
    'Source layout passed: zero/max values stay within both slider columns at 5 widths; focused and valid links have no outer outline or halo.',
  );
} finally {
  await browser.close();
}
