import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture } from '../server/tests/fixtures.ts';

const f = await fixture();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  f.gateway.delay = 200;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const original = new URL(route.request().url());
    const response = await route.fetch({ url: f.base + original.pathname + original.search });
    await route.fulfill({ response });
  });
  const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
  await page.addInitScript(() => localStorage.setItem('e-content-sample-data', 'off'));
  await page.goto(origin + '/sources?platform=telegram');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByLabel('Telegram api_id', { exact: true }).fill('123456');
  await page.getByLabel('Telegram api_hash', { exact: true }).fill('a'.repeat(32));
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Номер Telegram', { exact: true }).fill('+79000000000');
  await page.getByRole('button', { name: 'Получить код', exact: true }).click();
  await page.getByLabel('Код Telegram', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await page.getByRole('heading', { name: 'Telegram подключён', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Выбрать источники', exact: true }).click();
  await page
    .getByLabel('Ссылка на источник Telegram', { exact: true })
    .fill('t.me/fixture_channel');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('switch', { name: 'Анализировать fixture_channel', exact: true }).waitFor();
  await page.goto(origin + '/');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  assert.ok(f.app.engine.busy, 'Closing the panel must not stop the worker');
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  for (let i = 0; i < 100 && f.app.store.latest()?.status === 'running'; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const run = f.app.store.latest();
  assert.equal(run.status, 'completed');
  await page.getByRole('button', { name: 'Открыть участок Ядро', exact: true }).click();
  await page.locator('.wg-real-counts').getByText('Комментарии', { exact: false }).waitFor();
  assert.match(await page.locator('.wg-real-counts').textContent(), /Комментарии\s*3/);
  assert.equal(
    f.app.store.db.prepare('SELECT count(*) AS n FROM runs').get().n,
    1,
    'Reload must not launch another cycle',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт', exact: true }).click();
  assert.match((await download).suggestedFilename(), /^telegram-/);
  await page.goto(origin + '/materials');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page.getByText('Как диагностировать падения автотестов на CI', { exact: true }).waitFor();
  const calls = f.gateway.calls.length;
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  assert.equal(f.gateway.calls.length, calls, 'Opening the library must never scan Telegram again');
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Удалить Как диагностировать падения автотестов на CI',
      exact: true,
    })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.goto(origin + '/');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.goto(origin + '/materials?view=all');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  assert.equal(
    await page.getByText('Как диагностировать падения автотестов на CI', { exact: true }).count(),
    0,
    'A previously imported run must not restore a deliberately deleted idea',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Telegram workshop passed: browser login through the backend, source selection, real worker, close/reload recovery, single run, Markdown export and evidence-backed library import.',
  );
} finally {
  await browser.close();
  await f.close();
}
