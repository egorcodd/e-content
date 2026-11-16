import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  validateConnectionIdentity,
  normalizeConnectionCode,
  validatePreviewCode,
} from '../src/features/sources/connection-validation.ts';

assert.equal(validateConnectionIdentity('telegram', '+7 (900) 000-00-00').value, '+79000000000');
for (const value of [
  '',
  ' ',
  '79000000000',
  '+7oops9000000000',
  '+0123456789',
  '+1234567890123456',
])
  assert.ok(validateConnectionIdentity('telegram', value).error, value);
assert.equal(validateConnectionIdentity('tiktok', ' egor_qa ').value, '@egor_qa');
for (const value of [
  '',
  ' ',
  '@',
  '@@egor_qa',
  'bad name',
  'тест',
  'https://tiktok.com/@egor_qa',
  'a'.repeat(25),
])
  assert.ok(validateConnectionIdentity('tiktok', value).error, value);
for (const value of ['', '123', '1234567', 'abc123456', '111111'])
  assert.ok(validatePreviewCode(value), value);
assert.equal(normalizeConnectionCode('12 34 56'), '123456');
assert.equal(validatePreviewCode('12 34 56'), '');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [],
    mutations = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/connections') && request.method() !== 'GET')
      mutations.push(request.url());
  });
  await page.addInitScript(() => {
    window.nativeValidationEvents = 0;
    document.addEventListener('invalid', () => window.nativeValidationEvents++, true);
  });
  await page.goto(
    (process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources?platform=telegram',
  );
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  const identity = page.getByLabel('Номер для примера Telegram', { exact: true });
  const submitIdentity = page.getByRole('button', { name: 'Получить код', exact: true });
  const expectError = async (input, message) => {
    await page.getByRole('alert').getByText(message, { exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    const id = await input.getAttribute('aria-describedby');
    assert.ok(id);
    assert.equal(
      await page.evaluate((id) => document.getElementById(id)?.textContent, id),
      message,
    );
    assert.ok(
      await input.evaluate((element) => element === document.activeElement),
      'Invalid field should receive focus',
    );
  };
  assert.equal(await page.getByText('Без отправки данных', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Пример входа', { exact: true }).count(), 0);
  await identity.fill('');
  await submitIdentity.click();
  await expectError(identity, 'Введите номер телефона.');
  await identity.fill('+7abc9000000000');
  await submitIdentity.click();
  await expectError(identity, 'Укажите номер с кодом страны: + и от 8 до 15 цифр.');
  await identity.fill('+7 (900) 000-00-00');
  assert.equal(await identity.getAttribute('aria-invalid'), 'false');
  await submitIdentity.click();
  const code = page.getByLabel('Код подтверждения примера', { exact: true });
  await code.waitFor();
  assert.equal(await page.locator('.pc-form .pc-title > svg').count(), 0);
  const confirm = page.getByRole('button', { name: 'Подтвердить вход', exact: true });
  await confirm.click();
  await expectError(code, 'Введите код подтверждения.');
  for (const value of ['123', '1234567', 'abc123456']) {
    await code.fill(value);
    await confirm.click();
    await expectError(code, 'Код должен состоять из 6 цифр.');
  }
  await code.fill('111111');
  await confirm.click();
  await expectError(code, 'Неверный код. Проверьте и попробуйте ещё раз.');
  fs.mkdirSync('.qa/source-validation', { recursive: true });
  await page.locator('.pc-flow').screenshot({ path: '.qa/source-validation/wrong-code.png' });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    );
  }
  await code.fill('12 34 56');
  assert.equal(await code.inputValue(), '123456');
  assert.equal(await code.getAttribute('aria-invalid'), 'false');
  await confirm.click();
  await page.getByRole('heading', { name: 'Доступ для сбора', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Выбрать TikTok', exact: true }).click();
  const profile = page.getByLabel('Профиль для примера TikTok', { exact: true });
  await profile.waitFor();
  const proceed = page.getByRole('button', { name: 'Продолжить', exact: true });
  await profile.fill(' ');
  await proceed.click();
  await expectError(profile, 'Введите имя профиля TikTok.');
  await profile.fill('bad name');
  await proceed.click();
  await expectError(profile, 'Имя профиля: 2–24 латинских буквы, цифры, точки или подчёркивания.');
  await profile.fill(' egor_qa ');
  await proceed.click();
  await page.getByRole('heading', { name: 'Подтвердите вход в TikTok', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.nativeValidationEvents),
    0,
    'Native browser validation must not run',
  );
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
  console.log(
    'Connection validation passed: empty/invalid identity, code length/characters/mismatch, correction, paste, focus, linked errors, no native popups, 3 widths and no account mutations.',
  );
} finally {
  await browser.close();
}
