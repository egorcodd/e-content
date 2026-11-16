import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
assert.equal(parseSource('https://t.me/c/12345/8', 'telegram').kind, 'publication');
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
for (const broken of [
  { ...defaultPlatformSettings, tiktok: { ...defaultPlatformSettings.tiktok, order: 'random' } },
  { ...defaultPlatformSettings, telegram: { ...defaultPlatformSettings.telegram, minLength: -1 } },
  {
    ...defaultPlatformSettings,
    telegram: { ...defaultPlatformSettings.telegram, custom: { ...defaultSettings, period: '1' } },
  },
])
  assert.throws(() => validatePlatformSettings(broken));

const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dialog = page.locator('dialog[open]');
async function ready(target = page) {
  await target.getByRole('heading', { name: 'Источники', exact: true, level: 1 }).waitFor();
  await target.locator('.app-loader').waitFor({ state: 'detached' });
}
async function segment(name, value, target = page) {
  await target
    .getByRole('group', { name, exact: true })
    .getByRole('button', { name: value, exact: true })
    .click();
}
async function select(name, value) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function add(platform, url, title) {
  await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await segment('Площадка источника', platform);
  await page.getByLabel('Ссылка источника', { exact: true }).fill(url);
  await page.getByLabel('Название источника', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
fs.mkdirSync('.qa/sources', { recursive: true });
try {
  await page.goto(origin + '/sources?layout=classic');
  await ready();
  await page
    .getByRole('button', { name: 'Проверить подключения', exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Проверить подключения"]').disabled,
  );
  assert.equal(
    await page.getByRole('link', { name: 'Источники', exact: true }).getAttribute('aria-current'),
    'page',
  );
  await page
    .locator('.sp-account')
    .first()
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  await dialog.getByText('Подключение недоступно', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Продолжить', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await add('Telegram', 'https://t.me/qualityqa?tracking=1', 'QA — разборы');
  await add(
    'TikTok',
    'https://www.tiktok.com/@qualityqa/video/1234567890123456789',
    'Вопросы к видео',
  );
  assert.equal(await page.locator('.sp-source-row').count(), 2);
  await page.getByRole('switch', { name: 'Анализировать QA — разборы', exact: true }).click();
  assert.equal(
    await page
      .getByRole('switch', { name: 'Анализировать QA — разборы', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  await page.getByRole('button', { name: 'Настроить QA — разборы', exact: true }).click();
  await segment('Назначение источника', 'Мой контент');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await page.getByLabel('Ссылка источника', { exact: true }).fill('https://t.me/qualityqa');
  await dialog.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText('Этот источник уже добавлен.', { exact: true })
    .waitFor();
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await segment('Площадка списка источников', 'TikTok');
  await page.waitForFunction(() => document.querySelectorAll('.sp-source-row').length === 1);
  assert.match(await page.locator('.sp-source-row').innerText(), /Вопросы к видео/);
  await page.getByLabel('Найти источник', { exact: true }).fill('нет такого источника');
  await page.getByRole('heading', { name: 'Источник не найден', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Очистить поиск источников', exact: true }).click();
  await segment('Площадка списка источников', 'Все');
  await page.waitForFunction(() => document.querySelectorAll('.sp-source-row').length === 2);
  await segment('Период сбора', '90 дней');
  await page.getByRole('switch', { name: 'Собирать: Статистика', exact: true }).click();
  await page.getByLabel('Лимит комментариев', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Сохранить параметры', exact: true }).click();
  await page.reload();
  await ready();
  assert.equal(await page.locator('.sp-source-row').count(), 2);
  assert.equal(
    await page
      .getByRole('switch', { name: 'Анализировать QA — разборы', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  assert.equal(await page.getByLabel('Лимит комментариев', { exact: true }).inputValue(), '500');
  assert.equal(
    await page
      .getByRole('group', { name: 'Период сбора', exact: true })
      .getByRole('button', { name: '90 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.screenshot({ path: '.qa/sources/configured-desktop.png', fullPage: true });
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Page overflow at ${width}`,
    );
    await page.getByRole('button', { name: 'Настроить Вопросы к видео', exact: true }).click();
    assert.ok(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      `Dialog overflow at ${width}`,
    );
    if (width === 390) await page.screenshot({ path: '.qa/sources/mobile-dialog.png' });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    if (width === 390)
      await page.screenshot({ path: '.qa/sources/configured-mobile.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  const second = await context.newPage();
  await second.goto(origin + '/sources');
  await ready(second);
  await second.getByRole('switch', { name: 'Анализировать QA — разборы', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Анализировать QA — разборы"]')
        .getAttribute('aria-checked') === 'true',
  );
  await second.close();
  let serverAccounts = [
    {
      id: 'tg-account',
      platform: 'telegram',
      displayName: 'Егор',
      handle: '@egor',
      status: 'connected',
    },
    { id: 'tt-expired', platform: 'tiktok', displayName: 'E-QA', status: 'expired' },
  ];
  await page.route('**/api/connections', (route) =>
    route.fulfill({
      json: {
        version: 1,
        accounts: serverAccounts,
        available: ['telegram'],
        csrfToken: 'source-test-csrf-token',
      },
    }),
  );
  await page.getByRole('button', { name: 'Проверить подключения', exact: true }).click();
  await page.getByText('Сессия истекла', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Настроить QA — разборы', exact: true }).click();
  await select('Аккаунт источника', 'Егор');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.match(
    await page.getByRole('article', { name: 'Источник QA — разборы', exact: true }).innerText(),
    /Егор/,
  );
  await page.route('**/api/connections/authorize', async (route) => {
    assert.equal(route.request().method(), 'POST');
    assert.equal(route.request().headers()['x-csrf-token'], 'source-test-csrf-token');
    assert.deepEqual(route.request().postDataJSON(), {
      platform: 'telegram',
      returnTo: '/sources',
    });
    await route.fulfill({ json: { url: 'https://untrusted.example/collect-session' } });
  });
  await page
    .locator('.sp-account')
    .first()
    .getByRole('button', { name: 'Ещё аккаунт', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(new URL(page.url()).pathname, '/sources');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.route('**/api/connections/accounts/tg-account', async (route) => {
    assert.equal(route.request().method(), 'DELETE');
    assert.equal(route.request().headers()['x-csrf-token'], 'source-test-csrf-token');
    serverAccounts = serverAccounts.filter((account) => account.id !== 'tg-account');
    await route.fulfill({ status: 204 });
  });
  await page.getByRole('button', { name: 'Отключить Егор', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отключить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Отключить Егор"]'));
  assert.equal(await page.locator('.sp-source-row').count(), 2);
  await page.getByRole('button', { name: 'Удалить источник QA — разборы', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить источник', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.sp-source-row').count(), 1);
  await page.evaluate(() => (window.sourcesNavigationMarker = true));
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await page.getByRole('heading', { name: 'Аналитика', level: 1, exact: true }).waitFor();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'Источники', exact: true }).click();
  await ready();
  assert.equal(await page.evaluate(() => window.sourcesNavigationMarker), true);
  assert.equal(await page.locator('.sp-source-row').count(), 1);

  // «Стыковка»: штекер к ядру, добавление по ссылке, параметры площадки
  await page.goto(origin + '/sources?layout=dock');
  await ready();
  const jack = await page.locator('.dk-jack[data-platform="tiktok"]').boundingBox();
  const core = await page.locator('.dk-core').boundingBox();
  await page.mouse.move(jack.x + jack.width / 2, jack.y + jack.height / 2);
  await page.mouse.down();
  await page.mouse.move(core.x, core.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Настроить TikTok"][aria-pressed="true"]'),
  );
  assert.equal(new URL(page.url()).searchParams.get('platform'), 'tiktok');
  await page.locator('button.dk-step-head', { hasText: 'Источники' }).click();
  const link = page.getByLabel('Ссылка на источник TikTok', { exact: true });
  await link.fill('tiktok.com/@qa.daily');
  assert.match(await page.locator('.dk-format[data-detected="true"]').innerText(), /Профиль/);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('switch', { name: 'Анализировать @qa.daily', exact: true }).waitFor();
  await page.locator('button.dk-step-head', { hasText: 'Параметры' }).click();
  await segment('Параметры TikTok', 'Только TikTok');
  await segment('Период сбора площадки', '7 дней');
  await page.getByRole('switch', { name: 'Собирать ответы на комментарии', exact: true }).click();
  await page.getByRole('button', { name: 'Настроить Telegram', exact: true }).click();
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get('platform') === 'telegram',
  );
  await page.reload();
  await ready();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('e-content-sources-v1')),
  );
  assert.equal(stored.platforms.tiktok.custom.period, '7');
  assert.equal(stored.platforms.tiktok.replies, false);
  assert.equal(stored.platforms.telegram.custom, null);
  assert.equal(stored.settings.period, '90');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Dock overflow at ${width}`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'Sources passed: URL validation, duplicate detection, account-unavailable/connected/expired states, scoped account assignment, CSRF requests, unsafe auth redirect rejected, confirmed disconnect, CRUD, selection, settings persistence, cross-tab updates, SPA navigation, 6 responsive widths, dock drag-to-connect, inline add and per-platform parameters.',
  );
} finally {
  await browser.close();
}
