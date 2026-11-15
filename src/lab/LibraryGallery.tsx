import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Select } from '../shared/Select';
import { Segment } from '../shared/ui';
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StackIcon,
  XIcon,
} from '@phosphor-icons/react';
import './library-gallery.css';
import { GlassFolder } from '../features/materials/GlassFolder';

type LibraryFile = {
  id: string;
  title: string;
  topic: string;
  updatedAt: string;
  authors: number;
  messages: number;
  format: string;
  text: string;
  questions: string[];
};
type LibraryFolder = { id: string; title: string; files: LibraryFile[] };
const samples: LibraryFolder[] = [
  {
    id: 'career',
    title: 'Карьера',
    files: [
      {
        id: 'first-interview',
        title: 'Первое собеседование без опыта',
        topic: 'Карьера',
        updatedAt: '2026-11-14T12:10:00+03:00',
        authors: 19,
        messages: 28,
        format: 'TikTok',
        text: 'Начать с учебного проекта. Показать не перечень инструментов, а ход работы: задача, гипотеза, проверка и результат.\n\nРазобрать один короткий ответ на вопрос «Расскажите о своём опыте».',
        questions: [
          'Что показать, если у меня пока только учебный проект?',
          'Как рассказать о себе без коммерческого опыта?',
        ],
      },
      {
        id: 'offer-check',
        title: 'Оффер: вопросы кроме зарплаты',
        topic: 'Карьера',
        updatedAt: '2026-11-13T16:30:00+03:00',
        authors: 14,
        messages: 19,
        format: 'Telegram',
        text: 'Собрать вопросы про команду, обратную связь, ожидания от роли и первые три месяца.\n\nОтдельно разобрать, как проверять обещания на собеседовании.',
        questions: [
          'На какие красные флаги смотреть в оффере?',
          'Что спросить у команды до выхода на работу?',
        ],
      },
      {
        id: 'market-shift',
        title: 'Что изменилось в найме за год',
        topic: 'IT-рынок',
        updatedAt: '2026-11-12T11:20:00+03:00',
        authors: 12,
        messages: 16,
        format: 'Telegram',
        text: 'Сравнить требования в вакансиях и вопросы на интервью. Отделить наблюдаемые изменения от впечатлений по отдельным примерам.',
        questions: [
          'Какие требования стали встречаться чаще?',
          'Почему описание junior-вакансии выглядит как middle?',
        ],
      },
    ],
  },
  {
    id: 'ai-development',
    title: 'AI и разработка',
    files: [
      {
        id: 'ai-learning',
        title: 'Когда AI помогает учиться',
        topic: 'AI',
        updatedAt: '2026-11-14T10:15:00+03:00',
        authors: 17,
        messages: 23,
        format: 'TikTok',
        text: 'Сравнить три режима: готовый ответ, подсказка и проверка собственной гипотезы.\n\nВзять одну задачу и показать разницу в процессе обучения.',
        questions: [
          'Почему с AI получается, а самостоятельно — нет?',
          'Как просить подсказку вместо готового решения?',
        ],
      },
      {
        id: 'small-project',
        title: 'Пет-проект, который можно закончить',
        topic: 'Разработка',
        updatedAt: '2026-11-11T15:40:00+03:00',
        authors: 10,
        messages: 14,
        format: 'Telegram',
        text: 'Ограничить идею до одного работающего сценария. Зафиксировать, что входит в первую версию и что оставляем на потом.',
        questions: [
          'Как выбрать масштаб проекта?',
          'Что лучше: один законченный проект или пять начатых?',
        ],
      },
      {
        id: 'ai-tools',
        title: 'AI-инструменты в обычный рабочий день',
        topic: 'AI',
        updatedAt: '2026-11-09T18:00:00+03:00',
        authors: 8,
        messages: 11,
        format: 'TikTok',
        text: 'Разобрать короткие повседневные задачи: поиск по документации, проверка предположения и подготовка черновика.',
        questions: [
          'Какие инструменты ты открываешь каждый день?',
          'Какие задачи быстрее сделать самостоятельно?',
        ],
      },
    ],
  },
  {
    id: 'audience',
    title: 'Вопросы аудитории',
    files: [
      {
        id: 'feedback',
        title: 'Как получать полезную обратную связь',
        topic: 'Личный опыт',
        updatedAt: '2026-11-14T09:30:00+03:00',
        authors: 9,
        messages: 12,
        format: 'Telegram',
        text: 'Показать конкретные вопросы вместо общего «Как тебе?». Отдельно разобрать обратную связь после собеседования.',
        questions: [
          'Как получить развёрнутый ответ?',
          'Что спросить, когда говорят «всё нормально»?',
        ],
      },
      {
        id: 'sql-first-job',
        title: 'SQL до первой работы',
        topic: 'Обучение',
        updatedAt: '2026-11-10T13:10:00+03:00',
        authors: 8,
        messages: 11,
        format: 'TikTok',
        text: 'Отделить полезную базу от бесконечного списка тем. Связать каждый пример запроса с рабочей задачей.',
        questions: [
          'Какой уровень SQL нужен для первой работы?',
          'Какие задачи действительно встречаются?',
        ],
      },
    ],
  },
  {
    id: 'scripts',
    title: 'Сценарии',
    files: [
      {
        id: 'research-testing',
        title: 'Автотесты и исследование продукта',
        topic: 'Тестирование',
        updatedAt: '2026-11-13T14:00:00+03:00',
        authors: 11,
        messages: 17,
        format: 'TikTok',
        text: 'Первый кадр: «Если все автотесты зелёные, можно выпускать?»\n\nПоказать новый вопрос к продукту, которого ещё нет в проверках. Завершить коротким примером исследовательского подхода.',
        questions: [
          'Зачем исследовать вручную, если есть автотесты?',
          'Какой баг не найдёт обычный автотест?',
        ],
      },
      {
        id: 'day-without-perfect-plan',
        title: 'Рабочий день без идеального плана',
        topic: 'Личный опыт',
        updatedAt: '2026-11-08T19:20:00+03:00',
        authors: 6,
        messages: 8,
        format: 'Telegram',
        text: 'Короткий материал о переключении контекста, неожиданных задачах и возвращении к тому, что важно закончить сегодня.',
        questions: [
          'Как ты совмещаешь работу, блог и обучение?',
          'Что делаешь, когда план на день уже не работает?',
        ],
      },
    ],
  },
];

