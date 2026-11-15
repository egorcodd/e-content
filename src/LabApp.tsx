import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowRightIcon,
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  StackIcon,
  StopIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { AnalyticsGallery } from './lab/AnalyticsGallery';
import { LibraryGallery } from './lab/LibraryGallery';
import { Workshop } from './features/workshop/Workshop';
import { ScenarioGallery } from './lab/ScenarioGallery';
import { Select } from './shared/Select';
import {
  ArrowSwap,
  downloadText,
  LabDialog,
  LogoMark,
  SectionHeading,
  Segment,
  StatusBadge,
  StatusIcon,
  statusLabels,
  ThinkingGlyph,
  type StatusKind,
} from './shared/ui';
import { useSpotlight } from './shared/useSpotlight';
import './lab/lab.css';

const sections = [
  { id: 'components', label: 'Элементы' },
  { id: 'workshop', label: 'Цех' },
  { id: 'library', label: 'Библиотека' },
  { id: 'analytics', label: 'Графики' },
  { id: 'scenarios', label: 'Сценарии' },
  { id: 'typography', label: 'Типографика' },
];
const fonts = [
  { id: 'Inter', label: 'Inter', family: '"Inter Variable"' },
  { id: 'Golos', label: 'Golos', family: '"Golos Text Variable"' },
  { id: 'Manrope', label: 'Manrope', family: 'Manrope' },
];
const tokens = {
  name: 'e-content',
  version: '0.3',
  color: {
    background: '#090909',
    surface: '#121212',
    raised: '#1c1c1c',
    line: '#2b2b2b',
    text: '#ececec',
    muted: '#999999',
  },
  source: { telegram: '#3987e5', tiktok: '#d55181', third: '#c98500' },
  status: { wait: '#8d939c', run: '#9a8cf2', done: '#2fbf71', pause: '#f2b02c', error: '#e5534b' },
  typography: {
    family: 'Inter',
    opticalSizing: 'auto',
    sizes: { caption: 12, label: 14, body: 16, heading: 28, title: 36 },
  },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: { sharp: 8, soft: 14, pill: 999 },
  motion: {
    hover: 250,
    press: 80,
    panel: 300,
    camera: 700,
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    spring: 'linear() ~6% overshoot, 450ms',
  },
};
const swatches = [
  {
    group: 'Основа',
    items: Object.entries(tokens.color).map(([name, color]) => ({ name, color })),
  },
  {
    group: 'Источники',
    items: [
      { name: 'Telegram', color: tokens.source.telegram },
      { name: 'TikTok', color: tokens.source.tiktok },
      { name: 'Третий', color: tokens.source.third },
    ],
  },
  {
    group: 'Статусы',
    items: (Object.keys(statusLabels) as StatusKind[]).map((kind) => ({
      name: statusLabels[kind],
      color: tokens.status[kind === 'err' ? 'error' : kind],
    })),
  },
];
function stored(key: string, fallback: string, allowed?: string[]) {
  try {
    const value = localStorage.getItem(key);
    return value && (!allowed || allowed.includes(value)) ? value : fallback;
  } catch {
    return fallback;
  }
}
export default function LabApp() {
  const [logo, setLogo] = useState(stored('e-content-logo', 'cut'));
  const [font, setFont] = useState(
    stored(
      'e-content-font-v3',
      'Inter',
      fonts.map((f) => f.id),
    ),
  );
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState(false);
  const [current, setCurrent] = useState('components');
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
      if (
        e.key === '/' &&
        !target.closest('input,textarea,select,[role=combobox],[contenteditable=true]')
      ) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[name=sample-search]')?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useSpotlight();
  useEffect(() => {
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id);
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) spy.observe(el);
    }
    return () => spy.disconnect();
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
    const family = fonts.find((f) => f.id === font)?.family ?? fonts[0].family;
    document.documentElement.style.setProperty('--font-sans', `${family}, "Segoe UI", sans-serif`);
    try {
      localStorage.setItem('e-content-font-v3', font);
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
              <a
                key={s.id}
                href={'#' + s.id}
                aria-current={current === s.id ? 'location' : undefined}
                onClick={() => setMenu(false)}
              >
                {current === s.id && (
                  <motion.span
                    layoutId="ec-nav-pill"
                    className="ec-nav-pill"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.55 }}
                  />
                )}
                <span>{s.label}</span>
              </a>
            ))}
          </nav>
          <div className="ec-header-end">
            <span className="ec-version">
              Дизайн-система <span>03</span>
            </span>
            <button className="ec-icon" onClick={exportTokens} aria-label="Скачать токены">
              <DownloadSimpleIcon size={19} className="ec-ico-drop" />
            </button>
            <button
              className="ec-icon ec-mobile-menu"
              aria-label={menu ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <XIcon size={20} /> : <ListIcon size={20} />}
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="ec-main">
        <ComponentGallery notify={notify} />
        <Workshop notify={notify} />
        <LibraryGallery notify={notify} />
        <AnalyticsGallery />
        <ScenarioGallery />
        <section id="typography" className="ec-section">
          <SectionHeading number="06" title="Типографика и знак">
            <Segment
              label="Шрифт интерфейса"
              value={font}
              onChange={setFont}
              values={fonts.map((f) => ({ id: f.id, label: f.label }))}
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
              <a className="ec-type-ui" href="#library">
                <FileTextIcon size={18} />
                <span>
                  Сценарий ролика.md<small>Сегодня, 14:32</small>
                </span>
                <ArrowSwap size={17} />
              </a>
              <div className="ec-type-numbers">
                12 840 <span>+18,6%</span>
              </div>
              <div className="ec-type-tags">
                <span className="ec-src-tg">Telegram</span>
                <span className="ec-src-tt">TikTok</span>
                <span>Markdown</span>
              </div>
            </div>
          </div>
          <div className="ec-type-scale" aria-label="Шкала размеров">
            {[12, 14, 16, 20, 28, 40].map((size) => (
              <div key={size}>
                <span>{size}</span>
                <p style={{ fontSize: size }}>Что спросить у команды до выхода на работу?</p>
              </div>
            ))}
          </div>
          <div className="ec-logo-variants">
            {[
              { id: 'cut', label: 'Разрез' },
              { id: 'fold', label: 'Слой' },
              { id: 'module', label: 'Модуль' },
            ].map((v) => (
              <button
                key={v.id}
                className={'ec-glow ' + (logo === v.id ? 'is-selected' : '')}
                onClick={() => setLogo(v.id)}
                aria-pressed={logo === v.id}
              >
                <div>
                  <LogoMark variant={v.id} size={49} />
                  <span>e-content</span>
                </div>
                <span>
                  {v.label}
                  {logo === v.id ? <CheckIcon size={16} /> : <ArrowSwap size={16} />}
                </span>
              </button>
            ))}
          </div>
          <div className="ec-palette">
            {swatches.map((group) => (
              <div key={group.group} className="ec-palette-group">
                <span className="ec-sample-label">{group.group}</span>
                <div>
                  {group.items.map(({ name, color }) => (
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
                      <small>{name}</small>
                      <code>{color}</code>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="ec-footer">
        <LogoMark variant={logo} size={18} />
        <span>e-content</span>
        <button onClick={exportTokens}>
          Токены <DownloadSimpleIcon size={14} className="ec-ico-drop" />
        </button>
      </footer>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="ec-toast"
            role="status"
            aria-live="polite"
            initial={{ y: 24, opacity: 0, scale: 0.94 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
          >
            <StatusIcon kind="done" size={16} />
            <span>{notice}</span>
            <button
              className="ec-icon"
              onClick={() => setNotice('')}
              aria-label="Закрыть уведомление"
            >
              <XIcon size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** Cross-fades between two icons with a small spin, e.g. copy → check. */
function IconSwap({ on, off, active }: { on: ReactNode; off: ReactNode; active: boolean }) {
  return (
    <span className="ec-icon-swap" aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={active ? 'on' : 'off'}
          initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.4, rotate: 45 }}
          transition={{ type: 'spring', bounce: 0.35, duration: 0.45 }}
        >
          {active ? on : off}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Destructive action that only fires after a 1.1 s press (pointer, Space or Enter). */
function HoldButton({ onConfirm }: { onConfirm: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, 1100);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const isKey = (key: string) => key === ' ' || key === 'Enter';
  return (
    <button
      className={'ec-button ec-hold ' + (holding ? 'is-holding' : '')}
      aria-label="Удалить черновик, удерживайте"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (isKey(e.key) && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => isKey(e.key) && cancel()}
      onBlur={cancel}
    >
      <span className="ec-hold-fill" />
      <TrashIcon size={16} />
      {holding ? 'Держите…' : 'Удалить черновик'}
    </button>
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
const statusNotes: Record<StatusKind, string> = {
  wait: 'Пунктирная орбита и дыхание',
  run: 'Дуга догоняет себя, текст мерцает',
  done: 'Галочка рисуется, расходится круг',
  pause: 'Полосы по очереди затихают',
  err: 'Встряска и мягкая тревога',
};
const phaseText: Record<StatusKind, string> = {
  wait: 'Ожидает запуска',
  run: 'Анализирую материалы…',
  done: 'Пример завершён',
  pause: 'Остановлено на шаге 2 из 4',
  err: 'Источник не ответил',
};
function ComponentGallery({ notify }: { notify: (text: string) => void }) {
  const [platform, setPlatform] = useState('Все');
  const [type, setType] = useState('Все материалы');
  const [period, setPeriod] = useState('14');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState({ platform: 'Все', type: 'Все материалы', period: '14' });
  const [selected, setSelected] = useState(false);
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<StatusKind>('wait');
  const [copied, setCopied] = useState(false);
  const [parameters, setParameters] = useState(false);
  const [replay, setReplay] = useState<Partial<Record<StatusKind, number>>>({});
  const running = phase === 'run';
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(copyTimer.current);
    },
    [],
  );
  function run() {
    clearTimeout(timer.current);
    if (running) return setPhase('pause');
    setPhase('run');
    timer.current = setTimeout(() => setPhase('done'), 4800);
  }
  function fail() {
    clearTimeout(timer.current);
    setPhase('err');
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
        '.button { background: #ececec; color: #0c0c0c; border-radius: 999px; padding: 12px 20px; }',
      );
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
      notify('CSS кнопки скопирован');
    } catch {
      notify('Копирование недоступно');
    }
  }
  const copyIcon = (
    <IconSwap active={copied} on={<CheckIcon size={16} />} off={<CopyIcon size={16} />} />
  );
  return (
    <section id="components" className="ec-section ec-components">
      <div className="ec-section-heading">
        <div>
          <span className="ec-section-number">01</span>
          <h1>Элементы интерфейса</h1>
        </div>
        <span className="ec-tag">Варианты</span>
      </div>
      <div className="ec-button-variants">
        <div>
          <div className="ec-specimen-caption">
            <span>Капсула</span>
            <span>01</span>
          </div>
          <div className="ec-button-row">
            <button className="ec-button ec-white ec-pill" onClick={() => setModal(true)}>
              <PlusIcon size={17} weight="bold" className="ec-ico-spin" />
              Создать материал
            </button>
            <button
              className="ec-round"
              aria-label="Добавить материал"
              onClick={() => setModal(true)}
            >
              <PlusIcon size={19} className="ec-ico-spin" />
            </button>
          </div>
          <div className="ec-button-row">
            <button
              className={'ec-button ec-pill ' + (selected ? 'is-selected' : '')}
              onClick={() => setSelected((v) => !v)}
              aria-pressed={selected}
            >
              <IconSwap
                active={selected}
                on={<CheckIcon size={16} weight="bold" />}
                off={<StackIcon size={16} />}
              />
              {selected ? 'Выбрано' : 'Выбрать'}
            </button>
            <button className="ec-button ec-ghost" onClick={() => void copy()}>
              {copyIcon}
              {copied ? 'Скопировано' : 'CSS'}
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
              <PlusIcon size={17} className="ec-ico-spin" />
              Новый материал
            </button>
            <button
              className="ec-button ec-outline ec-square"
              aria-label="Открыть материал"
              onClick={() => setModal(true)}
            >
              <ArrowSwap size={18} />
            </button>
          </div>
          <div className="ec-button-row">
            <button
              className="ec-button ec-text"
              onClick={() => setParameters((v) => !v)}
              aria-expanded={parameters}
            >
              Параметры <CaretDownIcon size={15} />
            </button>
            <button className="ec-button ec-ghost" disabled>
              Недоступно
            </button>
          </div>
          <AnimatePresence initial={false}>
            {parameters && (
              <motion.div
                className="ec-mini-settings-wrap"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="ec-mini-settings">
                  <span>Формат</span>
                  <span>Markdown</span>
                  <span>Период</span>
                  <span>{period} дней</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div>
          <div className="ec-specimen-caption">
            <span>Мягкий свет</span>
            <span>03</span>
          </div>
          <div className="ec-button-row">
            <button className={'ec-button ec-glass ' + (running ? 'is-running' : '')} onClick={run}>
              {running ? <ThinkingGlyph active size={17} /> : <PlayIcon size={16} weight="fill" />}{' '}
              {running ? 'Остановить' : 'Запустить пример'}
              {running && (
                <span className="ec-button-progress" aria-hidden="true">
                  <i />
                </span>
              )}
            </button>
            <button
              className="ec-round ec-glass"
              onClick={() => void copy()}
              aria-label="Скопировать CSS"
            >
              {copyIcon}
            </button>
          </div>
          <div className="ec-button-row">
            <button
              className="ec-button ec-ghost"
              onClick={() => {
                downloadText('e-content-note.md', '# Новая заметка\n\n');
                notify('Markdown скачан');
              }}
            >
              <DownloadSimpleIcon size={16} className="ec-ico-drop" />
              Скачать
            </button>
            <HoldButton onConfirm={() => notify('Черновик удалён')} />
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
              {
                id: 'Telegram',
                label: 'Telegram',
                icon: <TelegramLogoIcon size={19} weight="regular" />,
              },
              {
                id: 'TikTok',
                label: 'TikTok',
                icon: <TiktokLogoIcon size={19} weight="regular" />,
              },
            ]}
          />
        </div>
        <div className="ec-field">
          <span>Материалы</span>
          <Select
            label="Тип материалов"
            value={type}
            onChange={setType}
            options={['Все материалы', 'Публикации', 'Видео', 'Вопросы'].map((value) => ({
              value,
              label: value,
            }))}
          />
        </div>
        <div className="ec-field">
          <span>Период</span>
          <Select
            label="Период фильтра"
            value={period}
            onChange={setPeriod}
            options={['7', '14', '30'].map((value) => ({ value, label: `${value} дней` }))}
          />
        </div>
        <button
          className="ec-button ec-white ec-pill"
          onClick={() => setApplied({ platform, type, period })}
        >
          Применить <ArrowRightIcon size={16} className="ec-ico-nudge" />
        </button>
      </div>
      <div className="ec-search-example">
        <label className="ec-search">
          <MagnifyingGlassIcon size={18} />
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
              <XIcon size={16} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        <div className="ec-match-count">
          <span>Найдено</span>
          <motion.strong
            key={filtered.length}
            initial={{ scale: 0.7, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.5, duration: 0.5 }}
          >
            {filtered.length}
          </motion.strong>
          <span className="ec-count-icon">
            <FileTextIcon size={16} />
          </span>
        </div>
      </div>
      <motion.div layout className="ec-example-results">
        {filtered.map((item, i) => (
          <motion.button
            layout="position"
            key={item.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: i * 0.035, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => {
              setTitle(item.title);
              setModal(true);
            }}
          >
            <span>
              <FileTextIcon size={17} />
              {item.title}
            </span>
            <span>
              <i className={item.platform === 'Telegram' ? 'ec-src-dot-tg' : 'ec-src-dot-tt'} />
              {item.platform}
              <ArrowSwap size={15} />
            </span>
          </motion.button>
        ))}
        {!filtered.length && <div className="ec-no-results">Ничего не найдено</div>}
      </motion.div>
      <div className="ec-component-divider" />
      <div className="ec-feedback-grid">
        <div>
          <div className="ec-specimen-caption">
            <span>Статусы</span>
            <span>04</span>
          </div>
          <div className="ec-statuses">
            {(Object.keys(statusLabels) as StatusKind[]).map((kind) => (
              <button
                key={kind}
                className="ec-status-cell"
                aria-label={`Повторить анимацию статуса «${statusLabels[kind]}»`}
                onClick={() => setReplay((r) => ({ ...r, [kind]: (r[kind] ?? 0) + 1 }))}
              >
                <StatusBadge key={replay[kind] ?? 0} kind={kind} />
                <small>{statusNotes[kind]}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="ec-specimen-caption">
            <span>Выполнение</span>
            <span className="ec-caption-actions">
              <button className="ec-text-action" onClick={fail}>
                Ошибка
              </button>
              <button className="ec-text-action" onClick={run}>
                {running ? 'Остановить' : 'Проиграть'}
                {running ? (
                  <StopIcon size={12} weight="fill" />
                ) : (
                  <PlayIcon size={12} weight="fill" />
                )}
              </button>
            </span>
          </div>
          <div className="ec-thinking-preview">
            <ThinkingGlyph active={running} size={22} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={phase}
                className="ec-phase-text"
                initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                {phaseText[phase]}
              </motion.span>
            </AnimatePresence>
            <span className={'ec-running-bars ' + (running ? 'is-running' : '')}>
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="ec-lifecycle">
            {(['wait', 'run', 'done'] as StatusKind[]).map((kind, i) => {
              const order = ['wait', 'run', 'done'];
              const reached =
                phase === 'err' || phase === 'pause' ? i < 2 : i <= order.indexOf(phase);
              const shown: StatusKind =
                i === 1 && (phase === 'err' || phase === 'pause') ? phase : kind;
              return (
                <div key={kind} className={'ec-lifecycle-step ' + (reached ? 'is-reached' : '')}>
                  <motion.span
                    layout
                    className={`ec-status ec-st-${shown}`}
                    transition={{ layout: { type: 'spring', bounce: 0.2, duration: 0.5 } }}
                  >
                    <StatusIcon key={shown} kind={shown} size={15} />
                    <motion.span layout="position" className="ec-status-label">
                      {statusLabels[shown]}
                    </motion.span>
                  </motion.span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {modal && (
          <LabDialog title="Материал" close={() => setModal(false)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                downloadText('e-content-material.md', `# ${title.trim()}\n\n## Содержание\n\n`);
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
                <button
                  type="button"
                  className="ec-button ec-ghost"
                  onClick={() => setModal(false)}
                >
                  Отмена
                </button>
                <button className="ec-button ec-white" type="submit">
                  <DownloadSimpleIcon size={16} className="ec-ico-drop" />
                  Скачать Markdown
                </button>
              </div>
            </form>
          </LabDialog>
        )}
      </AnimatePresence>
    </section>
  );
}
