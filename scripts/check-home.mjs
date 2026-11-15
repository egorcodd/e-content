import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rail = page.locator('.app-sidebar');
async function settled() {
  await page.waitForTimeout(600);
}
async function assertPanelAccessible() {
  const close = page.getByRole('button', { name: 'Закрыть процесс', exact: true });
  await settled();
  assert.equal(
    await close.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.top >= 0 &&
        rect.bottom <= innerHeight &&
        node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      );
    }),
    true,
    'Process close button is covered or outside the viewport',
  );
}
try {
  await page.goto(origin);
  await page.getByRole('heading', { level: 1, name: 'Цех агентов', exact: true }).waitFor();
  await page.locator('.wg-iso canvas').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await settled();
  assert.equal(await page.locator('.wg-iso-label').count(), 8);
  assert.equal(await page.locator('.app-header, .app-preview-bar, .overview-stats').count(), 0);
  assert.equal(
    await page.getByText(/Дизайн-система|Личное|Пространство|Компоновка главной/).count(),
    0,
  );
  assert.match(await page.title(), /Цех агентов · e-content/);
  const canvasBefore = await page.locator('canvas').boundingBox();
  assert.ok(
    canvasBefore.height >= 800 && canvasBefore.y < 120,
    'Workshop does not fill the desktop',
  );
  assert.ok(canvasBefore.y + canvasBefore.height <= 1000, 'Workshop is clipped below the viewport');
  fs.mkdirSync('.qa/home', { recursive: true });
  await page.screenshot({ path: '.qa/home/full-workshop.png' });

  await rail.hover();
  await settled();
  assert.equal(await rail.getAttribute('data-expanded'), 'true');
  assert.ok((await rail.boundingBox()).width >= 220);
  assert.equal((await page.locator('canvas').boundingBox()).width, canvasBefore.width);
  await page.screenshot({ path: '.qa/home/sidebar-open.png' });
  await page.mouse.move(900, 100);
  await settled();
  assert.equal(await rail.getAttribute('data-expanded'), 'false');
  await page.getByRole('button', { name: 'Открыть навигацию', exact: true }).focus();
  assert.equal(await rail.getAttribute('data-expanded'), 'true');
  await page.keyboard.press('Escape');
  await settled();
  assert.equal(await rail.getAttribute('data-expanded'), 'false');

  await page.getByRole('button', { name: 'Открыть участок Темы', exact: true }).click();
  await page.locator('.wg-process-panel').waitFor();
  await assertPanelAccessible();
  await page.screenshot({ path: '.qa/home/process.png' });
  await page.keyboard.press('Escape');
  await page.locator('.wg-process-panel').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  await page.locator('.wg-process-panel').waitFor();
  await assertPanelAccessible();
  await page
    .locator('.wg-process-panel')
    .getByRole('button', { name: 'Остановить цикл', exact: true })
    .click();
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  await page.locator('.wg-process-panel').waitFor({ state: 'detached' });
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.wg-active').count(), 0);

  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await settled();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Horizontal overflow at ' + width,
    );
    const canvas = await page.locator('canvas').boundingBox();
    assert.ok(canvas.y + canvas.height <= 1001, 'Canvas clipped at ' + width);
    if (width === 390) await page.screenshot({ path: '.qa/home/mobile.png' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Открыть навигацию', exact: true }).click();
  assert.equal(await rail.getAttribute('data-expanded'), 'true');
  await page.getByRole('button', { name: 'Свернуть навигацию', exact: true }).click();
  assert.equal(await rail.getAttribute('data-expanded'), 'false');
  await page
    .locator('.wg-mobile-nodes')
    .getByRole('button', { name: 'Telegram', exact: true })
    .click();
  await assertPanelAccessible();
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(origin);
  const touchRail = touchPage.locator('.app-sidebar');
  await touchPage.getByRole('button', { name: 'Открыть навигацию', exact: true }).tap();
  assert.equal(await touchRail.getAttribute('data-expanded'), 'true');
  await touchPage.getByRole('button', { name: 'Свернуть навигацию', exact: true }).tap();
  assert.equal(await touchRail.getAttribute('data-expanded'), 'false');
  await touchContext.close();

  await page.goto(origin + '/design-system#library');
  await page.getByRole('heading', { name: 'Библиотека', exact: true }).waitFor();
  assert.equal(await page.locator('.app-shell').count(), 0);
  await page.goto(origin + '/#typography');
  await page.getByRole('heading', { name: 'Типографика и знак', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/design-system');
  assert.deepEqual(errors, []);
  console.log(
    'Home checks passed: fullscreen workshop, hover/keyboard/touch sidebar, stable scene layout, accessible process panel, cycle cancellation, responsive widths, reduced motion, separate design system and legacy links.',
  );
} finally {
  await browser.close();
}