function pluralFiles(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? 'материал' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'материала' : 'материалов'}`;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}
function markdown(file: LibraryFile) {
  return `# ${file.title}\n\nТема: ${file.topic}\nФормат: ${file.format}\nОснования: ${file.messages} сообщений, ${file.authors} авторов\n\n${file.text}\n\n## Вопросы аудитории\n\n${file.questions.map((question) => `- ${question}`).join('\n')}\n`;
}
function download(file: LibraryFile) {
  const url = URL.createObjectURL(
    new Blob([markdown(file)], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${file.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()}.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LibraryDialog({
  title,
  children,
  close,
  className = '',
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <motion.dialog
      className={`lib-dialog ${className}`}
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: reduced ? 0 : 0.22 }}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="lib-dialog-head">
        <span>{title}</span>
        <button
          type="button"
          className="lib-icon-button"
          onClick={close}
          aria-label="Закрыть окно библиотеки"
        >
          <XIcon size={20} />
        </button>
      </div>
      {children}
    </motion.dialog>
  );
}

function FileDialog({
  file,
  close,
  notify,
}: {
  file: LibraryFile;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [mode, setMode] = useState<'preview' | 'markdown'>('preview');
  return (
    <LibraryDialog title="Материал" close={close} className="lib-file-dialog">
      <span className="lib-file-topic">{file.topic}</span>
      <h3>{file.title}</h3>
      <div className="lib-file-properties">
        <span>
          <strong>{file.authors}</strong> авторов
        </span>
        <span>
          <strong>{file.messages}</strong> сообщений
        </span>
        <span>{file.format}</span>
        <span>{dateLabel(file.updatedAt)}</span>
      </div>
      <div
        className="lib-view-tabs"
        role="tablist"
        aria-label="Вид материала"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'preview'
              : event.key === 'End'
                ? 'markdown'
                : mode === 'preview'
                  ? 'markdown'
                  : 'preview';
          setMode(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#lib-view-${next}`)?.focus();
        }}
      >
        <button
          type="button"
          id="lib-view-preview"
          role="tab"
          aria-selected={mode === 'preview'}
          tabIndex={mode === 'preview' ? 0 : -1}
          aria-controls="lib-panel-preview"
          onClick={() => setMode('preview')}
        >
          Материал
        </button>
        <button
          type="button"
          id="lib-view-markdown"
          role="tab"
          aria-selected={mode === 'markdown'}
          tabIndex={mode === 'markdown' ? 0 : -1}
          aria-controls="lib-panel-markdown"
          onClick={() => setMode('markdown')}
        >
          Markdown
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'preview' ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            id="lib-panel-preview"
            role="tabpanel"
            aria-labelledby="lib-view-preview"
            className="lib-file-preview"
          >
            <p>{file.text}</p>
            <h4>Вопросы аудитории</h4>
            {file.questions.map((question) => (
              <blockquote key={question}>{question}</blockquote>
            ))}
          </motion.div>
        ) : (
          <motion.pre
            key="markdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            id="lib-panel-markdown"
            role="tabpanel"
            aria-labelledby="lib-view-markdown"
            className="lib-markdown"
          >
            {markdown(file)}
          </motion.pre>
        )}
      </AnimatePresence>
      <div className="lib-dialog-foot">
        <span>.md</span>
        <button
          type="button"
          className="lib-action lib-action-primary"
          onClick={() => {
            download(file);
            notify('Markdown скачан');
          }}
        >
          <DownloadSimpleIcon size={16} />
          Скачать Markdown
        </button>
      </div>
    </LibraryDialog>
  );
}

