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
  await data.getByRole('button', { name: 'За всё время', exact: true }).click();
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
  await page.addInitScript(() => localStorage.setItem('e-content-sample-data', 'off'));
  const runId = 'fixture-live-materials';
  const idea = {
    id: 'fixture-live-idea',
    title: 'Как проверить обновление подборки во время сбора',
    body: 'Разобрать повторяющийся вопрос подписчиков.',
    format: 'video',
    source: 'tiktok',
    evidence: [],
  };
  const evidence = (id) => ({
    id,
    source: 'tiktok',
    kind: 'comment',
    text: 'Вопрос из обсуждения',
    url: 'https://www.tiktok.com/@fixture_user/video/7708022666925559054',
  });
  await page.route('**/api/collection/latest', (route) =>
    route.fulfill({
      json: {
        ideaAnalysisVersion: 7,
        run: {
          id: runId,
          status: 'running',
          ideaAnalysisVersion: 7,
          ideaRevision: idea.evidence.length,
          updatedAt: new Date().toISOString(),
          counts: { posts: 1, comments: idea.evidence.length, ideas: idea.evidence.length ? 1 : 0 },
        },
      },
    }),
  );
  await page.route('**/api/collection/runs/fixture-live-materials/ideas?*', (route) =>
    route.fulfill({ json: { items: [idea] } }),
  );
  await page.goto('http://127.0.0.1:5186/materials');
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  idea.evidence.push(evidence('reply-a'), evidence('reply-b'));
  await page.getByText(idea.title, { exact: true }).waitFor();
  await page.evaluate(async (id) => {
    const { readMaterial, saveMaterial } = await import('/src/features/materials/repository.ts');
    const item = await readMaterial(id);
    await saveMaterial({ ...item, favorite: true }, item.revision);
  }, idea.id);
  idea.evidence.push(evidence('reply-c'));
  await page.waitForFunction(async (id) => {
    const { readMaterial } = await import('/src/features/materials/repository.ts');
    const item = await readMaterial(id);
    return item?.favorite && item.evidence.length === 3;
  }, idea.id);
  assert.equal(await page.getByText(idea.title, { exact: true }).count(), 1);
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const workshop = {
    id: 'fixture-paused-tiktok',
    status: 'running',
    active: 'tiktok',
    done: [],
    steps: { tiktok: 1 },
    events: [],
    skipped: ['telegram'],
    counts: { posts: 20, comments: 150, requests: 25, ideas: 8 },
    updatedAt: new Date().toISOString(),
    sources: {
      profile: {
        platform: 'tiktok',
        status: 'reading',
        videos: { selected: 20, processed: 8 },
        comments: 150,
        url: 'https://www.tiktok.com/@fixture_user',
        retry: { at: retryAt, attempt: 2 },
      },
    },
  };
  await page.route('**/api/collection/latest', (route) =>
    route.fulfill({ json: { run: workshop } }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5186/');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Открыть участок Ядро', exact: true }).click();
  const core = page.getByRole('region', { name: 'Процесс Ядро' });
  await core.getByText(/Следующая попытка автоматически/).waitFor();
  assert.equal(await core.locator('time').getAttribute('datetime'), retryAt);
  await core.getByText('Ролики с завершённым сбором: 8 из 20').waitFor();
  assert.equal(
    await core.getByRole('link', { name: 'Открыть идеи видео' }).getAttribute('href'),
    '/materials?folder=video-ideas',
  );
  workshop.status = 'partial';
  workshop.active = null;
  workshop.done = ['collector', 'ideas', 'materials', 'orchestrator'];
  workshop.failures = { tiktok: 'TikTok временно недоступен.' };
  Object.assign(workshop.sources.profile, {
    status: 'limited',
    stopCode: 'TIKTOK_DEFERRED',
    retry: undefined,
  });
  workshop.updatedAt = new Date().toISOString();
  const collect = core.getByRole('button', { name: 'Запустить весь цикл', exact: true });
  await collect.waitFor();
  await page.route('**/api/collection/runs', (route) => {
    return route.fulfill({
      status: 409,
      json: { error: { code: 'RUN_ACTIVE', message: 'Уже запущен.' } },
    });
  });
  const [full] = await Promise.all([page.waitForRequest('**/api/collection/runs'),collect.click()]);
  assert.equal(full.postDataJSON().mode,'cycle');
  await core.getByRole('alert').waitFor();
  await core.getByRole('button', {name:'Закрыть процесс'}).click();
  await page.getByRole('button', {name:'Открыть участок TikTok',exact:true}).click();
  const channel = page.getByRole('region',{name:'Процесс TikTok'});
  const [single] = await Promise.all([page.waitForRequest('**/api/collection/runs'),
    channel.getByRole('button',{name:'Собрать идеи',exact:true}).click()]);
  assert.equal(single.postDataJSON().mode,'tiktok');
  await channel.getByRole('alert').waitFor();
  // A retained checkpoint for this very same run must be visible even if the report is unchanged.
  workshop.canResumeTikTok = true;
  const resume = channel.getByRole('button', { name: 'Продолжить сбор', exact: true });
  await resume.waitFor();
  const resumeEndpoint = `**/api/collection/runs/${workshop.id}/resume`;
  await page.route(resumeEndpoint, (route) => route.fulfill({ json: { run: workshop } }));
  const [resumed] = await Promise.all([page.waitForRequest(resumeEndpoint), resume.click()]);
  assert.equal(resumed.method(), 'POST');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'Native TikTok UI passed, including live publication and evidence updates in an open library.',
  );
} finally {
  await browser.close();
  await f.close();
}
