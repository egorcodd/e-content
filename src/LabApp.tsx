import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileText,
  Layers,
  Menu,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import { AnalyticsGallery } from './lab/AnalyticsGallery';
import { LibraryGallery } from './lab/LibraryGallery';
import { WorkshopGallery } from './lab/WorkshopGallery';
import {
  downloadText,
  LabDialog,
  LogoMark,
  SectionHeading,
  Segment,
  ThinkingGlyph,
} from './lab/shared';
import './lab/lab.css';

const sections = [
  { id: 'components', label: 'Элементы' },
  { id: 'workshop', label: 'Цех' },
  { id: 'library', label: 'Библиотека' },
  { id: 'analytics', label: 'Графики' },
  { id: 'typography', label: 'Типографика' },
];
const tokens = {
  name: 'e-content',
  version: '0.2',
  color: {
    background: '#090909',
    surface: '#121212',
    raised: '#1c1c1c',
    line: '#2b2b2b',
    text: '#f1f1f1',
    muted: '#999999',
  },
  typography: {
    family: 'Manrope',
    sizes: { caption: 12, label: 14, body: 16, heading: 28, title: 36 },
  },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: { sharp: 8, soft: 14, pill: 999 },
  motion: { hover: 140, panel: 300, camera: 700 },
};
function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export default function LabApp() {
  const [logo, setLogo] = useState(stored('e-content-logo', 'cut'));
  const [font, setFont] = useState(stored('e-content-font', 'Manrope'));
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function notify(text: string) {
    clearTimeout(timer.current);
    setNotice(text);
    timer.current = setTimeout(() => setNotice(''), 3800);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !target.closest('input,textarea,select,[contenteditable=true]')) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[name=sample-search]')?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    document.title = 'e-content / дизайн-система';
    delete document.documentElement.dataset.theme;
    const url = new URL(location.href);
    const previous = url.searchParams.get('view');
    if (previous) {
      const mapped =
        previous === 'ideas'
          ? 'library'
          : previous === 'foundations' || previous === 'brand'
            ? 'typography'
            : previous === 'overview'
              ? 'components'
              : previous;
      url.search = '';
      url.hash = sections.some((s) => s.id === mapped) ? mapped : 'components';
      history.replaceState(null, '', url);
    }
    try {
      localStorage.setItem('cm-brand', 'e-content');
    } catch {}
    let cancelled = false;
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const id = location.hash.slice(1);
        if (sections.some((section) => section.id === id)) {
          document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--font-sans',
      font === 'Системный' ? '"Segoe UI", sans-serif' : `"${font}", "Segoe UI", sans-serif`,
    );
    try {
      localStorage.setItem('e-content-font', font);
    } catch {}
  }, [font]);
  useEffect(() => {
    try {
      localStorage.setItem('e-content-logo', logo);
    } catch {}
  }, [logo]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  const exportTokens = () => {
    downloadText(
      'e-content.tokens.json',
      JSON.stringify({ ...tokens, typography: { ...tokens.typography, family: font } }, null, 2),
      'application/json;charset=utf-8',
    );
    notify('Токены скачаны');
  };
  return (
    <MotionConfig reducedMotion="user">
      <a className="ec-skip" href="#main">
        К содержимому
      </a>
      <header className="ec-header">
        <div className="ec-header-inner">
          <a className="ec-brand" href="#components" aria-label="e-content, начало страницы">
            <LogoMark variant={logo} size={29} />
            <span>e-content</span>
          </a>
          <nav className={menu ? 'is-open' : ''} aria-label="Части дизайн-системы">
            {sections.map((s) => (
              <a key={s.id} href={'#' + s.id} onClick={() => setMenu(false)}>
                {s.label}
              </a>
            ))}
          </nav>
          <div className="ec-header-end">
            <span className="ec-version">
              Дизайн-система <span>02</span>
            </span>
            <button className="ec-icon" onClick={exportTokens} aria-label="Скачать токены">
              <ArrowDownToLine size={19} />
            </button>
            <button
              className="ec-icon ec-mobile-menu"
              aria-label={menu ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="ec-main">
        <ComponentGallery notify={notify} />
        <WorkshopGallery notify={notify} />
        <LibraryGallery notify={notify} />
        <AnalyticsGallery />
        <section id="typography" className="ec-section">
          <SectionHeading number="05" title="Типографика и знак">
            <Segment
              label="Шрифт интерфейса"
              value={font}
              onChange={setFont}
              values={[
                { id: 'Manrope', label: 'Manrope' },
                { id: 'Onest', label: 'Onest' },
                { id: 'Системный', label: 'Системный' },
              ]}
            />
          </SectionHeading>
          <div className="ec-type-variants">
            <div>
              <span className="ec-sample-label">Display / 48</span>
              <p className="ec-display-type">
                Голос
                <br />
                аудитории.
              </p>
            </div>
            <div>
              <span className="ec-sample-label">Заголовок / 28</span>
              <p className="ec-heading-type">
                Следующий
                <br />
                материал
              </p>
              <span className="ec-body-type">
                Вопросы, заметки и идеи
                <br />
                для вашего контента.
              </span>
            </div>
            <div>
              <span className="ec-sample-label">Интерфейс / 16</span>
              <div className="ec-type-ui">
                <FileText size={18} />
                <span>
                  Сценарий ролика.md<small>Сегодня, 14:32</small>
                </span>
                <ArrowUpRight size={17} />
              </div>
              <div className="ec-type-numbers">
                12 840 <span>+18,6%</span>
              </div>
              <div className="ec-type-tags">
                <span>Telegram</span>
                <span>TikTok</span>
                <span>Markdown</span>
              </div>
            </div>
          </div>
          <div className="ec-logo-variants">
            {[
              { id: 'cut', label: 'Разрез' },
              { id: 'fold', label: 'Слой' },
              { id: 'module', label: 'Модуль' },
            ].map((v) => (
              <button
                key={v.id}
                className={logo === v.id ? 'is-selected' : ''}
                onClick={() => setLogo(v.id)}
                aria-pressed={logo === v.id}
              >
                <div>
                  <LogoMark variant={v.id} size={49} />
                  <span>e-content</span>
                </div>
                <span>
                  {v.label}
                  {logo === v.id ? <Check size={16} /> : <ArrowUpRight size={16} />}
                </span>
              </button>
            ))}
          </div>
          <div className="ec-palette">
            {Object.entries(tokens.color).map(([name, color]) => (
              <button
                key={name}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(color);
                    notify(color + ' скопирован');
                  } catch {
                    notify('Скачайте токены кнопкой в шапке');
                  }
                }}
                aria-label={`Скопировать ${name}: ${color}`}
              >
                <span style={{ background: color }} />
                <code>{color}</code>
              </button>
            ))}
          </div>
        </section>
      </main>
      <footer className="ec-footer">
        <LogoMark variant={logo} size={18} />
        <span>e-content</span>
        <button onClick={exportTokens}>
          Токены <ArrowDownToLine size={14} />
        </button>
      </footer>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="ec-toast"
            role="status"
            aria-live="polite"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
          >
            <Check size={16} />
            <span>{notice}</span>
            <button
              className="ec-icon"
              onClick={() => setNotice('')}
              aria-label="Закрыть уведомление"
            >
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

