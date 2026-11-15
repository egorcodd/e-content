import { useEffect, useSyncExternalStore } from 'react';
import { ideaDetails, folderFormat, formatFolder, type IdeaDetails } from './idea-model';

export type MaterialSource = 'manual' | 'telegram' | 'tiktok' | 'workshop';
export type Material = IdeaDetails & {
  id: string;
  folderId: string;
  title: string;
  body: string;
  source: MaterialSource;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  revision: number;
  runId?: string;
  stationId?: string;
  sourceUrl?: string;
  origin?: 'sample';
  archivedFrom?: string;
  statusBeforeArchive?: Exclude<IdeaDetails['status'], 'archived'>;
};
export type MaterialFolder = { id: string; title: string; createdAt: string };
type Snapshot = {
  loading: boolean;
  folders: MaterialFolder[];
  materials: Material[];
  error: string | null;
};
let snapshot: Snapshot = { loading: true, folders: [], materials: [], error: null };
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;
let initialized: Promise<void> | undefined;
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('e-content-materials');
const emit = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить материалы';

function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('e-content-library', 3);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      const folders =
        event.oldVersion === 0
          ? db.createObjectStore('folders', { keyPath: 'id' })
          : tx.objectStore('folders');
      const materials =
        event.oldVersion === 0
          ? db.createObjectStore('materials', { keyPath: 'id' })
          : tx.objectStore('materials');
      const artifacts = db.objectStoreNames.contains('artifacts')
        ? tx.objectStore('artifacts')
        : db.createObjectStore('artifacts', { keyPath: 'id' });
      if (event.oldVersion >= 2) {
        folders.put({ id: 'archive', title: 'Архив', createdAt: new Date().toISOString() });
        const previous = materials.getAll();
        previous.onsuccess = () => {
          for (const record of previous.result as Material[]) {
            if (record.status === 'archived')
              materials.put({
                ...record,
                folderId: 'archive',
                archivedFrom: record.folderId === 'archive' ? record.archivedFrom : record.folderId,
                statusBeforeArchive: record.statusBeforeArchive ?? 'new',
              });
          }
        };
        return;
      }
      const oldFolders = folders.getAll();
      oldFolders.onsuccess = () => {
        const oldMaterials = materials.getAll();
        oldMaterials.onsuccess = () => {
          const list = oldFolders.result as MaterialFolder[];
          const records = oldMaterials.result as Material[];
          const replacements: Record<string, string> = {};
          for (const [id, title, next] of [
            ['ideas', 'Идеи', 'video-ideas'],
            ['scripts', 'Сценарии', 'post-ideas'],
          ]) {
            if (list.some((folder) => folder.id === id && folder.title === title)) {
              replacements[id] = next;
              folders.delete(id);
            }
          }
          for (const [id, title] of [
            ['inbox', 'Неразобранное'],
            ['video-ideas', 'Идеи видео'],
            ['post-ideas', 'Идеи постов'],
            ['archive', 'Архив'],
          ]) {
            if (!list.some((folder) => folder.id === id))
              folders.put({ id, title, createdAt: new Date().toISOString() });
            else if (
              id === 'inbox' &&
              list.some((folder) => folder.id === id && folder.title === 'Входящие')
            )
              folders.put({ ...list.find((folder) => folder.id === id), title });
          }
          for (const record of records) {
            if (record.runId || record.stationId) {
              artifacts.put(record);
              materials.delete(record.id);
            } else {
              const folderId = replacements[record.folderId] ?? record.folderId;
              materials.put({
                ...record,
                folderId: record.status === 'archived' ? 'archive' : folderId,
                ...(record.status === 'archived'
                  ? { archivedFrom: folderId, statusBeforeArchive: 'new' }
                  : {}),
                ...ideaDetails({ ...record, format: record.format ?? folderFormat(folderId) }),
              });
            }
          }
          const reports = list.find(
            (folder) => folder.id === 'reports' && folder.title === 'Результаты цеха',
          );
          if (reports) {
            if (
              records.some((item) => item.folderId === 'reports' && !item.runId && !item.stationId)
            )
              folders.put({ ...reports, title: 'Другие файлы' });
            else folders.delete('reports');
          }
        };
      };
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(new Error('Хранилище недоступно. Проверьте разрешения браузера.'));
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error('Закройте другие вкладки e-content и повторите загрузку.'));
    };
  }));
}

