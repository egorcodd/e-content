import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { LabDialog as Dialog, Segment, downloadText } from '../../shared/ui';
import { Select } from '../../shared/Select';
import { GlassFolder } from '../../features/materials/GlassFolder';
import { MaterialEditor } from '../../features/materials/MaterialEditor';
import { IdeaTable } from '../../features/materials/IdeaTable';
import { ideaMarkdown, ideasMarkdown } from '../../features/materials/export';
import {
  evidenceForSource,
  evidenceSummary,
  formatLabels,
  statusLabels,
} from '../../features/materials/idea-model';
import {
  applyLibraryReset,
  deleteFolder,
  deleteMaterial,
  importMarkdown,
  saveFolder,
  saveMaterial,
  restoreMaterial,
  useLibrary,
  type Material,
} from '../../features/materials/repository';
import './materials.css';
import { importAiMaterials, importIdeas } from '../../features/collection/import-ideas';
import { api } from '../../features/collection/api';
import type { CollectionRun } from '../../features/collection/contracts';
export { initializeLibrary as preloadMaterials } from '../../features/materials/repository';

const count = (value: number) =>
  `${value} ${value % 10 === 1 && value % 100 !== 11 ? 'идея' : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 12 || value % 100 > 14) ? 'идеи' : 'идей'}`;
