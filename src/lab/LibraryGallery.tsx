import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Layers3,
  Plus,
  Search,
  X,
} from 'lucide-react';
import './library-gallery.css';

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
  return `# ${file.title}\n\n> Демонстрационный материал дизайн-системы e-content.\n\nТема: ${file.topic}\nФормат: ${file.format}\nОснования: ${file.messages} сообщений, ${file.authors} авторов\n\n${file.text}\n\n## Вопросы аудитории\n\n${file.questions.map((question) => `- ${question}`).join('\n')}\n`;
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

function GlassFolder({ id, empty = false }: { id: string; empty?: boolean }) {
  return (
    <svg
      className={`lib-folder-art ${empty ? 'is-empty' : ''}`}
      viewBox="0 0 220 168"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`lib-back-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#535353" />
          <stop offset=".45" stopColor="#373737" />
          <stop offset="1" stopColor="#1d1d1d" />
        </linearGradient>
        <linearGradient id={`lib-front-${id}`} x1="0" y1="0" x2="1" y2=".8">
          <stop stopColor="#555" stopOpacity=".95" />
          <stop offset=".48" stopColor="#3a3a3a" stopOpacity=".88" />
          <stop offset="1" stopColor="#292929" stopOpacity=".96" />
        </linearGradient>
        <linearGradient id={`lib-rim-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#bcbcbc" stopOpacity=".65" />
          <stop offset=".4" stopColor="#777" stopOpacity=".2" />
          <stop offset="1" stopColor="#444" stopOpacity=".1" />
        </linearGradient>
        <linearGradient id={`lib-paper-${id}`} x1="0" y1="0" x2=".6" y2="1">
          <stop stopColor="#ededed" />
          <stop offset="1" stopColor="#aaa" />
        </linearGradient>
        <radialGradient id={`lib-light-${id}`} cx=".5" cy="0" r=".9">
          <stop stopColor="#d4d4d4" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`lib-shadow-${id}`} x="-30%" y="-25%" width="160%" height="170%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000" floodOpacity=".35" />
        </filter>
      </defs>
      <ellipse cx="111" cy="151" rx="82" ry="8" fill="#000" opacity=".2" />
      <path
        className="lib-folder-back"
        d="M29 51Q29 39 41 39H82L96 49H180Q192 49 192 62V132Q192 146 178 146H42Q29 146 29 132Z"
        fill={`url(#lib-back-${id})`}
        stroke="#777"
        strokeOpacity=".25"
      />
      {!empty && (
        <g className="lib-folder-papers">
          <path d="M66 34H121L140 51V121H66Z" fill="#b0b0b0" transform="rotate(-10 103 90)" />
          <path d="M88 24H139L160 44V126H88Z" fill={`url(#lib-paper-${id})`} />
          <path d="M139 24V44H160Z" fill="#fff" fillOpacity=".85" />
          <path d="M112 40H156L175 58V129H112Z" fill="#f1f1f1" transform="rotate(9 142 95)" />
          <path
            d="M125 75H151M125 83H160M125 91H155"
            stroke="#777"
            strokeOpacity=".2"
            strokeWidth="2"
            transform="rotate(9 142 95)"
          />
        </g>
      )}
      <g className="lib-folder-front" filter={`url(#lib-shadow-${id})`}>
        <path
          d="M22 67Q22 54 35 54H97L114 67H181Q198 67 198 83V133Q198 148 182 148H38Q22 148 22 132Z"
          fill={`url(#lib-front-${id})`}
          stroke={`url(#lib-rim-${id})`}
          strokeWidth="1.2"
        />
        <path
          d="M24 69Q24 56 37 56H96L113 69H180Q196 69 196 84V132Q196 146 182 146H38Q24 146 24 132Z"
          fill={`url(#lib-light-${id})`}
        />
        <path
          d="M35 56H96L113 69H180Q193 69 195 79"
          fill="none"
          stroke="#ddd"
          strokeOpacity=".12"
          strokeWidth="1"
        />
        <text
          x="38"
          y="130"
          fill="#c0c0c0"
          opacity=".35"
          fontSize="12"
          fontFamily="inherit"
          letterSpacing="-.3"
        >
          e-content
        </text>
      </g>
    </svg>
  );
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
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className={`lib-dialog ${className}`}
      ref={ref}
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
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
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
      {mode === 'preview' ? (
        <div
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
        </div>
      ) : (
        <pre
          id="lib-panel-markdown"
          role="tabpanel"
          aria-labelledby="lib-view-markdown"
          className="lib-markdown"
        >
          {markdown(file)}
        </pre>
      )}
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
          <ArrowDownToLine size={16} />
          Скачать Markdown
        </button>
      </div>
    </LibraryDialog>
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
  return (
    <section id="library" className="lib-section">
      <div className="lib-section-head">
        <div>
          <span className="lib-section-index">03</span>
          <h2>Библиотека</h2>
        </div>
        <div className="lib-variant-switch" aria-label="Вариант библиотеки">
          <button
            type="button"
            aria-pressed={variant === 'folders'}
            onClick={() => {
              setVariant('folders');
              back();
            }}
          >
            <Folder size={15} />
            Папки
          </button>
          <button
            type="button"
            aria-pressed={variant === 'collections'}
            onClick={() => {
              setVariant('collections');
              back();
            }}
          >
            <Layers3 size={15} />
            Коллекции
          </button>
        </div>
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
              <ChevronRight size={14} />
              <span>{current.title}</span>
            </>
          )}
        </div>
        <button type="button" className="lib-action" onClick={() => setNewFolder(true)}>
          <Plus size={16} />
          Новая папка
        </button>
      </div>
      <div className="lib-browser">
        <div className="lib-controls">
          <label className="lib-search">
            <Search size={17} />
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
                <X size={15} />
              </button>
            )}
          </label>
          <label className="lib-sort">
            <span className="lib-visually-hidden">Сортировать материалы</span>
            <select
              name="library-sort"
              aria-label="Сортировать материалы"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Сначала новые</option>
              <option value="authors">По авторам</option>
            </select>
          </label>
        </div>
        {!current && (
          <div
            className={`lib-folder-grid ${variant === 'collections' ? 'lib-collection-grid' : ''}`}
          >
            {visibleFolders.map((folder, index) => (
              <button
                type="button"
                key={folder.id}
                className={`lib-folder-tile ${variant === 'collections' ? 'lib-collection-tile' : ''}`}
                onClick={() => openFolder(folder.id)}
                aria-label={`Открыть папку «${folder.title}», ${pluralFiles(folder.files.length)}`}
              >
                {variant === 'folders' ? (
                  <div className="lib-folder-visual">
                    <GlassFolder id={folder.id} empty={!folder.files.length} />
                  </div>
                ) : (
                  <div className="lib-stack-visual" aria-hidden="true">
                    <span className="lib-stack-sheet third" />
                    <span className="lib-stack-sheet second" />
                    <span className="lib-stack-sheet first">
                      <FileText size={25} strokeWidth={1.2} />
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </span>
                  </div>
                )}
                <div className="lib-folder-name">
                  <strong>{folder.title}</strong>
                  <span>{pluralFiles(folder.files.length)}</span>
                </div>
                <ArrowUpRight className="lib-folder-open" size={17} />
                {variant === 'collections' && (
                  <p className="lib-collection-latest">
                    {folder.files[0]?.title ?? 'Без материалов'}
                  </p>
                )}
              </button>
            ))}
            {!visibleFolders.length && (
              <div className="lib-empty">
                <Search size={24} strokeWidth={1.3} />
                <h3>Ничего не найдено</h3>
                <button type="button" onClick={() => setQuery('')} className="lib-text-action">
                  Сбросить поиск
                </button>
              </div>
            )}
          </div>
        )}
        <div className="lib-files-heading">
          <h3>
            {current
              ? current.title
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
        <div id="lib-file-list" className="lib-file-list">
          {visibleFiles.map((file) => (
            <button
              type="button"
              className="lib-file-row"
              key={file.id}
              onClick={() => setOpenedFile(file)}
            >
              <span className="lib-file-icon">
                <FileText size={18} strokeWidth={1.4} />
              </span>
              <span className="lib-file-row-title">
                <strong>{file.title}</strong>
                <span>
                  {file.topic} · {file.authors} авторов
                </span>
              </span>
              <span className="lib-row-date">{dateLabel(file.updatedAt)}</span>
              <span className="lib-row-extension">.md</span>
              <ArrowUpRight size={16} className="lib-row-arrow" />
            </button>
          ))}
        </div>
        {current && !filteredFiles.length && (
          <div className="lib-empty">
            <Folder size={27} strokeWidth={1.2} />
            <h3>{query ? 'Материалов не найдено' : 'Папка пуста'}</h3>
            <button
              type="button"
              className="lib-text-action"
              onClick={query ? () => setQuery('') : back}
            >
              {query ? (
                'Сбросить поиск'
              ) : (
                <>
                  <ArrowLeft size={15} />
                  Все папки
                </>
              )}
            </button>
          </div>
        )}
      </div>
      {openedFile && (
        <FileDialog file={openedFile} close={() => setOpenedFile(null)} notify={notify} />
      )}
      {newFolder && (
        <LibraryDialog title="Новая папка" close={() => setNewFolder(false)}>
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
                <FolderPlus size={16} />
                Создать папку
              </button>
            </div>
          </form>
        </LibraryDialog>
      )}
    </section>
  );
}
