import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {
  parseSource,
  validateSettings,
  validatePlatformSettings,
  defaultSettings,
  defaultPlatformSettings,
} from '../src/features/sources/model.ts';

assert.equal(
  parseSource('https://t.me/s/qualityqa/10?single#comment', 'telegram').url,
  'https://t.me/qualityqa/10',
);
assert.equal(parseSource('@qa.channel', 'tiktok').url, 'https://www.tiktok.com/@qa.channel');
for (const link of [
  'javascript:alert(1)',
  'https://t.me.evil.test/test',
  'https://t.me/+invite',
  'https://user:pass@t.me/qualityqa',
  'https://t.me/share/url',
])
  assert.throws(() => parseSource(link, 'telegram'));
assert.throws(() => parseSource('https://tiktok.com/@person/live', 'tiktok'));
assert.throws(() =>
  validateSettings({ ...defaultSettings, comments: false, publications: false, metrics: false }),
);
assert.throws(() => validateSettings({ ...defaultSettings, maxComments: 10001 }));
assert.deepEqual(validatePlatformSettings(defaultPlatformSettings), defaultPlatformSettings);
assert.throws(() =>
  validatePlatformSettings({
    ...defaultPlatformSettings,
    telegram: { ...defaultPlatformSettings.telegram, minLength: -1 },
  }),
);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await context.newPage();
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dialog = page.locator('dialog[open]');
const ready = async (target = page) => {
  await target.getByRole('heading', { name: 'Источники', exact: true, level: 1 }).waitFor();
  await target.locator('.app-loader').waitFor({ state: 'detached' });
};
const sources = async (target = page) => {
  await target.getByRole('button', { name: 'Выбрать Telegram', exact: true }).click();
  await target.locator('button.dk-step-head', { hasText: 'Источники' }).click();
};
try {
  await page.goto(origin + '/sources?layout=classic&platform=telegram');
  await ready();
  assert.equal(new URL(page.url()).searchParams.has('layout'), false);
  assert.equal(
    await page.getByRole('group', { name: 'Вариант подключения источников', exact: true }).count(),
    0,
  );
  await page
    .locator('.sp-page-heading')
    .getByRole('button', { name: 'Добавить источник', exact: true })
    .click();
  await page
    .getByLabel('Ссылка источника', { exact: true })
    .fill('https://t.me/qualityqa?tracking=1');
  await page.getByLabel('Название источника', { exact: true }).fill('QA — разборы');
  await dialog.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await sources();
  await page.getByRole('switch', { name: 'Анализировать QA — разборы', exact: true }).click();
  await page.getByRole('button', { name: 'Настроить QA — разборы', exact: true }).click();
  await page
    .getByRole('group', { name: 'Назначение источника', exact: true })
    .getByRole('button', { name: 'Мой контент', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page
      .getByRole('switch', { name: 'Анализировать QA — разборы', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  assert.equal(
    await page.getByRole('link', { name: 'QA — разборы', exact: true }).getAttribute('href'),
    'https://t.me/qualityqa',
  );
  await page.getByLabel('Ссылка на источник Telegram', { exact: true }).fill('t.me/qualityqa');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('alert').getByText('Этот источник уже добавлен.', { exact: true }).waitFor();
  await page.reload();
  await ready();
  await sources();
  assert.equal(
    await page
      .getByRole('switch', { name: 'Анализировать QA — разборы', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  const second = await context.newPage();
  await second.goto(origin + '/sources');
  await ready(second);
  await sources(second);
  await second.getByRole('switch', { name: 'Анализировать QA — разборы', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Анализировать QA — разборы"]')
        .getAttribute('aria-checked') === 'true',
  );
  await second.close();
  for (const width of [1600, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.getByRole('button', { name: 'Настроить QA — разборы', exact: true }).click();
    assert.ok(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      `Dialog overflow at ${width}`,
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole('button', { name: 'Удалить источник QA — разборы', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить источник', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Пока пусто — добавьте первую ссылку.', { exact: true }).waitFor();
  await page.evaluate(() => (window.sourcesNavigationMarker = true));
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await page.getByRole('heading', { name: 'Аналитика', exact: true, level: 1 }).waitFor();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'Источники', exact: true }).click();
  await ready();
  assert.equal(await page.evaluate(() => window.sourcesNavigationMarker), true);
  assert.deepEqual(errors, []);
  console.log(
    'Sources passed: one layout, legacy URL cleanup, validation, canonical links, source CRUD, duplicate detection, persisted selection, cross-tab updates, responsive editor and SPA navigation.',
  );
} finally {
  await browser.close();
}