const priorityOrder = { high: 0, normal: 1, low: 2 };
export default function MaterialsPage({ notify }: { notify: (message: string) => void }) {
  const library = useLibrary();
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      if (checking || disposed) return;
      checking = true;
      clearTimeout(timer);
      try {
        const { run, libraryReset, ideaAnalysisVersion, aiMaterialsVersion } = await api<{
          run: CollectionRun | null;
          libraryReset?: string | null;
          ideaAnalysisVersion?: number;
          aiMaterialsVersion?: string | null;
        }>('/collection/latest');
        if (disposed) return;
        await applyLibraryReset(libraryReset);
        if (run) await importIdeas(run, ideaAnalysisVersion);
        await importAiMaterials(aiMaterialsVersion);
        if (!disposed) timer = setTimeout(sync, run?.status === 'running' ? 3000 : 10000);
      } catch {
        if (!disposed) timer = setTimeout(sync, 15000);
      } finally {
        checking = false;
      }
    };
    void sync();
    window.addEventListener('focus', sync);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', sync);
    };
  }, []);
  const pageElement = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const preserveViewport = () => {
      const element = pageElement.current;
      if (!element) return;
      const pageTop = element.getBoundingClientRect().top + scrollY;
      const main = element.closest('main');
      const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) : 0;
      element.style.minHeight = `${Math.max(0, scrollY + innerHeight - pageTop - bottom)}px`;
    };
    window.addEventListener('scroll', preserveViewport, { passive: true });
    window.addEventListener('resize', preserveViewport);
    preserveViewport();
    return () => {
      window.removeEventListener('scroll', preserveViewport);
      window.removeEventListener('resize', preserveViewport);
    };
  }, []);
  const [folderId, setFolderId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('folder'),
  );
  const [view, setView] = useState('folders');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [format, setFormat] = useState('all');
  const activeFormat = source === 'tiktok' ? 'video' : format;
  const [status, setStatus] = useState('all');
  const [signal, setSignal] = useState('all');
  const [sort, setSort] = useState('newest');
  const [editor, setEditor] = useState<{ material?: Material } | null>(null);
  const [folderForm, setFolderForm] = useState<{ id?: string; title: string } | null>(null);
  const [remove, setRemove] = useState<Material | 'folder' | null>(null);
  const [removed, setRemoved] = useState<Material | null>(null);
  const [move, setMove] = useState<Material | null>(null);
  const [destination, setDestination] = useState('inbox');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initial = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const folder = library.folders.find((item) => item.id === folderId);
  useEffect(() => {
    const update = () => {
      const params = new URLSearchParams(location.search);
      setFolderId(params.get('folder'));
      const material = library.materials.find((item) => item.id === params.get('material'));
      setEditor(material ? { material } : null);
    };
    if (!library.loading && initial.current) {
      initial.current = false;
      update();
    }
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [library.loading, library.materials]);
  function updateUrl(nextFolder: string | null, material?: string) {
    const url = new URL(location.href);
    if (nextFolder) url.searchParams.set('folder', nextFolder);
    else url.searchParams.delete('folder');
    if (material) url.searchParams.set('material', material);
    else url.searchParams.delete('material');
    history.replaceState(null, '', url);
  }
  function openFolder(id: string | null) {
    setFolderId(id);
    setQuery('');
    updateUrl(id);
  }
  function openMaterial(material?: Material) {
    setEditor({ material });
    updateUrl(folderId, material?.id);
  }
  function closeEditor() {
    setEditor(null);
    updateUrl(folderId);
  }
  const filtered =
    !!query || source !== 'all' || format !== 'all' || status !== 'all' || signal !== 'all';
  const showFolders = !folder && view === 'folders' && !filtered;
  const materials = useMemo(
    () =>
      library.materials
        .filter((item) => {
          const summary = evidenceSummary(evidenceForSource(item.evidence, source));
          return (
            (!folder || item.folderId === folder.id) &&
            (folder?.id === 'archive' || status === 'archived' || item.status !== 'archived') &&
            (view !== 'favorites' || item.favorite) &&
            (source === 'all' ||
              item.evidence.some((entry) => entry.source === source) ||
              (!item.evidence.length && item.source === source)) &&
            (activeFormat === 'all' || item.format === activeFormat) &&
            (status === 'all' || item.status === status) &&
            (signal === 'all' || summary.level === signal) &&
            `${item.title}\n${item.body}\n${item.evidence.map((entry) => entry.text).join('\n')}`
              .toLocaleLowerCase('ru')
              .includes(query.toLocaleLowerCase('ru'))
          );
        })
        .sort((a, b) =>
          sort === 'priority'
            ? priorityOrder[a.priority] - priorityOrder[b.priority] ||
              b.createdAt.localeCompare(a.createdAt)
            : sort === 'mentions'
              ? evidenceSummary(evidenceForSource(b.evidence, source)).mentions -
                  evidenceSummary(evidenceForSource(a.evidence, source)).mentions ||
                b.createdAt.localeCompare(a.createdAt)
              : sort === 'title'
                ? a.title.localeCompare(b.title, 'ru')
                : b.createdAt.localeCompare(a.createdAt),
        ),
    [library.materials, folder, view, query, source, activeFormat, status, signal, sort],
  );
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить изменения');
    } finally {
      setBusy(false);
    }
  }
  async function update(
    material: Material,
    patch: Partial<Pick<Material, 'status' | 'priority' | 'favorite'>>,
  ) {
    await act(async () => {
      await saveMaterial({ ...material, ...patch }, material.revision);
    });
  }
  async function confirmRemove() {
    await act(async () => {
      if (remove === 'folder' && folder) {
        await deleteFolder(folder.id);
        openFolder(null);
        notify('Папка удалена. Идеи перенесены в «Неразобранное»');
      } else if (remove && remove !== 'folder') {
        setRemoved((await deleteMaterial(remove.id)) ?? null);
      }
      setRemove(null);
    });
  }
  function download(material: Material) {
    downloadText(`${material.title.replace(/[<>:"/\\|?*]/g, '-')}.md`, ideaMarkdown(material));
  }
  return (
    <div ref={pageElement} className="materials-page">
      <header className="mp-heading">
        <div>
          <h1>Материалы</h1>
          <span>{count(library.materials.length)} в библиотеке</span>
        </div>
        <div className="mp-actions">
          <button
            className="ec-button"
            onClick={() => input.current?.click()}
            disabled={busy || library.loading}
          >
            <UploadSimpleIcon size={18} />
            <span>Импорт MD</span>
          </button>
          <button
            className="ec-button ec-white"
            onClick={() => openMaterial()}
            disabled={library.loading}
          >
            <PlusIcon size={18} />
            <span>Добавить идею</span>
          </button>
        </div>
      </header>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".md,.markdown,.txt"
        multiple
        aria-label="Импорт Markdown"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length)
            void act(async () => {
              const result = await importMarkdown(files, folder?.id ?? 'inbox');
              notify(
                `Импортировано: ${result.imported}${result.skipped ? `. Уже есть: ${result.skipped}` : ''}`,
              );
            });
        }}
      />
      <div className="mp-toolbar">
        <Segment
          label="Раздел библиотеки"
          value={view}
          onChange={(value) => {
            setView(value);
            setFolderId(null);
            updateUrl(null);
            setSort(value === 'favorites' ? 'priority' : 'newest');
          }}
          values={[
            { id: 'folders', label: 'Папки' },
            { id: 'all', label: 'Все идеи' },
            { id: 'favorites', label: 'Избранное', icon: <StarIcon size={16} /> },
          ]}
        />
        <div className="mp-actions">
          {folder && (
            <>
              <button
                className="ec-icon"
                aria-label="Переименовать папку"
                onClick={() => setFolderForm({ id: folder.id, title: folder.title })}
              >
                <PencilSimpleIcon size={18} />
              </button>
              {!['inbox', 'video-ideas', 'post-ideas', 'archive'].includes(folder.id) && (
                <button
                  className="ec-icon"
                  aria-label="Удалить папку"
                  onClick={() => setRemove('folder')}
                >
                  <TrashIcon size={18} />
                </button>
              )}
            </>
          )}
          <button className="ec-button" onClick={() => setFolderForm({ title: '' })}>
            <PlusIcon size={16} />
            Новая папка
          </button>
        </div>
      </div>
      <section className="mp-browser ec-glow" aria-label="Библиотека идей">
        <div className="mi-browser-top">
          <label className="mp-search">
            <MagnifyingGlassIcon size={18} />
            <input
              type="search"
              aria-label="Поиск идей"
              placeholder="Найти тему, вопрос или реплику…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Очистить поиск" onClick={() => setQuery('')}>
                <XIcon size={16} />
              </button>
            )}
          </label>
          {!showFolders && (
            <button
              className="ec-button"
              disabled={!materials.length}
              onClick={() => downloadText('e-content-ideas.md', ideasMarkdown(materials))}
            >
              <DownloadSimpleIcon size={17} />
              Экспорт MD <span className="mi-export-count">{materials.length}</span>
            </button>
          )}
        </div>
        {!showFolders && (
          <div className="mi-filters">
            <Select
              label="Источник идей"
              value={source}
              onChange={(value) => {
                setSource(value);
                if (value === 'tiktok') setFormat('all');
              }}
              options={[
                { value: 'all', label: 'Все источники' },
                { value: 'telegram', label: 'Telegram' },
                { value: 'tiktok', label: 'TikTok' },
                { value: 'manual', label: 'Вручную' },
              ]}
            />
            <Select
              label="Формат идей"
              value={activeFormat}
              onChange={setFormat}
              options={
                source === 'tiktok'
                  ? [{ value: 'video', label: 'Видео' }]
                  : [
                      { value: 'all', label: 'Любой формат' },
                      ...Object.entries(formatLabels).map(([value, label]) => ({ value, label })),
                    ]
              }
            />
            <Select
              label="Статус идей"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'Все статусы' },
                ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
            <Select
              label="Повторяемость идей"
              value={signal}
              onChange={setSignal}
              options={[
                { value: 'all', label: 'Любая частота' },
                { value: 'high', label: 'Часто' },
                { value: 'medium', label: 'Повторяется' },
                { value: 'low', label: 'Единично' },
                { value: 'unknown', label: 'Нет оснований' },
              ]}
            />
            <Select
              label="Сортировать идеи"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'newest', label: 'Сначала новые' },
                { value: 'priority', label: 'По приоритету' },
                { value: 'mentions', label: 'По упоминаниям' },
                { value: 'title', label: 'По названию' },
              ]}
            />
            {filtered && (
              <button
                className="ec-icon"
                aria-label="Сбросить фильтры"
                onClick={() => {
                  setQuery('');
                  setSource('all');
                  setFormat('all');
                  setStatus('all');
                  setSignal('all');
                }}
              >
                <XIcon size={17} />
              </button>
            )}
          </div>
        )}
        {(error || library.error) && (
          <p className="mp-error" role="alert">
            {error || library.error}
          </p>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={showFolders ? 'folders' : (folder?.id ?? view)}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            {showFolders ? (
              <div className="mp-folder-grid">
                {library.folders.map((item) => (
                  <button key={item.id} className="mp-folder" onClick={() => openFolder(item.id)}>
                    <span className="mp-folder-art">
                      <GlassFolder
                        empty={!library.materials.some((material) => material.folderId === item.id)}
                      />
                    </span>
                    <strong>{item.title}</strong>
                    <small>
                      {count(
                        library.materials.filter((material) => material.folderId === item.id)
                          .length,
                      )}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="mp-list-heading">
                  <div className="mp-breadcrumb">
                    {folder && (
                      <>
                        <button onClick={() => openFolder(null)}>
                          <ArrowLeftIcon size={17} />
                          Все папки
                        </button>
                        <span>/</span>
                      </>
                    )}
                    <h2>
                      {folder?.title ??
                        (view === 'favorites'
                          ? 'Избранное'
                          : filtered
                            ? 'Найденные идеи'
                            : 'Все идеи')}
                    </h2>
                  </div>
                  <span>{count(materials.length)}</span>
                </div>
                {materials.length ? (
                  <IdeaTable
                    materials={materials}
                    allMaterials={library.materials}
                    source={source}
                    groupByDate={sort === 'newest'}
                    busy={busy}
                    open={openMaterial}
                    favorite={(item) => void update(item, { favorite: !item.favorite })}
                    update={(item, patch) => void update(item, patch)}
                    move={(item) => {
                      setDestination(item.folderId);
                      setMove(item);
                    }}
                    download={download}
                    remove={setRemove}
                  />
                ) : (
                  <div className="mp-empty">
                    <FolderSimpleIcon size={36} weight="light" />
                    <h3>
                      {filtered
                        ? 'Ничего не найдено'
                        : view === 'favorites'
                          ? 'Здесь будут избранные идеи'
                          : 'Пока нет идей'}
                    </h3>
                    <p>
                      {filtered
                        ? 'Измените запрос или фильтры.'
                        : view === 'favorites'
                          ? 'Отмечайте идеи звездой и задавайте приоритет.'
                          : 'Сюда попадут найденные темы с исходными вопросами и публикациями. Можно добавить идею вручную.'}
                    </p>
                    {!filtered && (
                      <button className="ec-button" onClick={() => openMaterial()}>
                        Добавить идею
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
      {removed && (
        <div className="mp-undo" role="status">
          <span>Идея «{removed.title}» удалена</span>
          <button
            className="ec-button"
            onClick={() =>
              void act(async () => {
                await restoreMaterial(removed);
                setRemoved(null);
                notify('Идея восстановлена');
              })
            }
          >
            Восстановить
          </button>
          <button
            className="ec-icon"
            aria-label="Скрыть отмену удаления"
            onClick={() => setRemoved(null)}
          >
            <XIcon size={17} />
          </button>
        </div>
      )}
      <AnimatePresence>
        {editor && (
          <MaterialEditor
            key={editor.material?.id ?? 'new'}
            material={editor.material}
            folders={library.folders}
            folderId={folder?.id ?? 'inbox'}
            close={closeEditor}
            notify={notify}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {move && (
          <Dialog title="Перенести идею" close={() => setMove(null)}>
            <p className="mp-muted">{move.title}</p>
            <Select
              label="Куда перенести"
              value={destination}
              onChange={setDestination}
              options={library.folders.map((item) => ({ value: item.id, label: item.title }))}
            />
            {error && (
              <p className="mp-error" role="alert">
                {error}
              </p>
            )}
            <div className="ec-dialog-actions">
              <button className="ec-button" onClick={() => setMove(null)}>
                Отмена
              </button>
              <button
                className="ec-button ec-white"
                disabled={busy || destination === move.folderId}
                onClick={() =>
                  void act(async () => {
                    await saveMaterial({ ...move, folderId: destination }, move.revision);
                    setMove(null);
                    notify('Идея перенесена');
                  })
                }
              >
                Перенести
              </button>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {folderForm && (
          <Dialog
            title={folderForm.id ? 'Переименовать папку' : 'Новая папка'}
            close={() => setFolderForm(null)}
          >
            <form
              className="mp-folder-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await saveFolder(folderForm.title, folderForm.id);
                  setFolderForm(null);
                  notify('Папка сохранена');
                });
              }}
            >
              <label>
                Название папки
                <input
                  autoFocus
                  aria-label="Название папки"
                  value={folderForm.title}
                  onChange={(event) => setFolderForm({ ...folderForm, title: event.target.value })}
                  required
                  maxLength={100}
                />
              </label>
              {error && (
                <p className="mp-error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="ec-button ec-white"
                disabled={busy || !folderForm.title.trim()}
              >
                Сохранить папку
              </button>
            </form>
          </Dialog>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {remove && (
          <Dialog
            title={remove === 'folder' ? 'Удалить папку' : 'Удалить идею'}
            close={() => setRemove(null)}
          >
            <p>
              {remove === 'folder'
                ? 'Идеи останутся в папке «Неразобранное».'
                : `Удалить «${remove.title}»? Идею можно будет восстановить.`}
            </p>
            {error && (
              <p className="mp-error" role="alert">
                {error}
              </p>
            )}
            <div className="ec-dialog-actions">
              <button className="ec-button" onClick={() => setRemove(null)}>
                Отмена
              </button>
              <button
                className="ec-button ec-white"
                disabled={busy}
                onClick={() => void confirmRemove()}
              >
                Удалить
              </button>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
