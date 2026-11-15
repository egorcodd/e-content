import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('e-content-sample-data', 'off');
  } catch {}
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(origin + '/mark.svg');
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('e-content-library', 1);
        request.onupgradeneeded = () => {
          const folders = request.result.createObjectStore('folders', { keyPath: 'id' });
          const materials = request.result.createObjectStore('materials', { keyPath: 'id' });
          const time = '2026-11-13T12:00:00.000Z';
          for (const [id, title] of [
            ['inbox', 'Входящие'],
            ['ideas', 'Идеи'],
            ['scripts', 'Сценарии'],
            ['reports', 'Результаты цеха'],
            ['own', 'Моя подборка'],
          ])
            folders.put({ id, title, createdAt: time });
          const base = {
            source: 'manual',
            favorite: true,
            revision: 3,
            createdAt: time,
            updatedAt: time,
          };
          materials.put({
            ...base,
            id: 'video-old',
            folderId: 'ideas',
            title: 'Старая идея',
            body: '# Исходный Markdown\n\nНичего не терять.',
          });
          materials.put({
            ...base,
            id: 'post-old',
            folderId: 'scripts',
            title: 'Тема публикации',
            body: 'Сохранённый текст.',
          });
          materials.put({
            ...base,
            id: 'custom-old',
            folderId: 'own',
            title: 'Своя заметка',
            body: 'Мой текст.',
          });
          materials.put({
            ...base,
            id: 'run-old',
            folderId: 'reports',
            title: 'Ядро',
            body: 'Технический отчёт.',
            source: 'workshop',
            runId: 'old-run',
            stationId: 'orchestrator',
          });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve(true);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.goto(origin + '/materials');
  await page.locator('.app-loader').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.mp-folder').count(), 5);
  assert.equal(await page.getByText('Сценарии', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Результаты цеха', { exact: true }).count(), 0);
  await page.locator('.mp-folder').filter({ hasText: 'Идеи видео' }).click();
  await page.getByRole('button', { name: 'Открыть идею Старая идея', exact: true }).click();
  assert.equal(
    await page.getByRole('combobox', { name: 'Формат идеи', exact: true }).innerText(),
    'Видео',
  );
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  assert.equal(
    await page.getByLabel('Описание идеи', { exact: true }).inputValue(),
    '# Исходный Markdown\n\nНичего не терять.',
  );
  const state = await page.evaluate(async () => {
    const repo = await import('/src/features/materials/repository.ts');
    const artifact = await repo.readMaterial('run-old');
    return {
      artifact,
      video: await repo.readMaterial('video-old'),
      post: await repo.readMaterial('post-old'),
      custom: await repo.readMaterial('custom-old'),
    };
  });
  assert.equal(state.artifact.body, 'Технический отчёт.');
  assert.equal(state.video.revision, 3);
  assert.equal(state.video.favorite, true);
  assert.equal(state.video.createdAt, '2026-11-13T12:00:00.000Z');
  assert.equal(state.post.format, 'post');
  assert.equal(state.post.folderId, 'post-ideas');
  assert.equal(state.custom.folderId, 'own');
  assert.equal(state.custom.body, 'Мой текст.');
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await page.getByRole('button', { name: 'Все идеи', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mi-row').length === 3);
  assert.deepEqual(errors, []);
  console.log(
    'Library v1 → v3 migration passed: user Markdown, favorites, revisions, dates and custom folders preserved; default folders migrated; technical artifacts retained separately.',
  );
} finally {
  await browser.close();
}