async function refresh() {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['folders', 'materials'], 'readonly');
    const folders = tx.objectStore('folders').getAll();
    const materials = tx.objectStore('materials').getAll();
    tx.oncomplete = () => {
      const order = ['video-ideas', 'post-ideas', 'inbox'];
      const rank = (id: string) =>
        id === 'archive' ? 5 : order.includes(id) ? order.indexOf(id) : 4;
      const sorted = (folders.result as MaterialFolder[]).sort(
        (a, b) => rank(a.id) - rank(b.id) || a.createdAt.localeCompare(b.createdAt),
      );
      emit({
        loading: false,
        folders: sorted,
        materials: materials.result.map((item: Material) => ({ ...item, ...ideaDetails(item) })),
        error: null,
      });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function initializeLibrary() {
  return (initialized ??= (async () => {
    await refresh();
    if (
      import.meta.env.DEV &&
      localStorage.getItem('e-content-sample-data') !== 'off' &&
      localStorage.getItem('e-content-sample-ideas-v2') !== 'ready'
    ) {
      const { sampleIdeas } = await import('./sample-data');
      await mutate(['materials'], (tx) => {
        const store = tx.objectStore('materials');
        for (const idea of sampleIdeas()) {
          const existing = store.get(idea.id);
          existing.onsuccess = () => {
            if (
              !existing.result ||
              (existing.result.origin === 'sample' && existing.result.revision === 1)
            )
              store.put(idea);
          };
        }
      });
      localStorage.setItem('e-content-sample-ideas-v2', 'ready');
    }
  })().catch((error) => {
    initialized = undefined;
    emit({ ...snapshot, loading: false, error: message(error) });
    throw error;
  }));
}

async function mutate(
  stores: string[],
  action: (tx: IDBTransaction, fail: (error: Error) => void) => void,
) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let failure: Error | undefined;
    const fail = (error: Error) => {
      failure = error;
      tx.abort();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('Не удалось сохранить изменения'));
    try {
      action(tx, fail);
    } catch (error) {
      fail(new Error(message(error)));
    }
  });
  await refresh();
  channel?.postMessage('changed');
}

channel?.addEventListener('message', () => {
  void refresh().catch(() => {});
});

