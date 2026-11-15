import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorkshopRoute } from '../src/features/workshop/route.ts';
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1050 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
fs.mkdirSync('.qa/refinements', { recursive: true });
const countRows = (count) =>
  page.waitForFunction((count) => document.querySelectorAll('.mi-row').length === count, count);
try {
  await page.goto(origin + '/materials');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await countRows(11);
  await page.waitForTimeout(500);
  const all = await page.getByRole('button', { name: 'Все идеи', exact: true }).boundingBox();
  const favorite = await page.getByRole('button', { name: 'Избранное', exact: true }).boundingBox();
  assert.ok(Math.abs(all.height - favorite.height) < 0.1, 'Tab heights differ');
  assert.equal(all.height, 38);
  assert.ok(
    await page.locator('.mi-title-layout').evaluateAll((nodes) =>
      nodes.every((node) => {
        const star = node.querySelector('.mi-favorite').getBoundingClientRect();
        const text = node.querySelector('.mi-open').getBoundingClientRect();
        return text.left - star.right >= 11;
      }),
    ),
    'Favorite star overlaps idea title',
  );
  const signal = page.getByRole('button', {
    name: 'Повторяемость: Почему автотесты падают только на CI',
    exact: true,
  });
  await signal.hover();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').innerText(), /12 упоминаний/);
  const bars = await page
    .locator('.mi-frequency-tooltip .mi-tooltip-chart i')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(new Set(bars).size > 1, 'Frequency chart ignores evidence dates');
  await page.mouse.move(600, 100);
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  await signal.focus();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  await page
    .getByRole('combobox', { name: 'Приоритет: Почему автотесты падают только на CI', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('option', { name: 'Высокий', exact: true })
      .locator('.mi-priority-gauge i')
      .count(),
    3,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await countRows(5);
  assert.equal(
    await page
      .locator('.mi-row')
      .first()
      .getByRole('combobox', { name: /Приоритет/ })
      .innerText(),
    'Высокий',
  );
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await countRows(11);
  const activeTitle = 'Почему автотесты падают только на CI';
  await page.getByRole('button', { name: 'Архивировать ' + activeTitle, exact: true }).click();
  await countRows(10);
  await page.getByRole('button', { name: 'Папки', exact: true }).click();
  await page.locator('.mp-folder').filter({ hasText: 'Архив' }).click();
  await countRows(2);
  await page.getByRole('button', { name: 'Восстановить идею ' + activeTitle, exact: true }).click();
  await countRows(1);
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await countRows(11);
  assert.equal(
    await page
      .locator('.mi-row')
      .filter({ hasText: activeTitle })
      .getByRole('combobox', { name: /Статус/ })
      .innerText(),
    'Отобрана',
  );
  const firstRow = page.locator('.mi-row').first();
  assert.equal(await firstRow.locator('time').count(), 0);
  assert.equal(
    await page.locator('.mi-frequency-trend').count(),
    0,
    'Two competing indicators remain',
  );
  await firstRow.locator('.mi-open').click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.mouse.move(1000, 120);
  await page.waitForTimeout(350);
  await page.screenshot({ path: '.qa/refinements/materials-1920.png' });
  const sidebar = page.locator('.app-sidebar');
  await page.waitForFunction(
    () => document.querySelector('.app-sidebar').dataset.expandable === 'true',
  );
  await sidebar.hover();
  await page.waitForTimeout(550);
  const side = await sidebar.boundingBox(),
    content = await page.locator('.materials-page').boundingBox();
  assert.ok(content.x - side.x - side.width >= 19, 'Expanded sidebar covers content');
  await page.screenshot({ path: '.qa/refinements/sidebar-wide.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(350);
  assert.equal(await sidebar.getAttribute('data-expandable'), 'false');
  assert.equal(await sidebar.getAttribute('data-expanded'), 'false');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(350);
  assert.equal(await sidebar.getAttribute('data-expandable'), 'false');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('.mi-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.qa/refinements/materials-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', {
      name: 'Удалить Как написать баг-репорт, который не вернут',
      exact: true,
    })
    .click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Удалить', exact: true }).click();
  await countRows(10);
  await page.reload();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await countRows(10);
  await sidebar.getByRole('link', { name: 'Цех агентов', exact: true }).click();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Цех агентов', exact: true }).waitFor();
  assert.equal(await sidebar.getAttribute('data-expandable'), 'true');
  await page.getByRole('button', { name: 'Открыть участок Сбор', exact: true }).click();
  await page
    .locator('.wg-process-panel')
    .getByRole('button', { name: 'Запустить участок', exact: true })
    .click();
  await page.waitForTimeout(5200);
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить весь цикл', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Повторить обработку', exact: true });
  await dialog.waitFor();
  await page.waitForTimeout(350);
  assert.equal(
    await dialog.evaluate((node) => getComputedStyle(node, '::backdrop').backdropFilter),
    'blur(7px)',
  );
  const gap = await dialog.evaluate(
    (node) =>
      node.querySelector('.ec-dialog-actions').getBoundingClientRect().top -
      node.querySelector('p').getBoundingClientRect().bottom,
  );
  assert.ok(gap >= 20, 'Dialog actions touch body text');
  await page.screenshot({ path: '.qa/refinements/repeat-popup.png' });
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: '.qa/refinements/compact-route.png' });
  const world = ([h, v]) => {
    const r = h * 1.22 * Math.SQRT2,
      d = v * 1.22 * Math.sqrt(6);
    return [(r + d) / 2, (d - r) / 2];
  };
  const positions = {
    collector: world([2, -1.85]),
    analytics: world([-2.2, 2.15]),
    orchestrator: [0, 0],
  };
  const route = createWorkshopRoute('collector', 'analytics', positions, 1.01);
  const points = route.getPoints(400);
  assert.ok(
    points.every((point) => Math.max(Math.abs(point.x), Math.abs(point.z)) > 1.4),
    'Route intersects core clearance',
  );
  assert.ok(route.getLength() < 10, 'Route takes an excessive detour');
  assert.deepEqual(errors, []);
  console.log(
    'Refinements passed: 12 persistent samples, no resurrection after delete, aligned tabs, star clearance, interactive evidence meter/chart, visual priority, adaptive non-overlapping sidebar, blurred dialog with action spacing and compact core bypass.',
  );
} finally {
  await browser.close();
}
