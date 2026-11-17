import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture } from '../server/tests/fixtures.ts';

const f = await fixture();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: f.base + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.goto(
    (process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources?platform=tiktok',
  );
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Получить код подключения', exact: true }).click();
  await page.getByRole('button', { name: 'Копировать код подключения Zen', exact: true }).waitFor();
  const code = (await page.locator('.tt-zen-code code').innerText()).replaceAll(' ', '');
  assert.equal(code, f.app.zen.state().pairing.code);
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать расширение', exact: true }).click();
  assert.equal((await downloading).suggestedFilename(), 'e-content-zen.zip');
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page
        .getByRole('button', { name: 'Копировать код подключения Zen', exact: true })
        .isVisible(),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    assert.equal(overflow, false, 'Zen setup must fit viewport ' + width);
  }
  assert.deepEqual(errors, []);
  console.log(
    'Zen UI passed: explicit code generation, visible pairing code, ZIP download and responsive setup.',
  );
} finally {
  await browser.close();
  await f.close();
}
