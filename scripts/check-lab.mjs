import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin = (process.env.PREVIEW_URL || 'http://127.0.0.1:5186') + '/design-system';
const output = path.join(process.cwd(), '.qa', 'v2');
fs.mkdirSync(output, { recursive: true });
// CHROME_PATH lets the check run on machines without Microsoft Edge (e.g. Linux).
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: 'msedge', headless: true },
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const checks = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
async function download(click, name) {
  const event = page.waitForEvent('download');
  await click();
  const file = await event;
  if (name) assert.equal(file.suggestedFilename(), name);
  const target = path.join(output, file.suggestedFilename());
  await file.saveAs(target);
  return target;
}
async function statusColors() {
  return page.evaluate(() =>
    [...document.querySelectorAll('.ec-statuses .ec-status-icon')].map(
      (e) => getComputedStyle(e).color,
    ),
  );
}
try {
  await page.goto(origin + '/?view=components');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('heading', { name: 'Элементы интерфейса', exact: true }).waitFor();
  assert.match(await page.title(), /^e-content/);
  assert.equal(await page.locator('body').evaluate((e) => getComputedStyle(e).fontSize), '16px');
  assert.equal(
    await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily.includes('Inter')),
    true,
  );
  assert.equal(await page.locator('input[type=checkbox]').count(), 0);
  checks.push('e-content-large-typography-single-page');
  const text = await page.locator('body').innerText();
  for (const removed of [
    'Счётчики показывают результат',
    'Компоненты, данные и рабочие процессы',
    'Собираем основу',
    'Единый язык для данных',
  ])
    assert.ok(!text.includes(removed));
  assert.equal(new Set(await statusColors()).size, 5);
  checks.push('accent-status-colors-and-no-removed-copy');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.ec-skip').evaluate((e) => e === document.activeElement), true);
  await page.keyboard.press('/');
  assert.equal(
    await page
      .getByRole('textbox', { name: 'Поиск материалов', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  const focus = await page
    .getByRole('textbox', { name: 'Поиск материалов', exact: true })
    .evaluate((e) => ({
      outline: getComputedStyle(e).outlineStyle,
      shadow: getComputedStyle(e).boxShadow,
      parent: getComputedStyle(e.parentElement).borderColor,
    }));
  assert.equal(focus.outline, 'none');
  assert.equal(focus.shadow, 'none');
  checks.push('single-search-focus-and-shortcut');
  await page.getByRole('textbox', { name: 'Поиск материалов', exact: true }).fill('собеседование');
  assert.equal(await page.locator('.ec-example-results>button').count(), 0);
  await page.getByRole('textbox', { name: 'Поиск материалов', exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Период фильтра', exact: true }).click();
  await page.getByRole('option', { name: '7 дней', exact: true }).click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  assert.equal(await page.locator('.ec-example-results>button').count(), 3);
  assert.equal(await page.locator('.ec-match-count>strong').innerText(), '3');
  await page.getByRole('combobox', { name: 'Период фильтра', exact: true }).click();
  await page.getByRole('option', { name: '30 дней', exact: true }).click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  assert.equal(await page.locator('.ec-example-results>button').count(), 6);
  await page
    .getByRole('group', { name: 'Площадка примера' })
    .getByRole('button', { name: 'TikTok', exact: true })
    .click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  assert.equal(await page.locator('.ec-example-results>button').count(), 2);
  checks.push('working-filters-and-correct-result-count');
  const tokens = await download(
    () => page.getByRole('button', { name: 'Скачать токены', exact: true }).click(),
    'e-content.tokens.json',
  );
  assert.equal(JSON.parse(fs.readFileSync(tokens, 'utf8')).name, 'e-content');
  checks.push('tokens-download');
  await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Материал', exact: true })
    .getByRole('textbox', { name: 'Название материала' })
    .fill('Тестовый Markdown');
  const md = await download(
    () =>
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Скачать Markdown', exact: true })
        .click(),
    'e-content-material.md',
  );
  assert.ok(fs.readFileSync(md, 'utf8').split('\n').length > 3);
  checks.push('native-dialog-and-markdown');
  await page.getByRole('button', { name: 'Запустить пример', exact: true }).click();
  assert.equal(
    await page
      .locator('.ec-thinking-preview .thinking-glyph')
      .evaluate((e) => getComputedStyle(e.querySelector('.thinking-pixels')).animationName),
    'ec-think',
  );
  await page.getByRole('button', { name: 'Остановить', exact: true }).first().click();
  assert.equal(
    await page
      .locator('.ec-thinking-preview .thinking-glyph')
      .evaluate((e) => getComputedStyle(e.querySelector('.thinking-pixels')).animationName),
    'none',
  );
  const motionNames = await page.evaluate(() =>
    Object.fromEntries(
      [
        ['wait', '.si-core'],
        ['run', '.si-arc'],
        ['done', '.si-check'],
        ['pause', '.si-bar'],
        ['err', ''],
      ].map(([kind, part]) => [
        kind,
        getComputedStyle(document.querySelector(`.ec-statuses svg.ec-st-${kind} ${part}`.trim()))
          .animationName,
      ]),
    ),
  );
  assert.deepEqual(motionNames, {
    wait: 'si-breathe',
    run: 'si-spin, si-arc',
    done: 'si-draw',
    pause: 'si-hold',
    err: 'si-shake',
  });
  await page.getByRole('button', { name: 'Ошибка', exact: true }).click();
  assert.equal(await page.locator('.ec-lifecycle .ec-status.ec-st-err').count(), 1);
  checks.push('active-only-thinking-motion-and-per-status-animation');
  const hold = page.getByRole('button', { name: 'Удалить черновик, удерживайте', exact: true });
  await hold.click();
  assert.equal(await page.getByText('Черновик удалён').count(), 0);
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await page.getByText('Черновик удалён').waitFor();
  checks.push('hold-to-confirm-button');
  await page.locator('#workshop').scrollIntoViewIfNeeded();
  await page.locator('.wg-iso canvas').waitFor();
  assert.equal(await page.locator('.wg-iso').getAttribute('data-surface'), 'smoke');
  for (const variant of ['Сетка', 'Дымка', 'Контур']) {
    await page
      .getByRole('group', { name: 'Материал изометрии' })
      .getByRole('button', { name: variant, exact: true })
      .click();
    assert.equal(
      await page
        .getByRole('group', { name: 'Материал изометрии' })
        .getByRole('button', { name: variant, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
  }
  assert.equal(
    await page.locator('.wg-scene').evaluate((e) => getComputedStyle(e).borderTopWidth),
    '0px',
  );
  await page.locator('.wg-iso canvas').waitFor();
  assert.equal(await page.locator('.wg-iso').getAttribute('data-surface'), 'contour');
  checks.push('three-isometric-materials-on-one-scene');
  const commentsNode = page.getByRole('button', {
    name: 'Открыть участок Комментарии',
    exact: true,
  });
  await commentsNode.hover();
  await page.waitForFunction(() =>
    document.querySelector('#wg-route-hint').textContent.includes('Telegram, TikTok'),
  );
  assert.match(await page.locator('#wg-route-hint').innerText(), /Исходящие: Сбор/);
  await page.mouse.move(0, 0);
  assert.equal(await page.locator('#wg-route-hint').innerText(), '');
  await commentsNode.focus();
  assert.equal(await commentsNode.getAttribute('aria-describedby'), 'wg-route-hint');
  checks.push('route-neighborhood-on-hover-and-keyboard-focus');
  const telegram = page.getByRole('button', { name: 'Открыть участок Telegram', exact: true });
  await telegram.click();
  await page.getByRole('region', { name: 'Процесс Telegram' }).waitFor();
  const panelIconColors = await page.locator('.wg-panel-icon').evaluate((e) => {
    const style = getComputedStyle(e);
    return [style.color, style.backgroundColor, style.borderTopColor];
  });
  for (const color of panelIconColors) {
    const channels = color.match(/\d+/g).slice(0, 3).map(Number);
    assert.equal(Math.max(...channels) - Math.min(...channels), 0);
  }
  checks.push('monochrome-workshop-source-icon');
  assert.equal(
    await page.locator('.wg-process-panel').evaluate((e) => getComputedStyle(e).position),
    'fixed',
  );
  assert.equal(
    await page.locator('.wg-process-panel').evaluate((e) => getComputedStyle(e).backdropFilter),
    'none',
  );
  await page.getByRole('button', { name: 'Запустить участок', exact: true }).click();
  await page.getByRole('button', { name: 'Скачать Markdown', exact: true }).waitFor();
  assert.equal(await page.locator('.wg-steps .is-done').count(), 4);
  await download(
    () => page.getByRole('button', { name: 'Скачать Markdown', exact: true }).click(),
    'e-content-report.md',
  );
  await page.keyboard.press('Escape');
  await page.locator('.wg-process-panel').waitFor({ state: 'hidden' });
  checks.push('source-process-panel-and-export');
  await page.evaluate(() => {
    window.__workshopRoutes = [];
    window.__workshopArrivals = [];
    const status = document.querySelector('.wg-flow-status');
    new MutationObserver(() => {
      const label = status.innerText.replace(/\s+/g, ' ').trim();
      if (label && window.__workshopRoutes.at(-1) !== label) window.__workshopRoutes.push(label);
    }).observe(status, { childList: true, subtree: true, characterData: true });
    const receipt = document.querySelector('.wg-arrival-status');
    new MutationObserver(() => {
      const label = receipt.textContent.trim();
      if (label && window.__workshopArrivals.at(-1) !== label)
        window.__workshopArrivals.push(label);
    }).observe(receipt, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Повторить обработку', exact: true })
    .getByRole('button', { name: 'Запустить заново', exact: true })
    .click();
  await page.locator('.wg-process-panel').waitFor();
  const stop = page
    .locator('.wg-process-panel')
    .getByRole('button', { name: 'Остановить цикл', exact: true });
  await stop.focus();
  await page.waitForTimeout(1500);
  assert.equal(await stop.evaluate((e) => e === document.activeElement), true);
  await page
    .locator('.ec-section-controls')
    .getByRole('button', { name: 'Запустить весь цикл', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Скачать Markdown', exact: true }).waitFor();
  assert.equal(await page.locator('.wg-events>div').count(), 7);
  assert.deepEqual(await page.evaluate(() => window.__workshopRoutes), [
    'Telegram Комментарии telegram.md',
    'TikTok Комментарии tiktok.md',
    'Комментарии Сбор comments.md',
    'Сбор Темы inbox.md',
    'Сбор Аналитика inbox.md',
    'Темы Материалы ideas.md',
  ]);
  assert.equal(await page.locator('.wg-flow-status').innerText(), '');
  checks.push('six-directed-file-handoffs');
  assert.deepEqual(await page.evaluate(() => window.__workshopArrivals), [
    'Комментарии: получен telegram.md',
    'Комментарии: получен tiktok.md',
    'Сбор: получен comments.md',
    'Темы: получен inbox.md',
    'Аналитика: получен inbox.md',
    'Материалы: получен ideas.md',
  ]);
  checks.push('delivery-confirmation-at-each-input-port');
  await page.keyboard.press('Escape');
  checks.push('full-cycle-without-focus-theft');
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Повторить обработку', exact: true })
    .getByRole('button', { name: 'Запустить заново', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.wg-flow-status').textContent.includes('telegram.md'),
  );
  await page
    .locator('.wg-process-panel')
    .getByRole('button', { name: 'Остановить цикл', exact: true })
    .click();
  assert.equal(
    await page
      .locator('.wg-workspace-toolbar, .ec-section-controls')
      .getByRole('button', { name: 'Запустить весь цикл', exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator('.wg-active').count(), 0);
  assert.equal(await page.locator('.wg-flow-status').innerText(), '');
  await page.waitForTimeout(950);
  assert.equal(await page.locator('.wg-active').count(), 0);
  assert.equal(await page.locator('.wg-flow-status').innerText(), '');
  assert.equal(await page.locator('.wg-arrival-status').innerText(), '');
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  checks.push('cycle-cancellation');
  const library = page.locator('#library');
  await library.scrollIntoViewIfNeeded();
  await library.getByRole('button', { name: 'Коллекции', exact: true }).click();
  assert.equal(await library.locator('.lib-collection-tile').count(), 4);
  await library.getByRole('button', { name: 'Папки', exact: true }).click();
  await library.locator('.lib-collection-tile').first().waitFor({ state: 'detached' });
  await library.getByRole('button', { name: /Открыть папку «Карьера»/ }).click();
  await library.locator('.lib-open-folder').waitFor();
  await library.locator('.lib-folder-grid').waitFor({ state: 'detached' });
  assert.equal(await library.locator('.lib-file-row').count(), 3);
  await library.locator('.lib-file-row').first().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
  const libraryMd = await download(() =>
    page.getByRole('dialog').getByRole('button', { name: 'Скачать Markdown', exact: true }).click(),
  );
  assert.ok(fs.readFileSync(libraryMd, 'utf8').split('\n').length > 5);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await library.getByRole('button', { name: 'Все папки библиотеки', exact: true }).click();
  checks.push('folder-collection-navigation-and-markdown');
  await library.getByRole('button', { name: 'Новая папка', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Название папки', exact: true })
    .fill('Тестовая коллекция');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Создать папку', exact: true })
    .click();
  await library.getByRole('button', { name: /Открыть папку «Тестовая коллекция»/ }).waitFor();
  checks.push('create-folder');
  const analytics = page.locator('#analytics');
  await analytics.scrollIntoViewIfNeeded();
  const inGroup = (group, name) =>
    analytics.getByRole('group', { name: group, exact: true }).getByRole('button', { name });
  await inGroup('Период графика', '7 дней').click();
  await analytics.getByRole('button', { name: 'Данные', exact: true }).click();
  assert.equal(await analytics.locator('.ag-data-scroll tbody tr').count(), 7);
  await analytics.getByRole('button', { name: 'График', exact: true }).click();
  await analytics.locator('.ag-trend-svg').focus();
  await page.keyboard.press('ArrowLeft');
  await analytics.locator('.ag-tooltip').waitFor();
  await inGroup('Период графика', '30 дней').click();
  await inGroup('Показатель графика', /^Комментарии/).click();
  assert.equal(
    await inGroup('Показатель графика', /^Комментарии/).getAttribute('aria-pressed'),
    'true',
  );
  await inGroup('Вид графика', 'Линии').click();
  assert.equal(await inGroup('Вид графика', 'Линии').getAttribute('aria-pressed'), 'true');
  checks.push('smooth-chart-period-variants-tooltip-and-table');
  await inGroup('Источник воронки', /TG/).click();
  assert.equal(await analytics.locator('.ag-flow-row').count(), 4);
  await inGroup('Группировка материалов', 'Площадки').click();
  await inGroup('Источники обсуждений', /TT/).click();
  await page.waitForFunction(() => document.querySelectorAll('.ag-source-row').length === 1);
  const session = analytics.locator('.ag-journal button.ag-journal-row').first();
  await session.click();
  assert.equal(await session.getAttribute('aria-expanded'), 'true');
  await analytics.locator('.ag-journal-detail').first().waitFor();
  checks.push('flow-donut-sources-and-journal-controls');
  await page
    .getByRole('group', { name: 'Шрифт интерфейса' })
    .getByRole('button', { name: 'Golos', exact: true })
    .click();
  assert.equal(
    await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily.includes('Golos')),
    true,
  );
  await page
    .getByRole('group', { name: 'Шрифт интерфейса' })
    .getByRole('button', { name: 'Inter', exact: true })
    .click();
  await page.locator('.ec-logo-variants').getByRole('button', { name: /Слой/ }).click();
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page
      .locator('.ec-logo-variants')
      .getByRole('button', { name: /Слой/ })
      .getAttribute('aria-pressed'),
    'true',
  );
  checks.push('font-and-logo-variants-persistence');
  const layouts = [];
  for (const width of [1920, 1440, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    await page.waitForTimeout(180);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, `Overflow at ${width}`);
    layouts.push(width);
    if (width === 390) {
      const mobileIconColors = await page
        .locator('.wg-mobile-nodes > button > svg:first-child')
        .evaluateAll((elements) => elements.map((e) => getComputedStyle(e).color));
      assert.equal(mobileIconColors.length, 7);
      assert.ok(mobileIconColors.every((color) => color === 'rgb(200, 200, 200)'));
    }
    for (const id of ['components', 'workshop', 'library', 'analytics', 'typography']) {
      await page.locator('#' + id).scrollIntoViewIfNeeded();
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: path.join(output, `${id}-${width}.png`) });
      }
    }
  }
  checks.push('35-responsive-section-layouts');
  await page.goto(origin + '/#library');
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => document.querySelector('#library')?.getBoundingClientRect().top < 260,
  );
  assert.ok(await page.evaluate(() => scrollY > 0));
  await page.goto(origin + '/?view=analytics');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => document.querySelector('#analytics')?.getBoundingClientRect().top < 260,
  );
  assert.equal(new URL(page.url()).hash, '#analytics');
  checks.push('initial-section-links-and-legacy-url-migration');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Запустить пример', exact: true }).click();
  assert.equal(
    await page
      .locator('.ec-thinking-preview .thinking-pixels')
      .evaluate((e) => getComputedStyle(e).animationName),
    'none',
  );
  assert.equal(
    await page.locator('html').evaluate((e) => getComputedStyle(e).scrollbarWidth),
    'none',
  );
  assert.deepEqual(errors, []);
  checks.push('reduced-motion-hidden-scrollbars-and-no-runtime-errors');
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify({ passed: true, checks, widths: layouts, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, checks: checks.length, widths: layouts.length, output }),
  );
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(output, 'failure.txt'), String(error));
  throw error;
} finally {
  await browser.close();
}
