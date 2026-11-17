import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route('**/api/collection/latest', (route) => route.fulfill({ json: { run: null } }));
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
    'Library v1 migration passed: user Markdown, favorites, revisions, dates and custom folders preserved; default folders migrated; technical artifacts retained separately.',
  );

  for (const version of [3, 4, 5]) {
    const legacyPage = await browser.newPage();
    await legacyPage.route('**/api/collection/latest', (route) =>
      route.fulfill({ json: { run: null } }),
    );
    await legacyPage.addInitScript(() => localStorage.setItem('e-content-sample-data', 'off'));
    await legacyPage.goto(origin + '/mark.svg');
    await legacyPage.evaluate(
      (version) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('e-content-library', version);
          request.onupgradeneeded = () => {
            const db = request.result;
            const folders = db.createObjectStore('folders', { keyPath: 'id' });
            const materials = db.createObjectStore('materials', { keyPath: 'id' });
            db.createObjectStore('artifacts', { keyPath: 'id' });
            const time = '2026-11-13T12:00:00.000Z';
            folders.put({ id: 'video-ideas', title: 'Идеи видео', createdAt: time });
            const heading =
              'Длинная реплика, которая была сохранена автоматически. '.repeat(5).slice(0, 179) +
              ' ';
            const text = heading + 'это идея для видео.';
            const url = 'https://www.tiktok.com/@example/video/7000000000000000000?comment_id=1';
            const body = '# ' + heading + '\n\n' + text + '\n\nИсточник: ' + url;
            const evidence = {
              id: 'tiktok:comment:1',
              source: 'tiktok',
              kind: 'comment',
              text,
              url,
            };
            const base = {
              folderId: 'video-ideas',
              title: heading.trim(),
              body,
              source: 'tiktok',
              evidence: [evidence],
              format: 'video',
              status: 'new',
              priority: 'normal',
              favorite: false,
              revision: 1,
              createdAt: time,
              updatedAt: time,
            };
            for (const [key, changes] of [
              ['a', {}],
              ['b', { revision: 3 }],
              ['c', { revision: 2, title: 'Идея с ручной правкой', body: 'Мои заметки.' }],
              ['d', { revision: 2, favorite: true }],
              ['e', { revision: 2, evidence: [evidence, { ...evidence, id: 'extra' }] }],
            ]) {
              materials.put({ ...base, ...changes, id: 'tiktok-idea-' + key.repeat(24) });
            }
          };
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        }),
      version,
    );
    await legacyPage.goto(origin + '/materials?folder=video-ideas');
    await legacyPage.getByRole('button', { name: 'Открыть идею Идея с ручной правкой' }).waitFor();
    const [raw, reimported, edited, favorite, extraEvidence] = await legacyPage.evaluate(
      async () => {
        const { readMaterial } = await import('/src/features/materials/repository.ts');
        return Promise.all(
          [...'abcde'].map((key) => readMaterial('tiktok-idea-' + key.repeat(24))),
        );
      },
    );
    for (const archived of [raw, reimported, favorite, extraEvidence]) {
      assert.equal(archived.folderId, 'archive', 'A raw imported comment stayed in Ideas');
      assert.equal(archived.status, 'archived');
      assert.equal(archived.archivedFrom, 'video-ideas');
      assert.equal(archived.statusBeforeArchive, 'new');
    }
    assert.equal(edited.folderId, 'video-ideas');
    assert.equal(edited.body, 'Мои заметки.');
    assert.equal(favorite.favorite, true);
    assert.equal(extraEvidence.evidence.length, 2);
    if (version === 5) {
      const reviewed = await legacyPage.evaluate(async () => {
        const { saveFoundIdea, reviewVideoIdeas, readMaterial, saveMaterial } =
          await import('/src/features/materials/repository.ts');
        const { ideaDraft } = await import('/src/features/collection/idea-drafts.ts');
        const bad = {
          id: 'tiktok:comment:old',
          source: 'tiktok',
          kind: 'comment',
          text: 'Старый отбор',
        };
        const actual = [
          { ...bad, id: 'tiktok:comment:new-1', text: 'Как выбрать язык для первого проекта?' },
          { ...bad, id: 'tiktok:comment:new-2', text: 'Какой первый язык попробовать?' },
        ];
        const makeIdea = (topic) => ({
          id: 'tiktok-topic-' + topic,
          ...ideaDraft(topic),
          evidence: [bad],
          format: 'video',
          source: 'tiktok',
        });
        const language = makeIdea('first-language');
        const interview = makeIdea('interview');
        const edited = makeIdea('first-job');
        await saveFoundIdea(language);
        await saveFoundIdea(interview);
        const saved = await saveFoundIdea(edited);
        await saveMaterial({ ...saved, body: 'Мой план ролика.' }, saved.revision);
        await reviewVideoIdeas([{ ...language, evidence: actual }]);
        return Promise.all([language, interview, edited].map(({ id }) => readMaterial(id)));
      });
      assert.deepEqual(
        reviewed[0].evidence.map(({ id }) => id),
        ['tiktok:comment:new-1', 'tiktok:comment:new-2'],
      );
      assert.equal(reviewed[1].folderId, 'archive');
      assert.equal(reviewed[2].body, 'Мой план ролика.');
      assert.equal(reviewed[2].folderId, 'video-ideas');
    }
    await legacyPage.context().close();
  }
  console.log(
    'Video library review archived raw and unsupported cards and preserved authored ideas.',
  );
} finally {
  await browser.close();
}
