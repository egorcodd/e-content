import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const waitReady = () => page.locator('.app-loader').waitFor({ state: 'detached' });
const section = (name) => page.getByRole('link', { name, exact: true });
try {
  let releaseScene;
  const sceneGate = new Promise((resolve) => {
    releaseScene = resolve;
  });
  let sceneRequests = 0;
  let releaseEntry;
  const entryGate = new Promise((resolve) => {
    releaseEntry = resolve;
  });
  await page.route(/\/src\/main\.tsx/, async (route) => {
    await entryGate;
    await route.continue();
  });
  await page.route(/\/src\/features\/workshop\/IsoView\.tsx/, async (route) => {
    sceneRequests++;
    await sceneGate;
    await route.continue();
  });
  const entry = page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-initial-page-title]').waitFor();
  assert.equal(await page.locator('[data-initial-page-title]').textContent(), 'Цех агентов');
  releaseEntry();
  await entry;
  await page.locator('.app-loader-name').waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.app-loader-caption').textContent(), 'Цех агентов');
  assert.equal(await page.locator('.wg-iso canvas').count(), 0);
  assert.equal(await page.getByText('Собираю сцену…', { exact: true }).count(), 0);
  fs.mkdirSync('.qa/navigation', { recursive: true });
  await page.screenshot({ path: '.qa/navigation/loading.png' });
  releaseScene();
  await waitReady();
  await page.locator('.wg-iso canvas').waitFor();
  assert.equal(await page.locator('.wg-iso-label').count(), 8);
  assert.equal(
    await page.getByRole('button', { name: 'Открыть участок Ядро', exact: true }).count(),
    1,
  );
  assert.equal(await page.getByText('Оркестратор', { exact: true }).count(), 0);
  assert.equal(sceneRequests, 1);
  await page.evaluate(() => {
    window.navigationDocumentMarker = 'preserved';
  });
  let documents = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  });

  let releaseAnalytics;
  const analyticsGate = new Promise((resolve) => {
    releaseAnalytics = resolve;
  });
  let analyticsRequests = 0;
  let onIntent;
  const intent = new Promise((resolve) => {
    onIntent = resolve;
  });
  await page.route(/\/src\/pages\/analytics\/AnalyticsPage\.tsx/, async (route) => {
    analyticsRequests++;
    onIntent();
    await analyticsGate;
    await route.continue();
  });
  await section('Аналитика').focus();
  await intent;
  assert.equal(analyticsRequests, 1, 'Keyboard focus must preload the destination');
  assert.equal(await page.locator('.app-loader').count(), 0, 'Prefetch must not show a loader');
  await section('Аналитика').click();
  await page.locator('.app-loader').waitFor();
  assert.equal(
    new URL(page.url()).pathname,
    '/',
    'Keep the current page until its destination has loaded',
  );
  assert.equal(await page.locator('.wg-iso canvas').count(), 1);
  releaseAnalytics();
  await waitReady();
  await page.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/analytics');
  assert.equal(await page.evaluate(() => window.navigationDocumentMarker), 'preserved');
  assert.equal(await page.locator('.app-sidebar').getAttribute('data-expandable'), 'false');
  await page
    .getByRole('group', { name: 'Период аналитики', exact: true })
    .getByRole('button', { name: '7 дней', exact: true })
    .click();

  await page.evaluate(() => {
    window.loaderAppearances = 0;
    window.loaderObserver = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('.app-loader-cover') || node.querySelector('.app-loader-cover'))
          )
            window.loaderAppearances++;
        }
    });
    window.loaderObserver.observe(document.body, { childList: true, subtree: true });
  });
  await section('Цех агентов').click();
  await waitReady();
  await page.locator('.wg-iso canvas').waitFor();
  assert.equal(sceneRequests, 1, 'Return must reuse the loaded 3D module');
  await page.goBack();
  await waitReady();
  await page.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('period'), '7');
  assert.equal(
    await page
      .getByRole('group', { name: 'Период аналитики', exact: true })
      .getByRole('button', { name: '7 дней', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.goForward();
  await waitReady();
  await page.locator('.wg-iso canvas').waitFor();
  assert.equal(documents, 0, 'Internal navigation must keep the document');
  assert.equal(await page.evaluate(() => window.navigationDocumentMarker), 'preserved');
  await page.evaluate(() => window.loaderObserver.disconnect());
  assert.ok(
    (await page.evaluate(() => window.loaderAppearances)) <= 1,
    'Warm navigation repeatedly flashes the loader',
  );

  const failurePage = await browser.newPage();
  await failurePage.route(/\/src\/pages\/analytics\/AnalyticsPage\.tsx/, (route) => route.abort());
  await failurePage.goto(origin + '/analytics', { waitUntil: 'domcontentloaded' });
  await failurePage.getByRole('alert').waitFor();
  assert.equal(
    await failurePage.getByRole('button', { name: 'Повторить', exact: true }).isVisible(),
    true,
  );
  await failurePage.unroute(/\/src\/pages\/analytics\/AnalyticsPage\.tsx/);
  await failurePage.getByRole('button', { name: 'Повторить', exact: true }).click();
  await failurePage.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
  await failurePage.locator('.app-loader').waitFor({ state: 'detached' });
  await failurePage.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await section('Аналитика').click();
  await waitReady();
  assert.equal(documents, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Navigation checks passed: first-frame loader, intent prefetch, no document reload, cached 3D, back/forward with filters, restrained warm loader, error/retry and reduced motion.',
  );
} finally {
  await browser.close();
}
