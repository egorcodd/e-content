import { telegramFixture, enterApplication } from './support/telegram-api.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const fixture = await telegramFixture(page);
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const errors = [],
  authorizationRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.url().includes('/api/connections') && request.method() !== 'GET')
    authorizationRequests.push(request.url());
});
const choose = async (name) => {
  await page.getByRole('button', { name: `Выбрать ${name}`, exact: true }).click();
  await page.getByRole('region', { name: `Пошаговое подключение ${name}`, exact: true }).waitFor();
  await page.waitForTimeout(250);
};
const sliderValue = async (label, value) =>
  page.getByRole('slider', { name: label, exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
      element,
      String(value),
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
try {
  await page.goto(origin + '/sources?layout=modules&platform=telegram');
  await page.getByRole('heading', { name: 'Источники', exact: true, level: 1 }).waitFor();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  assert.equal(
    await page.getByRole('group', { name: 'Вариант подключения источников', exact: true }).count(),
    0,
  );
  assert.equal(new URL(page.url()).searchParams.has('layout'), false);
  assert.equal(
    await page.locator('.dk-stage, .cv-settings-summary, .sp-browser-footer').count(),
    0,
  );
  assert.equal(await page.getByRole('link', { name: 'К цеху', exact: true }).count(), 0);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('.pc-form .pc-title > svg').count(), 0);
  assert.equal(await page.locator('.cm-disclosure > span svg').count(), 0);
  const parameters = page.getByRole('complementary', { name: 'Параметры Telegram', exact: true });
  assert.ok((await parameters.boundingBox()).height <= 530, 'Primary parameters must stay compact');
  const common = page.getByRole('region', { name: 'Общие настройки', exact: true });
  assert.equal(await common.getByRole('slider').count(), 0, 'Shared parameters start collapsed');
  await enterApplication(page);
  await page.getByRole('button', { name: 'Получить код', exact: true }).click();
  await page.getByLabel('Код Telegram', { exact: true }).fill('99999');
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByText('Неверный код подтверждения.', { exact: true }).waitFor();
  await choose('TikTok');
  await page.getByRole('heading', { name: 'Вход в TikTok', exact: true }).waitFor();
  await choose('Telegram');
  await page.getByLabel('Код Telegram', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByRole('heading', { name: 'Telegram подключён', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Выбрать источники', exact: true }).click();
  await page.getByLabel('Ссылка на источник Telegram', { exact: true }).fill('t.me/qualityqa');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('switch', { name: 'Анализировать qualityqa', exact: true }).waitFor();
  const global = common;
  await common.getByRole('button', { name: /^Общие настройки/ }).click();
  await common.getByRole('button', { name: /^Общий объём сбора/ }).click();
  assert.equal(
    await common.getByRole('slider', { name: /Запрос/, includeHidden: true }).count(),
    0,
  );
  await sliderValue('Всего публикаций', 200);
  await global.getByRole('slider', { name: 'Лимит комментариев', exact: true }).focus();
  await page.keyboard.press('Home');
  assert.equal(
    await global.getByRole('slider', { name: 'Лимит комментариев', exact: true }).inputValue(),
    '0',
  );
  assert.equal(
    await global
      .getByRole('slider', { name: 'Лимит комментариев', exact: true })
      .getAttribute('aria-valuetext'),
    'Не собирать',
  );
  await global.getByRole('button', { name: 'Сохранить параметры', exact: true }).click();
  assert.equal(
    await parameters.getByRole('slider', { name: 'Комментарии', exact: true }).inputValue(),
    '0',
  );
  await sliderValue('Комментарии', 250);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('e-content-sources-v1')),
  );
  assert.equal(stored.settings.maxComments, 0);
  assert.equal(stored.runLimits.maxPublications, 200);
  assert.equal(
    stored.runLimits.maxRequests,
    1000,
    'Editing data limits preserves the internal request ceiling',
  );
  assert.equal(stored.platforms.telegram.custom.maxComments, 250);
  assert.deepEqual(Object.keys(stored.platforms.telegram.custom), ['maxComments']);
  assert.equal(stored.sources.length, 1);
  await global.getByRole('button', { name: '7 дней', exact: true }).click();
  await global.getByRole('button', { name: 'Сохранить параметры', exact: true }).click();
  assert.equal(
    await page
      .getByRole('group', { name: 'Период анализа Telegram', exact: true })
      .getByRole('button', { name: '7 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.getByRole('slider', { name: 'Комментарии', exact: true }).inputValue(),
    '250',
  );
  await page
    .getByRole('button', { name: 'Сбросить лимит комментариев для Telegram', exact: true })
    .click();
  assert.equal(
    await page.getByRole('slider', { name: 'Комментарии', exact: true }).inputValue(),
    '0',
  );
  await sliderValue('Комментарии', 250);
  await parameters.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  const textFilter = parameters.getByRole('slider', {
    name: 'Минимальная длина реплики',
    exact: true,
  });
  await textFilter.waitFor();
  await parameters.getByRole('switch', { name: 'Собирать: Комментарии', exact: true }).click();
  assert.equal(
    await textFilter.isDisabled(),
    true,
    'Comment filters must be inactive when comments are off',
  );
  await parameters.getByRole('switch', { name: 'Собирать: Комментарии', exact: true }).click();
  await parameters.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать TikTok', exact: true }).click();
  const tiktokParameters = page.getByRole('complementary', {
    name: 'Параметры TikTok',
    exact: true,
  });
  assert.equal(
    await tiktokParameters.getByRole('slider', { name: 'Комментарии', exact: true }).inputValue(),
    '0',
  );
  await choose('Telegram');
  assert.equal(
    await parameters.getByRole('slider', { name: 'Комментарии', exact: true }).inputValue(),
    '250',
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('preview:')),
    false,
  );
  await choose('Telegram');
  await page.getByRole('heading', { name: 'Telegram подключён', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Настройка Telegram', exact: true }).click();
  assert.equal(
    await page.locator('#module-setup-content').evaluate((element) => element.inert),
    true,
  );
  await page.getByRole('button', { name: 'Настройка Telegram', exact: true }).click();
  await page.getByRole('heading', { name: 'Telegram подключён', exact: true }).waitFor();
  for (const width of [1600, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(130);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
    assert.equal(await page.locator('dialog[open]').count(), 0);
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  fs.mkdirSync('.qa/module-setup', { recursive: true });
  await page.screenshot({ path: '.qa/module-setup/verified.png', fullPage: true });
  assert.equal(
    fixture.requests.filter((request) => request.path === '/api/telegram/code').length,
    1,
  );
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отключить', exact: true }).click();
  await page.getByRole('button', { name: 'Получить код', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('switch', { name: 'Анализировать qualityqa', exact: true }).count(),
    0,
    'Account pane should stay open after disconnect',
  );
  const reduced = await browser.newPage({
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 950 },
  });
  await telegramFixture(reduced);
  await reduced.goto(origin + '/sources?layout=modules&platform=tiktok');
  await reduced.locator('.app-loader').waitFor({ state: 'detached' });
  await reduced.getByRole('heading', { name: 'Вход в TikTok', exact: true }).waitFor();
  assert.equal(await reduced.getByRole('slider', { name: 'Комментарии', exact: true }).count(), 1);
  await reduced.close();
  assert.deepEqual(errors, []);
  console.log(
    'Module setup passed: real API contract with intercepted test responses, dynamic Telegram login, source selection, isolated settings, disclosure, reduced motion and 5 widths.',
  );
} finally {
  await browser.close();
}
