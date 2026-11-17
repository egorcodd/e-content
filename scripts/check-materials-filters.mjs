import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1050 } });
await page.route('**/api/collection/latest', (route) => route.fulfill({ json: { run: null } }));
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const select = async (label, option) => {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
try {
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/materials');
  await page.getByRole('heading', { level: 1, name: 'Материалы', exact: true }).waitFor();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page.locator('.mi-row').first().waitFor();
  await select('Формат идей', 'Пост');
  await select('Источник идей', 'TikTok');
  assert.equal(
    await page.getByRole('combobox', { name: 'Формат идей', exact: true }).innerText(),
    'Видео',
  );
  await page.getByRole('combobox', { name: 'Формат идей', exact: true }).click();
  assert.deepEqual(
    await page
      .getByRole('listbox', { name: 'Формат идей', exact: true })
      .getByRole('option')
      .allTextContents(),
    ['Видео'],
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const rows = page.locator('.mi-row');
  assert.ok((await rows.count()) > 0);
  for (const row of await rows.all()) {
    assert.equal(
      (await row.locator('.mi-open > span').innerText()).replace(/\s+/g, ' '),
      'Видео TikTok',
    );
  }
  const title = 'Почему автотесты падают только на CI';
  const row = rows.filter({
    has: page.getByRole('button', { name: `Открыть идею ${title}`, exact: true }),
  });
  const expected = await page.evaluate(async (title) => {
    const records = await new Promise((resolve, reject) => {
      const request = indexedDB.open('e-content-library');
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('materials').objectStore('materials').getAll();
        get.onsuccess = () => {
          resolve(get.result);
          db.close();
        };
        get.onerror = () => reject(get.error);
      };
    });
    const idea = records.find((record) => record.title === title);
    const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
    const today = calendar.format(new Date());
    const first = new Date(Date.parse(today + 'T12:00:00Z') - 13 * 86400000)
      .toISOString()
      .slice(0, 10);
    return idea.evidence.filter(
      (item) =>
        item.source === 'tiktok' &&
        item.publishedAt &&
        calendar.format(new Date(item.publishedAt)) >= first &&
        calendar.format(new Date(item.publishedAt)) <= today,
    ).length;
  }, title);
  assert.ok(expected > 0 && expected < 12, 'Fixture must contain evidence from both sources');
  assert.equal(await row.locator('.mi-mention-cell > span').last().innerText(), String(expected));
  await row.locator('.mi-frequency').hover();
  assert.match(await page.getByRole('tooltip').innerText(), new RegExp(`${expected} упоминан`));
  assert.doesNotMatch(await page.getByRole('tooltip').innerText(), /0 фрагмент/);
  await page.mouse.move(500, 70);
  await select('Источник идей', 'Все источники');
  assert.equal(
    await page.getByRole('combobox', { name: 'Формат идей', exact: true }).innerText(),
    'Любой формат',
  );
  await page.waitForTimeout(350);
  assert.ok(
    (await rows.locator('.mi-open > span').allTextContents()).some((text) =>
      text.startsWith('Пост'),
    ),
  );
  for (const width of [1920, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    const firstRow = rows.first();
    const box = await firstRow.boundingBox();
    const star = await firstRow.locator('.mi-favorite').boundingBox();
    assert.ok(star.x - box.x >= 11, `Star touches hover edge at ${width}`);
    const colors = await firstRow.locator('.mi-delete').evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
    assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)');
    assert.match(colors.color, /200, 142, 142/);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 1920, height: 1050 });
  await page.evaluate(() => scrollTo(0, 0));
  await rows.first().locator('.mi-favorite').hover();
  fs.mkdirSync('.qa/materials', { recursive: true });
  await page.screenshot({ path: '.qa/materials/filters-and-actions.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Materials filters passed: TikTok only videos; incompatible format resets; source counts and tooltips agree; all-source formats return; star inset and red delete verified at 5 widths.',
  );
} finally {
  await browser.close();
}
