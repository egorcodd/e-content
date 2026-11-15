import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const library = page.locator('#library');
const sort = library.getByRole('combobox', { name: 'Сортировать материалы' });
const search = library.getByRole('searchbox', { name: 'Поиск в библиотеке' });
async function settled() {
  await page.waitForTimeout(650);
}
async function openCareer() {
  await library.getByRole('button', { name: /Открыть папку «Карьера»/ }).click();
  await settled();
}
async function checkLayout(width) {
  await page.setViewportSize({ width, height: 1200 });
  await settled();
  assert.ok(
    (await library.locator('.lib-open-folder h3').boundingBox()).width >= 100,
    `Folder title squeezed at ${width}`,
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `Page overflow at ${width}`,
  );
  assert.equal(
    await library.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      return [
        ...root.querySelectorAll(
          '.lib-paper-card, .lib-folder-tile, .lib-open-folder, .lib-controls',
        ),
      ].some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.right > bounds.right + 1 || rect.left < bounds.left - 1;
      });
    }),
    false,
    `Library overflow at ${width}`,
  );
  await sort.click();
  await page.waitForTimeout(200);
  const menu = await page.getByRole('listbox').boundingBox();
  assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1, `Menu overflow at ${width}`);
  await page.keyboard.press('Escape');
}
try {
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/#library');
  await page.evaluate(() => document.fonts.ready);
  await settled();
  await openCareer();
  assert.equal(await library.locator('.lib-paper-card').count(), 3);
  assert.equal(
    await library
      .locator('.lib-open-folder h3')
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await library.locator('.lib-paper-card').first().click();
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
  await page.getByRole('tabpanel').filter({ hasText: '# Первое собеседование' }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Скачать Markdown', exact: true })
    .click();
  const file = await downloadEvent;
  assert.match(fs.readFileSync(await file.path(), 'utf8'), /Вопросы аудитории/);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  await library.getByRole('button', { name: 'Все папки', exact: true }).click();
  await settled();
  assert.equal(
    await page.locator('#lib-tile-career').evaluate((node) => node === document.activeElement),
    true,
  );
  await sort.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await settled();
  assert.match(await sort.innerText(), /По авторам/);
  assert.match(await library.locator('.lib-file-row').first().innerText(), /Первое собеседование/);
  await sort.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await sort.click();
  await page.keyboard.press('Escape');
  assert.equal(await sort.getAttribute('aria-expanded'), 'false');
  await sort.click();
  await library.getByRole('heading', { name: 'Недавние материалы', exact: true }).click();
  assert.equal(await sort.getAttribute('aria-expanded'), 'false');

  await library.getByRole('button', { name: 'Новая папка', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название папки', exact: true }).fill('Исследования');
  await page.getByRole('button', { name: 'Создать папку', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await library.getByRole('button', { name: /Открыть папку «Исследования»/ }).click();
  await library.getByRole('heading', { name: 'Папка пуста', exact: true }).waitFor();
  await settled();
  fs.mkdirSync('.qa/library-polish', { recursive: true });
  await library.screenshot({ path: '.qa/library-polish/empty.png' });
  await library.getByRole('button', { name: 'Добавить демоматериал', exact: true }).click();
  await settled();
  assert.equal(await library.locator('.lib-paper-card').count(), 1);
  await search.fill('несуществующий материал');
  await library.getByRole('heading', { name: 'Материалов не найдено', exact: true }).waitFor();
  await settled();
  assert.equal(await library.locator('.lib-paper-card').count(), 0);
  await library.getByRole('button', { name: 'Сбросить поиск', exact: true }).click();
  await settled();
  assert.equal(await library.locator('.lib-paper-card').count(), 1);

  await library.getByRole('button', { name: 'Все папки', exact: true }).click();
  await settled();
  await openCareer();
  for (const width of [1920, 1440, 1024, 768, 600, 390, 320]) await checkLayout(width);
  await library.screenshot({ path: '.qa/library-polish/papers-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await settled();
  await library.screenshot({ path: '.qa/library-polish/papers.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await library.getByRole('button', { name: 'Все папки', exact: true }).click();
  await library.getByRole('button', { name: /Открыть папку «Карьера»/ }).click();
  await settled();
  assert.equal(await library.locator('.lib-paper-card').count(), 3);
  await sort.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.match(await sort.innerText(), /По авторам/);
  assert.deepEqual(errors, []);
  console.log(
    'Library checks passed: folder navigation/focus, paper preview/export, sorting/keyboard/dismissal, empty/add sample, search, responsive menus/cards, reduced motion.',
  );
} finally {
  await browser.close();
}
