import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture } from '../server/tests/fixtures.ts';
import { accountBrowserFixture } from '../server/tests/tiktok-account-fixture.ts';

const accountBrowser = accountBrowserFixture();
const f = await fixture({ tiktokContextFactory: accountBrowser.factory });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: f.base + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.addInitScript(() => localStorage.setItem('e-content-sample-data', 'off'));
  const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
  await page.goto(origin + '/sources?platform=tiktok');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Вход в TikTok', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /гостев.*доступ/i }).count(), 0);
  await page.getByRole('button', { name: 'Подключить TikTok', exact: true }).click();
  await page.getByRole('button', { name: 'Показать окно TikTok', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Готово', exact: true }).count(), 0);
  await accountBrowser.signIn();
  await page.getByRole('heading', { name: 'Ваши ролики', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByLabel('Ссылка на источник TikTok', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Последние 10', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Ролики для анализа TikTok"] [aria-pressed="true"]')
      ?.textContent?.includes('10'),
  );
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Выбрать ролики', exact: true }).last().click();
  await page.getByRole('heading', { name: 'Ваши ролики', exact: true }).waitFor();
  assert.equal(f.app.tiktok.state().selection.latest, 10);
  await page.goto(origin + '/');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  for (let i = 0; i < 600; i++) {
    const run = f.app.store.latest();
    if (run && run.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const run = f.app.store.latest();
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.counts.posts, 10);
  assert.equal(run.counts.comments, 10);
  assert.deepEqual(f.gateway.calls, []);
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Открыть участок TikTok', exact: true }).click();
  await page.getByText('Готово', { exact: true }).waitFor();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт', exact: true }).click();
  assert.match((await downloading).suggestedFilename(), /^e-content-/);
  await page.goto(origin + '/materials');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page.getByText('Как диагностировать падения автотестов на CI', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'TikTok account UI passed: manual login detected automatically, server selection survives reload, own videos collected without links, persistent results, library and export.',
  );
} finally {
  await browser.close();
  await f.close();
  await accountBrowser.close();
}
