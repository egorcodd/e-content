import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem('e-content-sample-data', 'off');
  } catch {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
fs.mkdirSync('.qa/materials', { recursive: true });
const dialog = page.locator('dialog[open]');
const rows = page.locator('.mi-row');
const note =
  '# Почему тесты нестабильны\n\nВопрос аудитории и разбор причин без готового сценария.\n';
const title = 'Почему тесты нестабильны';
async function ready(target = page) {
  await target.locator('.app-loader').waitFor({ state: 'detached' });
  await target.getByRole('heading', { level: 1, name: 'Материалы', exact: true }).waitFor();
}
async function select(label, option, target = page) {
  await target.getByRole('combobox', { name: label, exact: true }).click();
  await target.getByRole('option', { name: option, exact: true }).click();
}
async function rowCount(count) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('.mi-row').length === count,
    count,
  );
}
async function closeEditor(target = page) {
  await target
    .locator('dialog[open]')
    .getByRole('button', { name: 'Закрыть диалог', exact: true })
    .click();
  await target.locator('dialog[open]').waitFor({ state: 'detached' });
}
try {
  await page.goto(origin + '/materials');
  await ready();
  assert.equal(await page.locator('.mp-folder').count(), 4);
  assert.equal(await rows.count(), 0);
  assert.equal(await page.locator('.mp-file').count(), 0);
  await page.getByRole('button', { name: 'Добавить идею', exact: true }).click();
  await page.getByLabel('Название идеи', { exact: true }).fill(title);
  await page.getByLabel('Описание идеи', { exact: true }).fill(note);
  await select('Формат идеи', 'Видео');
  assert.equal(
    await page.getByRole('combobox', { name: 'Папка идеи', exact: true }).innerText(),
    'Идеи видео',
  );
  await dialog.getByRole('button', { name: /Основания/ }).click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByLabel('Текст основания', { exact: true })
      .fill(`Почему падает тест? Реплика ${i + 1}`);
    await page
      .getByLabel('Ссылка на источник', { exact: true })
      .fill(i < 2 ? `https://t.me/example/10?comment=${i}` : 'https://t.me/example/11');
    await page.getByRole('button', { name: 'Добавить основание', exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await rowCount(1);
  assert.equal(
    await page.getByRole('columnheader', { name: 'Комментарии', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('columnheader', { name: 'Упоминания', exact: true }).count(),
    1,
  );
  assert.equal(await rows.locator('.mi-mention-cell > span').last().innerText(), '—');
  assert.match(await rows.locator('.mi-signal-cell').innerText(), /Нет дат/);
  const foundDate = await rows.first().getAttribute('data-created-at');
  assert.equal(await rows.locator('time').count(), 0);
  await select(`Статус: ${title}`, 'Отобрана');
  await select(`Приоритет: ${title}`, 'Высокий');
  await page.getByRole('button', { name: `Избранное: ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await rowCount(1);
  assert.equal(await rows.first().getAttribute('data-created-at'), foundDate);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Экспорт MD/ }).click();
  const md = fs.readFileSync(await (await download).path(), 'utf8');
  assert.match(md, /Комментарии?ев?: 3/);
  assert.match(md, /Отобрана/);
  assert.match(md, /Высокий/);
  assert.match(md, /Реплика 3/);
  assert.match(md, /https:\/\/t.me\/example\/11/);
  await page.reload();
  await ready();
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await rowCount(1);
  await page.getByRole('button', { name: 'Новая папка', exact: true }).click();
  await page.getByLabel('Название папки', { exact: true }).fill('Для следующей недели');
  await dialog.getByRole('button', { name: 'Сохранить папку', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: `Перенести ${title}`, exact: true }).click();
  await select('Куда перенести', 'Для следующей недели');
  await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Папки', exact: true }).click();
  await page.locator('.mp-folder').filter({ hasText: 'Для следующей недели' }).click();
  await rowCount(1);
  await page.getByRole('button', { name: 'Удалить папку', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.locator('.mp-folder').filter({ hasText: 'Неразобранное' }).click();
  await rowCount(1);
  await page.getByRole('button', { name: `Удалить ${title}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await rowCount(0);
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await rowCount(1);
  await page.getByRole('button', { name: `Открыть идею ${title}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Markdown', exact: true }).click();
  assert.equal(await page.getByLabel('Описание идеи', { exact: true }).inputValue(), note);
  await page.getByLabel('Описание идеи', { exact: true }).fill('Не сохранять');
  await dialog.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await page.getByText('Есть несохранённые изменения.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page.evaluate(async () => {
    const repo = await import('/src/features/materials/repository.ts');
    const data = {
      id: 'found-post-1',
      title: 'Какие проверки нужны перед релизом',
      body: 'Тема из вопросов к публикации.',
      format: 'post',
      source: 'telegram',
      evidence: [
        {
          id: 'c1',
          source: 'telegram',
          kind: 'comment',
          text: 'Что проверить перед релизом?',
          url: 'https://t.me/example/20',
        },
      ],
    };
    await repo.saveFoundIdea(data);
    await repo.saveFoundIdea({
      ...data,
      evidence: [
        ...data.evidence,
        {
          id: 'c2',
          source: 'telegram',
          kind: 'post',
          text: 'Чек-лист релиза',
          url: 'https://t.me/example/21',
        },
      ],
    });
    await repo.saveMaterial({
      id: 'older-idea',
      title: 'Как читать логи',
      body: 'Вопросы об ошибках.',
      folderId: 'video-ideas',
      format: 'video',
      source: 'manual',
      favorite: false,
      createdAt: '2026-11-14T12:00:00.000Z',
    });
  });
  await rowCount(3);
  assert.equal(await page.locator('.mi-date-row').count(), 1);
  await select('Источник идей', 'Telegram');
  await rowCount(2);
  await select('Повторяемость идей', 'Повторяется');
  await rowCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await rowCount(3);
  await page.getByLabel('Поиск идей', { exact: true }).fill('читать логи');
  await rowCount(1);
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await rowCount(3);
  const imported = {
    name: 'новый-вопрос.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Как оформить баг\n\nВопрос из обсуждения.\n'),
  };
  await page.locator('input[type=file]').setInputFiles(imported);
  await rowCount(4);
  await page.locator('input[type=file]').setInputFiles(imported);
  await page.getByText('Импортировано: 0. Уже есть: 1', { exact: true }).waitFor();
  assert.equal(await rows.count(), 4);
  await page.screenshot({ path: '.qa/materials/ideas-desktop.png' });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(250);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow ${width}`,
    );
    await page.getByRole('button', { name: `Открыть идею ${title}`, exact: true }).click();
    await page.waitForTimeout(300);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Editor overflow ${width}`,
    );
    if (width === 390) await page.screenshot({ path: '.qa/materials/idea-mobile-editor.png' });
    await closeEditor();
    if (width === 390) await page.screenshot({ path: '.qa/materials/ideas-mobile.png' });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: `Открыть идею ${title}`, exact: true }).click();
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(page.url());
  await other.locator('dialog[open]').waitFor();
  await other.getByLabel('Название идеи', { exact: true }).fill('Обновлённая идея');
  await other
    .locator('dialog[open]')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await other.locator('dialog[open]').waitFor({ state: 'detached' });
  await page.getByLabel('Название идеи', { exact: true }).fill('Устаревшая правка');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByText(/Материал изменён в другой вкладке/).waitFor();
  await dialog.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await other.close();
  await page
    .locator('.app-sidebar')
    .getByRole('link', { name: 'Цех агентов', exact: true })
    .click();
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Открыть участок Сбор', exact: true }).click();
  await page
    .locator('.wg-process-panel')
    .getByRole('button', { name: 'Запустить участок', exact: true })
    .click();
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  await page.waitForTimeout(5400);
  await page.getByRole('button', { name: 'Открыть участок Ядро', exact: true }).click();
  await page.locator('.wg-process-panel').getByText('Готово', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Закрыть процесс', exact: true }).click();
  await page.locator('.app-sidebar').getByRole('link', { name: 'Материалы', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await rowCount(4);
  assert.deepEqual(errors, []);
  console.log(
    'Idea library passed: folders-first, evidence-derived recurrence, statuses, priorities, favorites, stable dates, automatic routing, deduplication, search/filters, complete Markdown export, move/undo, responsive table/editor, cross-tab conflict and isolated workshop artifacts.',
  );
} finally {
  await browser.close();
}