export function useLibrary() {
  useEffect(() => {
    void initializeLibrary().catch(() => {});
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export async function saveMaterial(
  input: Omit<Material, 'revision' | 'updatedAt' | 'createdAt' | keyof IdeaDetails> &
    Partial<Pick<Material, 'createdAt'> & IdeaDetails>,
  expectedRevision?: number,
) {
  if (!input.title.trim()) throw new Error('Введите название материала');
  if (input.body.length > 2_000_000)
    throw new Error('Материал слишком большой: максимум 2 МБ текста');
  let saved: Material | undefined;
  await mutate(['materials', 'folders'], (tx, fail) => {
    const store = tx.objectStore('materials');
    const old = store.get(input.id);
    old.onsuccess = () => {
      const existing = old.result as Material | undefined;
      if (expectedRevision !== undefined && existing?.revision !== expectedRevision) {
        fail(
          new Error(
            'Материал изменён в другой вкладке. Откройте актуальную версию перед сохранением.',
          ),
        );
        return;
      }
      const details = ideaDetails({ format: folderFormat(input.folderId), ...existing, ...input });
      let targetFolder = input.folderId;
      let archivedFrom = input.archivedFrom;
      let statusBeforeArchive = input.statusBeforeArchive;
      if (existing?.status === 'archived') {
        if (targetFolder !== 'archive' || details.status !== 'archived') {
          if (targetFolder === 'archive')
            targetFolder = existing.archivedFrom ?? formatFolder(details.format);
          if (details.status === 'archived') details.status = existing.statusBeforeArchive ?? 'new';
          archivedFrom = undefined;
          statusBeforeArchive = undefined;
        }
      } else if (details.status === 'archived' || targetFolder === 'archive') {
        archivedFrom =
          existing?.folderId ??
          (targetFolder === 'archive' ? formatFolder(details.format) : targetFolder);
        statusBeforeArchive =
          existing?.status ?? (details.status === 'archived' ? 'new' : details.status);
        targetFolder = 'archive';
        details.status = 'archived';
      }
      const folder = tx.objectStore('folders').get(targetFolder);
      folder.onsuccess = () => {
        const now = new Date().toISOString();
        saved = {
          ...input,
          ...details,
          archivedFrom,
          statusBeforeArchive,
          title: input.title.trim(),
          folderId: folder.result ? targetFolder : 'inbox',
          createdAt: existing?.createdAt ?? input.createdAt ?? now,
          updatedAt: now,
          revision: (existing?.revision ?? 0) + 1,
        };
        store.put(saved);
      };
    };
  });
  return saved!;
}

export async function saveFoundIdea(
  input: Pick<Material, 'id' | 'title' | 'body' | 'format' | 'source' | 'evidence'>,
) {
  if (!input.evidence.length)
    throw new Error('У найденной идеи должно быть хотя бы одно основание');
  await initializeLibrary();
  const existing = snapshot.materials.find((item) => item.id === input.id);
  const evidence = [
    ...new Map(
      [...(existing?.evidence ?? []), ...input.evidence].map((item) => [
        `${item.source}:${item.id}`,
        item,
      ]),
    ).values(),
  ];
  return saveMaterial(
    {
      ...input,
      ...existing,
      evidence,
      folderId: existing?.folderId ?? formatFolder(input.format),
      favorite: existing?.favorite ?? false,
    },
    existing?.revision,
  );
}

export async function deleteMaterial(id: string) {
  const removed = snapshot.materials.find((item) => item.id === id);
  await mutate(['materials'], (tx) => {
    tx.objectStore('materials').delete(id);
  });
  return removed;
}
export async function readMaterial(id: string) {
  await initializeLibrary();
  const material = snapshot.materials.find((item) => item.id === id);
  if (material) return material;
  const db = await open();
  return new Promise<Material | undefined>((resolve, reject) => {
    const request = db.transaction('artifacts', 'readonly').objectStore('artifacts').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveRunArtifact(
  input: Omit<Material, 'revision' | 'updatedAt' | 'createdAt' | keyof IdeaDetails>,
) {
  const saved: Material = {
    ...input,
    ...ideaDetails({}),
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mutate(['artifacts'], (tx) => {
    tx.objectStore('artifacts').put(saved);
  });
  return saved;
}
export async function restoreMaterial(material: Material) {
  await mutate(['materials', 'folders'], (tx, fail) => {
    const existing = tx.objectStore('materials').get(material.id);
    existing.onsuccess = () => {
      if (existing.result) {
        fail(new Error('Материал уже восстановлен'));
        return;
      }
      const folder = tx.objectStore('folders').get(material.folderId);
      folder.onsuccess = () =>
        tx.objectStore('materials').put({
          ...material,
          folderId: folder.result ? material.folderId : 'inbox',
          revision: material.revision + 1,
          updatedAt: new Date().toISOString(),
        });
    };
  });
}

export async function saveFolder(title: string, id: string = crypto.randomUUID()) {
  title = title.trim();
  if (!title) throw new Error('Введите название папки');
  if (
    snapshot.folders.some(
      (folder) =>
        folder.id !== id && folder.title.toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru'),
    )
  )
    throw new Error('Папка с таким названием уже есть');
  await mutate(['folders'], (tx) => {
    tx.objectStore('folders').put({
      id,
      title,
      createdAt:
        snapshot.folders.find((folder) => folder.id === id)?.createdAt ?? new Date().toISOString(),
    });
  });
  return id;
}

export async function deleteFolder(id: string) {
  if (['inbox', 'video-ideas', 'post-ideas', 'archive'].includes(id))
    throw new Error('Эта папка нужна для автоматической раскладки идей');
  await mutate(['folders', 'materials'], (tx) => {
    const request = tx.objectStore('materials').getAll();
    request.onsuccess = () => {
      for (const item of request.result as Material[])
        if (item.folderId === id)
          tx.objectStore('materials').put({
            ...item,
            folderId: 'inbox',
            updatedAt: new Date().toISOString(),
            revision: item.revision + 1,
          });
      tx.objectStore('folders').delete(id);
    };
  });
}

export async function importMarkdown(files: File[], folderId: string) {
  if (files.length > 50) throw new Error('За один раз можно импортировать до 50 файлов');
  await initializeLibrary();
  const prepared = [];
  for (const file of files) {
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 2_000_000)
      throw new Error(`«${file.name}»: нужен Markdown или текст до 2 МБ`);
    const body = await file.text();
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    prepared.push({
      id: `import-${folderId}-${digest}`,
      body,
      title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.name.replace(/\.[^.]+$/, ''),
    });
  }
  let imported = 0;
  for (const item of prepared) {
    if (snapshot.materials.some((material) => material.id === item.id)) continue;
    await saveMaterial({ ...item, folderId, source: 'manual', favorite: false });
    imported++;
  }
  return { imported, skipped: files.length - imported };
}