const sampleItems = [
  { title: 'Как говорить об учебном опыте', platform: 'Telegram', type: 'Вопросы', age: 3 },
  { title: 'AI-инструменты для разработчика', platform: 'TikTok', type: 'Видео', age: 11 },
  { title: 'Что изменилось в найме', platform: 'Telegram', type: 'Публикации', age: 2 },
  { title: 'Первое собеседование в IT', platform: 'TikTok', type: 'Видео', age: 18 },
  { title: 'Как выбрать пет-проект', platform: 'Telegram', type: 'Вопросы', age: 6 },
  { title: 'Неделя без идеального плана', platform: 'Telegram', type: 'Публикации', age: 23 },
];
function ComponentGallery({ notify }: { notify: (text: string) => void }) {
  const [platform, setPlatform] = useState('Все');
  const [type, setType] = useState('Все материалы');
  const [period, setPeriod] = useState('14');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState({ platform: 'Все', type: 'Все материалы', period: '14' });
  const [selected, setSelected] = useState(false);
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [parameters, setParameters] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function run() {
    if (running) {
      clearTimeout(timer.current);
      setRunning(false);
      setDone(false);
      return;
    }
    setRunning(true);
    setDone(false);
    timer.current = setTimeout(() => {
      setRunning(false);
      setDone(true);
    }, 4800);
  }
  const filtered = sampleItems.filter(
    (item) =>
      item.age <= Number(applied.period) &&
      (applied.platform === 'Все' || item.platform === applied.platform) &&
      (applied.type === 'Все материалы' || item.type === applied.type) &&
      item.title.toLowerCase().includes(query.toLowerCase()),
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        '.button { background: #f1f1f1; color: #090909; border-radius: 999px; padding: 12px 20px; }',
      );
      notify('CSS кнопки скопирован');
    } catch {
      notify('Копирование недоступно');
    }
  }
  return (
    <section id="components" className="ec-section ec-components">
      <div className="ec-section-heading">
        <div>
          <span className="ec-section-number">01</span>
          <h1>Элементы интерфейса</h1>
        </div>
        <span className="ec-demo">Варианты</span>
      </div>
      <div className="ec-button-variants">
        <div>
          <div className="ec-specimen-caption">
            <span>Капсула</span>
            <span>01</span>
          </div>
          <div className="ec-button-row">
            <button className="ec-button ec-white ec-pill" onClick={() => setModal(true)}>
              <Plus size={17} />
              Создать материал
            </button>
            <button
              className="ec-round"
              aria-label="Добавить материал"
              onClick={() => setModal(true)}
            >
              <Plus size={19} />
            </button>
          </div>
          <div className="ec-button-row">
            <button className="ec-button ec-pill" onClick={() => setSelected((v) => !v)}>
              {selected ? <Check size={16} /> : <Layers size={16} />}{' '}
              {selected ? 'Выбрано' : 'Выбрать'}
            </button>
            <button className="ec-button ec-ghost" onClick={() => void copy()}>
              <Copy size={16} />
              CSS
            </button>
          </div>
        </div>
        <div>
          <div className="ec-specimen-caption">
            <span>Контур</span>
            <span>02</span>
          </div>
          <div className="ec-button-row">
            <button className="ec-button ec-outline" onClick={() => setModal(true)}>
              <Plus size={17} />
              Новый материал
            </button>
            <button
              className="ec-button ec-outline ec-square"
              aria-label="Открыть материал"
              onClick={() => setModal(true)}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          <div className="ec-button-row">
            <button
              className="ec-button ec-text"
              onClick={() => setParameters((v) => !v)}
              aria-expanded={parameters}
            >
              Параметры <ChevronDown size={15} />
            </button>
            <button className="ec-button ec-ghost" disabled>
              Недоступно
            </button>
          </div>
          {parameters && (
            <div className="ec-mini-settings">
              <span>Формат</span>
              <span>Markdown</span>
              <span>Период</span>
              <span>{period} дней</span>
            </div>
          )}
        </div>
        <div>
          <div className="ec-specimen-caption">
            <span>Мягкий свет</span>
            <span>03</span>
          </div>
          <div className="ec-button-row">
            <button className="ec-button ec-glass" onClick={run}>
              {running ? <ThinkingGlyph active size={17} /> : <Play size={16} />}{' '}
              {running ? 'Остановить' : 'Запустить пример'}
            </button>
            <button
              className="ec-round ec-glass"
              onClick={() => void copy()}
              aria-label="Скопировать CSS"
            >
              <Copy size={17} />
            </button>
          </div>
          <div className="ec-button-row">
            <button
              className="ec-button ec-ghost"
              onClick={() => {
                downloadText(
                  'e-content-note.md',
                  '# Новая заметка\n\nДемонстрационный материал e-content.',
                );
                notify('Markdown скачан');
              }}
            >
              <ArrowDownToLine size={16} />
              Скачать
            </button>
          </div>
        </div>
      </div>
      <div className="ec-component-divider" />
      <div className="ec-filter-example">
        <div className="ec-field">
          <label>Площадка</label>
          <Segment
            label="Площадка примера"
            value={platform}
            onChange={setPlatform}
            values={[
              { id: 'Все', label: 'Все' },
              { id: 'Telegram', label: 'Telegram', icon: <Send size={15} /> },
              { id: 'TikTok', label: 'TikTok', icon: <Layers size={15} /> },
            ]}
          />
        </div>
        <label className="ec-field">
          Материалы
          <span className="ec-select">
            <select
              name="sample-type"
              aria-label="Тип материалов"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {['Все материалы', 'Публикации', 'Видео', 'Вопросы'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <ChevronDown size={16} />
          </span>
        </label>
        <label className="ec-field">
          Период
          <span className="ec-select">
            <select
              name="sample-period"
              aria-label="Период фильтра"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {[
                ['7', '7 дней'],
                ['14', '14 дней'],
                ['30', '30 дней'],
              ].map(([v, t]) => (
                <option value={v} key={v}>
                  {t}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </span>
        </label>
        <button
          className="ec-button ec-white ec-pill"
          onClick={() => setApplied({ platform, type, period })}
        >
          Применить <ArrowRight size={16} />
        </button>
      </div>
      <div className="ec-search-example">
        <label className="ec-search">
          <Search size={18} />
          <input
            name="sample-search"
            aria-label="Поиск материалов"
            placeholder="Найти материал…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button className="ec-icon" onClick={() => setQuery('')} aria-label="Очистить поиск">
              <X size={16} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        <div className="ec-match-count">
          <span>Найдено</span>
          <strong>{filtered.length}</strong>
          <span className="ec-count-icon">
            <FileText size={16} />
          </span>
        </div>
      </div>
      <div className="ec-example-results">
        {filtered.map((item) => (
          <button
            key={item.title}
            onClick={() => {
              setTitle(item.title);
              setModal(true);
            }}
          >
            <span>
              <FileText size={16} />
              {item.title}
            </span>
            <span>
              {item.platform}
              <ArrowUpRight size={15} />
            </span>
          </button>
        ))}
        {!filtered.length && <div className="ec-no-results">Ничего не найдено</div>}
      </div>
      <div className="ec-component-divider" />
      <div className="ec-feedback-grid">
        <div>
          <div className="ec-specimen-caption">
            <span>Статусы</span>
            <span>04</span>
          </div>
          <div className="ec-statuses">
            <span className="ec-status">
              <span className="ec-dot" />
              Ожидание
            </span>
            <span className="ec-status">
              <Check size={14} />
              Готово
            </span>
            <span className="ec-status ec-status-filled">
              <ThinkingGlyph active={running} size={14} />В работе
            </span>
            <span className="ec-status ec-status-error">
              <CircleAlert size={14} />
              Ошибка
            </span>
            <span className="ec-status">
              <Pause size={13} />
              Пауза
            </span>
          </div>
        </div>
        <div>
          <div className="ec-specimen-caption">
            <span>Выполнение</span>
            <button className="ec-text-action" onClick={run}>
              {running ? 'Остановить' : 'Проиграть'}
              <Play size={12} />
            </button>
          </div>
          <div className="ec-thinking-preview">
            <ThinkingGlyph active={running} size={22} />
            <span>
              {running ? 'Анализирую материалы…' : done ? 'Пример завершён' : 'Ожидает запуска'}
            </span>
            <span className={'ec-running-bars ' + (running ? 'is-running' : '')}>
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </div>
      {modal && (
        <LabDialog title="Материал" close={() => setModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              downloadText(
                'e-content-material.md',
                `# ${title.trim()}\n\nДемонстрационный материал дизайн-системы e-content.\n`,
              );
              setModal(false);
              setTitle('');
              notify('Markdown скачан');
            }}
          >
            <label className="ec-form-field">
              Название
              <input
                name="material-title"
                aria-label="Название материала"
                required
                maxLength={180}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Новая идея…"
                autoComplete="off"
              />
            </label>
            <div className="ec-dialog-actions">
              <button type="button" className="ec-button ec-ghost" onClick={() => setModal(false)}>
                Отмена
              </button>
              <button className="ec-button ec-white" type="submit">
                <ArrowDownToLine size={16} />
                Скачать Markdown
              </button>
            </div>
          </form>
        </LabDialog>
      )}
    </section>
  );
}
