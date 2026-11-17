import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../server/tests/fixtures.ts';

let slowRefresh = false;
const transport = {
  async get(path) {
    if (path.startsWith('/tiktok/user/detail'))
      return {
        userInfo: {
          user: {
            id: '9000000000000000001',
            uniqueId: 'fixture_user',
            nickname: 'Fixture creator',
            secUid: 'fixture-sec',
          },
        },
      };
    if (slowRefresh) await delay(600);
    const firstPage = path.endsWith('cursor=0');
    const start = firstPage ? 0 : 25;
    return {
      itemList: Array.from({ length: firstPage ? 25 : 9 }, (_, index) => {
        const i = start + index;
        return {
          id: String(7708022666925559054n - BigInt(i)),
          desc: 'Вопросы о тестировании и работе на CI',
          author: { uniqueId: 'fixture_user' },
          createTime: Math.floor(Date.now() / 1000) - i * 86400,
          stats: { playCount: 10000 - i * 100, commentCount: 15 },
        };
      }),
      hasMore: firstPage,
      cursor: 25,
    };
  },
  async close() {},
};
const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: f.base + u.pathname + u.search });
    await route.fulfill({ response });
  });
  await page.goto('http://127.0.0.1:5186/sources?platform=tiktok');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  const field = page.getByLabel('Имя или ссылка на профиль');
  await field.fill('https://example.com/@someone');
  await page.getByRole('button', { name: 'Подключить профиль', exact: true }).click();
  await page.locator('[role=alert]').filter({ hasText: 'Для TikTok нужна ссылка' }).waitFor();
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  await field.fill('@fixture_user');
  await page.getByRole('button', { name: 'Подключить профиль', exact: true }).click();
  await page.getByRole('heading', { name: 'Ролики профиля', exact: true }).waitFor();
  const refresh = page.getByRole('button', { name: 'Обновить список роликов', exact: true });
  assert.equal((await refresh.textContent()).trim(), '');
  await page.getByText('Найдено 20 из 20 роликов', { exact: true }).waitFor();
  assert.equal(await page.locator('.tt-video-list li').count(), 5);
  await page.getByRole('button', { name: 'Показать ещё 5', exact: true }).click();
  assert.equal(await page.locator('.tt-video-list li').count(), 10);
  assert.equal(
    await page.locator('.tt-video-list').evaluate((el) => getComputedStyle(el).overflowY),
    'visible',
  );
  const latest = page.getByRole('textbox', { name: 'Последние ролики', exact: true });
  const comments = page.getByRole('textbox', { name: 'Комментариев на ролик', exact: true });
  const latestRange = page.getByRole('slider', { name: 'Последние ролики', exact: true });
  const commentsRange = page.getByRole('slider', { name: 'Комментариев на ролик', exact: true });
  const apply = page.getByRole('button', { name: 'Применить к сбору', exact: true });
  await latest.fill('101');
  await apply.click();
  await page.getByText('Допустимо от 1 до 100.', { exact: true }).waitFor();
  assert.equal(await latest.getAttribute('aria-invalid'), 'true');
  assert.equal(f.app.tiktok.state().selection.latest, 20);
  await latestRange.press('ArrowRight');
  assert.equal(await latest.inputValue(), '21');
  assert.equal(await latest.getAttribute('aria-invalid'), 'false');
  await latest.fill('30');
  assert.equal(await latestRange.inputValue(), '30');
  await comments.fill('1.5');
  await apply.click();
  await page.getByText('Введите целое число.', { exact: true }).waitFor();
  assert.equal(f.app.tiktok.state().selection.commentsPerVideo, 100);
  await comments.fill('20');
  assert.equal(await commentsRange.inputValue(), '20');
  const warning = () =>
    commentsRange.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--range-warning').trim(),
    );
  assert.equal(await warning(), '0%');
  await comments.fill('9000');
  assert.ok(parseFloat(await warning()) > 0);
  await comments.fill('20');
  assert.equal(await warning(), '0%');
  assert.equal(
    await comments.evaluate((element) => getComputedStyle(element).outlineStyle),
    'none',
  );
  assert.equal(f.app.tiktok.state().selection.latest, 20);
  slowRefresh = true;
  await page.getByRole('button', { name: 'Применить к сбору', exact: true }).click();
  await page.getByText('Обновляем выборку · до 30 роликов', { exact: true }).waitFor();
  await page.getByText('Найдено 30 из 30 роликов', { exact: true }).waitFor();
  await page.getByText(/до 20 комментариев на каждый/).waitFor();
  assert.equal(f.app.tiktok.state().videos.length, 30);
  const include = page.getByRole('switch', { name: 'Анализировать свои ролики TikTok' });
  await include.click();
  await page.getByText('Цех пропустит этот профиль.', { exact: true }).waitFor();
  assert.equal(f.app.tiktok.state().selection.latest, 30);
  assert.equal(f.app.tiktok.state().selection.commentsPerVideo, 20);
  assert.equal(f.app.tiktok.state().selection.enabled, false);
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  const profileButton = page
    .locator('.pc-actions')
    .getByRole('button', { name: 'Ролики для цеха', exact: true });
  await profileButton.waitFor();
  assert.equal(await profileButton.locator('svg').count(), 0);
  const data = page.getByRole('complementary', { name: 'Параметры TikTok', exact: true });
  const reset = data.getByRole('button', { name: 'Вернуть общие настройки TikTok', exact: true });
  await data.getByRole('button', { name: '90 дней', exact: true }).click();
  await reset.waitFor();
  assert.equal(await data.locator('.platform-setting-reset').count(), 1);
  assert.equal(await data.locator('.platform-settings-heading .platform-setting-reset').count(), 1);
  await reset.click();
  assert.equal(
    await data.getByRole('button', { name: '30 дней', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('.dk-step-head').filter({ hasText: 'Ролики для цеха' }).click();
  assert.equal(await latest.inputValue(), '30');
  assert.equal(await comments.inputValue(), '20');
  assert.equal(await page.getByRole('button', { name: 'Последние 10', exact: true }).count(), 0);
  assert.equal(await page.getByText('Получить код подключения', { exact: true }).count(), 0);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
      false,
      `Overflow at ${width}`,
    );
    await page.screenshot({ path: `.qa/tiktok-native-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Native TikTok UI: profile validation, separate video/comment limits, persistence after reload and responsive widths passed.',
  );
} finally {
  await browser.close();
  await f.close();
}