function FolderContents({ children }: { children: ReactNode }) {
  const measure = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setHeight(Math.ceil(node.getBoundingClientRect().height)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div
      className="lib-content-viewport"
      initial={false}
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div ref={measure} className="lib-content-measure">
        {children}
      </div>
    </motion.div>
  );
}

export function LibraryGallery({ notify }: { notify: (text: string) => void }) {
  const [folders, setFolders] = useState(samples);
  const [variant, setVariant] = useState<'folders' | 'collections'>('folders');
  const [openedFolder, setOpenedFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState('newest');
  const [openedFile, setOpenedFile] = useState<LibraryFile | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const reduced = useReducedMotion();
  const folderHeading = useRef<HTMLHeadingElement>(null);
  const returnFolder = useRef<string | null>(null);
  const contentKey = openedFolder ?? variant;
  useLayoutEffect(() => {
    if (openedFolder) folderHeading.current?.focus({ preventScroll: true });
    else if (returnFolder.current) {
      document.getElementById(`lib-tile-${returnFolder.current}`)?.focus({ preventScroll: true });
      returnFolder.current = null;
    }
  }, [openedFolder]);
  const current = folders.find((folder) => folder.id === openedFolder);
  const allFiles = useMemo(() => folders.flatMap((folder) => folder.files), [folders]);
  const filteredFiles = useMemo(
    () =>
      (current?.files ?? allFiles)
        .filter((file) =>
          `${file.title} ${file.text} ${file.topic}`
            .toLocaleLowerCase('ru')
            .includes(query.toLocaleLowerCase('ru')),
        )
        .sort((a, b) =>
          sort === 'authors' ? b.authors - a.authors : b.updatedAt.localeCompare(a.updatedAt),
        ),
    [current, allFiles, query, sort],
  );
  const visibleFiles = current || query || showAll ? filteredFiles : filteredFiles.slice(0, 4);
  const visibleFolders = folders.filter(
    (folder) =>
      !query ||
      folder.title.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')) ||
      folder.files.some((file) =>
        `${file.title} ${file.topic}`
          .toLocaleLowerCase('ru')
          .includes(query.toLocaleLowerCase('ru')),
      ),
  );
  const openFolder = (id: string) => {
    setOpenedFolder(id);
    setQuery('');
  };
  const back = () => {
    returnFolder.current = openedFolder;
    setOpenedFolder(null);
    setQuery('');
  };
  const createFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    const id = `folder-${Date.now().toString(36)}`;
    setFolders((previous) => [...previous, { id, title: name, files: [] }]);
    setNewFolder(false);
    setFolderName('');
    setOpenedFolder(null);
    setQuery('');
    notify(`Папка «${name}» добавлена`);
  };
  const addSample = () => {
    if (!current) return;
    const file = { ...samples[0].files[0], id: `sample-${Date.now().toString(36)}` };
    setFolders((previous) =>
      previous.map((folder) =>
        folder.id === current.id ? { ...folder, files: [...folder.files, file] } : folder,
      ),
    );
    notify('Материал добавлен в папку');
  };
  return (
    <section id="library" className="lib-section">
      <div className="lib-section-head">
        <div>
          <span className="lib-section-index">03</span>
          <h2>Библиотека</h2>
        </div>
        <Segment
          className="lib-variant-switch"
          label="Вариант библиотеки"
          value={variant}
          onChange={(value) => {
            setVariant(value as 'folders' | 'collections');
            back();
          }}
          values={[
            { id: 'folders', label: 'Папки', icon: <FolderIcon size={18} /> },
            { id: 'collections', label: 'Коллекции', icon: <StackIcon size={18} /> },
          ]}
        />
      </div>
      <div className="lib-toolbar">
        <div className="lib-breadcrumb">
          <button
            type="button"
            onClick={back}
            disabled={!current}
            aria-label="Все папки библиотеки"
          >
            Библиотека
          </button>
          {current && (
            <>
              <CaretRightIcon size={14} />
              <span>{current.title}</span>
            </>
          )}
        </div>
        <button type="button" className="lib-action" onClick={() => setNewFolder(true)}>
          <PlusIcon size={16} />
          Новая папка
        </button>
      </div>
      <div className="lib-browser ec-glow">
        <div className="lib-controls">
          <label className="lib-search">
            <MagnifyingGlassIcon size={17} />
            <input
              type="search"
              name="library-search"
              aria-label="Поиск в библиотеке"
              placeholder={current ? 'Найти материал…' : 'Найти папку или материал…'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className="lib-search-clear"
                aria-label="Очистить поиск библиотеки"
                onClick={() => setQuery('')}
              >
                <XIcon size={15} />
              </button>
            )}
          </label>
          <div className="lib-sort">
            <Select
              label="Сортировать материалы"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'newest', label: 'Сначала новые' },
                { value: 'authors', label: 'По авторам' },
              ]}
            />
          </div>
        </div>
        <FolderContents>
          <LayoutGroup id="library-folders">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={contentKey}
                className="lib-content"
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: reduced ? 0 : 0.25 }}
              >
                {!current && (
                  <div
                    className={`lib-folder-grid ${variant === 'collections' ? 'lib-collection-grid' : ''}`}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      {visibleFolders.map((folder, index) => (
                        <motion.button
                          type="button"
                          key={folder.id}
                          id={`lib-tile-${folder.id}`}
                          layout="position"
                          initial={reduced ? false : { opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            duration: reduced ? 0 : 0.35,
                            delay: reduced ? 0 : index * 0.035,
                          }}
                          className={`lib-folder-tile ec-glow ${variant === 'collections' ? 'lib-collection-tile' : ''}`}
                          onClick={() => openFolder(folder.id)}
                          aria-label={`Открыть папку «${folder.title}», ${pluralFiles(folder.files.length)}`}
                        >
                          {variant === 'folders' ? (
                            <motion.div
                              className="lib-folder-visual"
                              layoutId={`folder-art-${folder.id}`}
                              transition={{ duration: reduced ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
                            >
                              <GlassFolder empty={!folder.files.length} />
                            </motion.div>
                          ) : (
                            <div className="lib-stack-visual" aria-hidden="true">
                              <span className="lib-stack-sheet third" />
                              <span className="lib-stack-sheet second" />
                              <span className="lib-stack-sheet first">
                                <FileTextIcon size={25} />
                                <span>{String(index + 1).padStart(2, '0')}</span>
                              </span>
                            </div>
                          )}
                          <div className="lib-folder-name">
                            <strong>{folder.title}</strong>
                            <span>{pluralFiles(folder.files.length)}</span>
                          </div>
                          <ArrowUpRightIcon className="lib-folder-open" size={17} />
                          {variant === 'collections' && (
                            <p className="lib-collection-latest">
                              {folder.files[0]?.title ?? 'Без материалов'}
                            </p>
                          )}
                        </motion.button>
                      ))}
                      {!visibleFolders.length && (
                        <motion.div
                          className="lib-empty"
                          key="folder-search-empty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduced ? 0 : 0.2 }}
                        >
                          <span className="lib-empty-search">
                            <MagnifyingGlassIcon size={32} />
                          </span>
                          <h3>Ничего не найдено</h3>
                          <p>Попробуйте другое название или тему материала.</p>
                          <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="lib-text-action"
                          >
                            Сбросить поиск
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {current && (
                  <div className="lib-open-folder">
                    <motion.div
                      className="lib-open-folder-art"
                      layoutId={variant === 'folders' ? `folder-art-${current.id}` : undefined}
                      transition={{ duration: reduced ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <GlassFolder empty={!current.files.length} />
                    </motion.div>
                    <div>
                      <span className="lib-folder-caption">Открытая папка</span>
                      <h3 ref={folderHeading} tabIndex={-1}>
                        {current.title}
                      </h3>
                      <p>{pluralFiles(current.files.length)} · Markdown</p>
                    </div>
                    <button type="button" className="lib-action" onClick={back}>
                      <ArrowLeftIcon size={17} />
                      Все папки
                    </button>
                  </div>
                )}
                <div className="lib-files-heading">
                  <h3>
                    {current
                      ? query
                        ? 'Результаты поиска'
                        : 'Материалы папки'
                      : query
                        ? 'Материалы по запросу'
                        : showAll
                          ? 'Все материалы'
                          : 'Недавние материалы'}
                  </h3>
                  <div className="lib-files-heading-actions">
                    <span>
                      {!current && !query && !showAll && filteredFiles.length > 4
                        ? `${visibleFiles.length} из ${filteredFiles.length}`
                        : pluralFiles(filteredFiles.length)}
                    </span>
                    {!current && !query && filteredFiles.length > 4 && (
                      <button
                        type="button"
                        className="lib-files-expand"
                        aria-expanded={showAll}
                        aria-controls="lib-file-list"
                        onClick={() => setShowAll((previous) => !previous)}
                      >
                        {showAll ? 'Свернуть' : 'Все материалы'}
                      </button>
                    )}
                  </div>
                </div>
                <motion.div
                  layout="size"
                  id="lib-file-list"
                  className={`lib-file-list ${current ? 'lib-paper-grid' : ''}`}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {visibleFiles.map((file, index) => (
                      <motion.button
                        type="button"
                        className={`lib-file-row ec-glow ${current ? 'lib-paper-card' : ''}`}
                        key={file.id}
                        layout="position"
                        initial={
                          reduced
                            ? false
                            : { opacity: 0, y: current ? 28 : 10, rotate: current ? -1.5 : 0 }
                        }
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{
                          duration: reduced ? 0 : 0.4,
                          delay: reduced ? 0 : Math.min(index * 0.04, 0.16),
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        onClick={() => setOpenedFile(file)}
                      >
                        {current && <span className="lib-paper-fold" aria-hidden="true" />}
                        <span className="lib-file-icon">
                          <FileTextIcon size={21} />
                        </span>
                        {current && (
                          <span className="lib-paper-excerpt">{file.text.split('\n')[0]}</span>
                        )}
                        <span className="lib-file-row-title">
                          <strong>{file.title}</strong>
                          <span>
                            {file.topic} · {file.authors} авторов
                          </span>
                        </span>
                        <span className="lib-row-date">{dateLabel(file.updatedAt)}</span>
                        <span className="lib-row-extension">.md</span>
                        <ArrowUpRightIcon size={16} className="lib-row-arrow" />
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </motion.div>
                {current && !filteredFiles.length && (
                  <div className="lib-empty">
                    {query ? (
                      <span className="lib-empty-search">
                        <MagnifyingGlassIcon size={32} />
                      </span>
                    ) : (
                      <div className="lib-empty-folder">
                        <GlassFolder empty />
                      </div>
                    )}
                    <h3>{query ? 'Материалов не найдено' : 'Папка пуста'}</h3>
                    <p>
                      {query
                        ? 'Попробуйте другое слово или сбросьте поиск.'
                        : 'Добавьте первый материал — он появится здесь отдельным листом.'}
                    </p>
                    {!query && (
                      <button
                        type="button"
                        className="lib-action lib-action-primary"
                        onClick={addSample}
                      >
                        <PlusIcon size={18} />
                        Добавить материал
                      </button>
                    )}
                    <button
                      type="button"
                      className="lib-text-action"
                      onClick={query ? () => setQuery('') : back}
                    >
                      {query ? (
                        'Сбросить поиск'
                      ) : (
                        <>
                          <ArrowLeftIcon size={15} />
                          Вернуться к папкам
                        </>
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </LayoutGroup>
        </FolderContents>
      </div>
      <AnimatePresence>
        {openedFile && (
          <FileDialog
            key="file-dialog"
            file={openedFile}
            close={() => setOpenedFile(null)}
            notify={notify}
          />
        )}
        {newFolder && (
          <LibraryDialog
            key="new-folder-dialog"
            title="Новая папка"
            close={() => setNewFolder(false)}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createFolder();
              }}
            >
              <label className="lib-name-label">
                Название
                <input
                  name="folder-title"
                  aria-label="Название папки"
                  required
                  maxLength={80}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Например, интервью…"
                  autoComplete="off"
                />
              </label>
              <div className="lib-dialog-foot">
                <button type="button" className="lib-action" onClick={() => setNewFolder(false)}>
                  Отменить
                </button>
                <button type="submit" className="lib-action lib-action-primary">
                  <FolderPlusIcon size={16} />
                  Создать папку
                </button>
              </div>
            </form>
          </LibraryDialog>
        )}
      </AnimatePresence>
    </section>
  );
}
