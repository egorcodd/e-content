import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { validateConnectionIdentity } from '../src/features/sources/connection-validation.ts';
import { telegramFixture, enterApplication } from './support/telegram-api.mjs';
assert.equal(validateConnectionIdentity('telegram', '+7 (900) 000-00-00').value, '+79000000000');
for (const value of ['', '79000000000', '+7oops9000000000', '+0123456789', '+1234567890123456'])
  assert.ok(validateConnectionIdentity('telegram', value).error);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const fixture = await telegramFixture(page, { twoFA: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.nativeValidationEvents = 0;
    document.addEventListener('invalid', () => window.nativeValidationEvents++, true);
  });
  await page.goto(
    (process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/sources?platform=telegram',
  );
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByText('Проверьте api_id и api_hash приложения.', { exact: true }).waitFor();
  assert.equal(fixture.requests.filter((r) => r.path === '/api/telegram/configure').length, 0);
  await enterApplication(page);
  await page.getByLabel('Номер Telegram', { exact: true }).fill('bad');
  await page.getByRole('button', { name: 'Получить код', exact: true }).click();
  assert.equal(
    await page.getByLabel('Номер Telegram', { exact: true }).getAttribute('aria-invalid'),
    'true',
  );
  assert.equal(fixture.requests.filter((r) => r.path === '/api/telegram/code').length, 0);
  await page.getByLabel('Номер Telegram', { exact: true }).fill('+79000000000');
  await page.getByRole('button', { name: 'Получить код', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByText('Введите код подтверждения.', { exact: true }).waitFor();
  await page.getByLabel('Код Telegram', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByText('Введите код из 5 цифр.', { exact: true }).waitFor();
  assert.equal(fixture.requests.filter((r) => r.path === '/api/telegram/confirm').length, 0);
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByLabel('Код Telegram', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByLabel('Пароль Telegram 2FA', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByText('Неверный пароль двухэтапной защиты.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Пароль Telegram 2FA', { exact: true }).inputValue(), '');
  await page.getByLabel('Пароль Telegram 2FA', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('heading', { name: 'Telegram подключён', exact: true }).waitFor();
  assert.equal(fixture.requests.filter((r) => r.path === '/api/telegram/code').length, 1);
  assert.equal(await page.evaluate(() => window.nativeValidationEvents), 0);
  assert.ok(
    !(await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('fixture-password'))),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Telegram validation passed: setup, phone, dynamic code length, server errors, reload without resend, 2FA and no persisted password.',
  );
} finally {
  await browser.close();
}
