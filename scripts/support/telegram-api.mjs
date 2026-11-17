export async function telegramFixture(page, { twoFA = false } = {}) {
  let auth = { phase: 'setup' },
    accounts = [];
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    requests.push({ path, method: request.method(), body });
    let result = {},
      status = 200;
    const fail = (code, message) => {
      result = { error: { code, message } };
      status = 400;
    };
    if (path === '/api/connections')
      result = {
        version: 1,
        available: ['telegram'],
        accounts,
        csrfToken: 'fixture-csrf-token-1234567890',
      };
    else if (path === '/api/telegram/auth') result = auth;
    else if (path === '/api/telegram/configure') {
      auth = { phase: 'phone' };
      result = auth;
    } else if (path === '/api/telegram/code') {
      auth = { phase: 'code', phone: body.phone, codeLength: 5, delivery: 'telegram' };
      result = auth;
    } else if (path === '/api/telegram/confirm') {
      if (body.code !== '12345') fail('PHONE_CODE_INVALID', 'Неверный код подтверждения.');
      else if (twoFA) {
        auth = { phase: 'password' };
        result = auth;
      } else {
        auth = { phase: 'connected' };
        accounts = [
          {
            id: 'telegram:7',
            displayName: 'Fixture User',
            handle: '@fixture_user',
            platform: 'telegram',
            status: 'connected',
          },
        ];
        result = auth;
      }
    } else if (path === '/api/telegram/password') {
      if (body.password !== 'fixture-password')
        fail('PASSWORD_HASH_INVALID', 'Неверный пароль двухэтапной защиты.');
      else {
        auth = { phase: 'connected' };
        accounts = [
          {
            id: 'telegram:7',
            displayName: 'Fixture User',
            handle: '@fixture_user',
            platform: 'telegram',
            status: 'connected',
          },
        ];
        result = auth;
      }
    } else if (path === '/api/telegram/cancel') {
      auth = { phase: 'phone' };
      result = auth;
    } else if (path === '/api/telegram/reset-app') {
      auth = { phase: 'setup' };
      result = auth;
    } else if (path.startsWith('/api/connections/accounts/')) {
      accounts = [];
      auth = { phase: 'phone' };
    } else if (path === '/api/collection/latest') result = { run: null };
    else return route.fallback();
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return { requests };
}
export async function enterApplication(page) {
  await page.getByLabel('Telegram api_id', { exact: true }).fill('123456');
  await page.getByLabel('Telegram api_hash', { exact: true }).fill('a'.repeat(32));
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Номер Telegram', { exact: true }).fill('+79000000000');
}
