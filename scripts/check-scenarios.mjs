import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const section = page.locator('#scenarios');
const workspace = section.locator('.sg-workspace');
async function phase(value) {
  await page.waitForFunction(
    (expected) => document.querySelector('.sg-workspace')?.dataset.phase === expected,
    value,
  );
}
async function choose(name) {
  await section.getByRole('button', { name, exact: true }).click();
}
try {
  await page.goto(
    (process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/design-system/#scenarios',
  );
  await phase('empty');
  assert.equal(await section.locator('.sg-export').isDisabled(), true);
  assert.equal(await section.locator('.sg-source').filter({ hasText: 'Не подключён' }).count(), 2);
  await choose('Подключить источники');
  await phase('ready');
  await choose('Запустить цикл');
  await phase('done');
  assert.equal(await workspace.getAttribute('data-result'), 'full');
  const downloadEvent = page.waitForEvent('download');
  await choose('Скачать отчёт .md');
  const file = await downloadEvent;
  assert.equal(file.suggestedFilename(), 'scenario-report.md');
  assert.match(fs.readFileSync(await file.path(), 'utf8'), /Результат: полный/);

  await choose('Сбой источника');
  await choose('Запустить цикл');
  await phase('partial');
  assert.equal(await workspace.getAttribute('data-result'), 'partial');
  assert.match(await section.locator('[data-source=tiktok]').innerText(), /тайм-аут/);
  const telegramBefore = await section.locator('[data-source=telegram]').innerText();
  await choose('Повторить только TikTok');
  assert.equal(await section.locator('[data-source=telegram]').innerText(), telegramBefore);
  assert.equal(await workspace.getAttribute('data-result'), 'partial');
  await phase('done');
  assert.match(await section.locator('.sg-message').innerText(), /без повторного сбора Telegram/);

  await choose('Успешный цикл');
  await choose('Запустить цикл');
  await choose('Остановить');
  await phase('stopped');
  await page.waitForTimeout(3800);
  await phase('stopped');
  assert.equal(await workspace.getAttribute('data-result'), 'none');
  await choose('Запустить цикл');
  await choose('Первый запуск');
  await page.waitForTimeout(3800);
  await phase('empty');

  await choose('Успешный цикл');
  await choose('Запустить цикл');
  await phase('done');
  fs.mkdirSync('.qa/scenarios', { recursive: true });
  await page.waitForTimeout(400);
  await section.screenshot({ path: '.qa/scenarios/desktop.png' });
  for (const width of [1920, 1440, 1366, 1024, 900, 850, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.waitForTimeout(120);
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(bounds.scroll <= bounds.width + 1, `Page overflow at ${width}: ${bounds.scroll}`);
    const overflow = await section.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('button, .sg-source, .sg-stages li, .sg-result')].some(
        (child) => {
          const rect = child.getBoundingClientRect();
          return rect.right > bounds.right + 1 || rect.left < bounds.left - 1;
        },
      );
    });
    assert.equal(overflow, false, `Scenario overflow at ${width}`);
  }
  await section.screenshot({ path: '.qa/scenarios/mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choose('Первый запуск');
  const scenarioButton = section.getByRole('button', { name: 'Первый запуск', exact: true });
  await scenarioButton.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await section
      .getByRole('button', { name: 'Успешный цикл', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await choose('Запустить цикл');
  await phase('done');
  assert.deepEqual(errors, []);
  console.log(
    'Scenario checks passed: first launch, success/export, partial result, isolated retry, stop, switch cancellation, responsive layouts, keyboard, reduced motion.',
  );
} finally {
  await browser.close();
}
