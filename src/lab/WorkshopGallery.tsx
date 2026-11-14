import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  FileText,
  Layers,
  Lightbulb,
  MessagesSquare,
  Play,
  RotateCcw,
  Send,
  Square,
  X,
} from 'lucide-react';
import { downloadText, SectionHeading, Segment, ThinkingGlyph } from './shared';
import './workshop-gallery.css';

const stations = [
  {
    id: 'telegram',
    name: 'Telegram',
    sub: '4 канала',
    Icon: Send,
    iso: [140, 145],
    network: [140, 120],
    steps: ['Публикации каналов', 'Ответы и обсуждения', 'Проверка повторов', 'telegram.md'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    sub: '12 роликов',
    Icon: Layers,
    iso: [160, 365],
    network: [140, 365],
    steps: ['Список роликов', 'Доступные счётчики', 'Вопросы аудитории', 'tiktok.md'],
  },
  {
    id: 'collector',
    name: 'Сбор',
    sub: 'Входящие материалы',
    Icon: ArrowDownToLine,
    iso: [365, 235],
    network: [360, 245],
    steps: ['Чтение источников', 'Нормализация дат', 'Дедупликация', 'inbox.md'],
  },
  {
    id: 'comments',
    name: 'Комментарии',
    sub: '128 сообщений',
    Icon: MessagesSquare,
    iso: [565, 120],
    network: [565, 105],
    steps: ['Связи с публикациями', 'Ветки ответов', 'Повторяющиеся вопросы', 'comments.md'],
  },
  {
    id: 'ideas',
    name: 'Темы',
    sub: '18 идей',
    Icon: Lightbulb,
    iso: [790, 225],
    network: [785, 245],
    steps: ['Выделение вопросов', 'Группировка тем', 'Проверка оснований', 'ideas.md'],
  },
  {
    id: 'materials',
    name: 'Материалы',
    sub: 'Коллекции и Markdown',
    Icon: FileText,
    iso: [575, 390],
    network: [565, 385],
    steps: ['Отобранные темы', 'Заметки и сценарии', 'Связи и метаданные', 'materials.md'],
  },
  {
    id: 'analytics',
    name: 'Аналитика',
    sub: 'Общая картина',
    Icon: ChartNoAxesCombined,
    iso: [945, 385],
    network: [990, 245],
    steps: ['Снимки показателей', 'Сравнение периодов', 'Динамика площадок', 'report.md'],
  },
];
type Station = (typeof stations)[number];
const links: [[number, number], ...Array<[number, number]>] = [
  [0, 2],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [2, 5],
];
const face = (x: number, y: number, w: number) =>
  `${x},${y - w / 2} ${x + w},${y} ${x},${y + w / 2} ${x - w},${y}`;
function Cube({ x, y, w = 22, h = 30 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g className="wg-wire">
      <polygon points={face(x, y - h, w)} />
      <path
        d={`M${x - w} ${y - h}v${h}l${w} ${w / 2} ${w} ${-w / 2}v${-h}M${x} ${y - h + w / 2}v${h}`}
      />
    </g>
  );
}
function StationModel({ station, x, y }: { station: Station; x: number; y: number }) {
  if (['telegram', 'tiktok'].includes(station.id))
    return <station.Icon x={x - 17} y={y - 44} width={34} height={34} strokeWidth={1.2} />;
  if (station.id === 'collector')
    return (
      <>
        <Cube x={x - 15} y={y - 10} w={11} h={28} />
        <Cube x={x + 12} y={y - 15} w={11} h={44} />
        <Cube x={x} y={y} w={11} h={23} />
      </>
    );
  if (station.id === 'comments')
    return (
      <>
        {[0, 1, 2].map((n) => (
          <polygon key={n} points={face(x, y - 12 - n * 13, 28)} className="wg-stack" />
        ))}
      </>
    );
  if (station.id === 'analytics')
    return (
      <>
        {[0, 1, 2].map((n) => (
          <Cube key={n} x={x - 24 + n * 24} y={y - 8 + (n === 1 ? 6 : 0)} w={10} h={20 + n * 16} />
        ))}
      </>
    );
  return (
    <>
      {[0, 1, 2].map((n) => (
        <Cube key={n} x={x} y={y - 6 - n * 13} w={27 - n * 4} h={13} />
      ))}
    </>
  );
}

export function WorkshopGallery({ notify }: { notify: (s: string) => void }) {
  const [variant, setVariant] = useState('isometric');
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(false);
  const [step, setStep] = useState(-1);
  const [finished, setFinished] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const control = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | SVGElement | null>(null);
  const reduced = useReducedMotion();
  const station = stations.find((s) => s.id === selected);
  const positions = stations.map((s, i) =>
    variant === 'isometric' ? s.iso : variant === 'network' ? s.network : [105 + i * 153, 260],
  );
  useEffect(() => () => control.current?.abort(), []);
  function stop() {
    control.current?.abort();
    control.current = null;
    setRunning(false);
    setActive(null);
  }
  function close() {
    stop();
    setSelected(null);
    previous.current?.focus({ preventScroll: true });
  }
  function choose(id: string) {
    stop();
    previous.current = document.getElementById('wg-node-' + id);
    setSelected(id);
    setCycle(false);
    setStep(-1);
    setFinished(false);
    setEvents([]);
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
  }
  const panelOpen = !!selected;
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);
  async function run(all: boolean) {
    if (all) {
      previous.current = document.activeElement as HTMLElement;
      if (!selected) requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    }
    stop();
    const abort = new AbortController();
    control.current = abort;
    setRunning(true);
    setCycle(all);
    setFinished(false);
    setEvents([]);
    const nodes = all ? stations : stations.filter((s) => s.id === selected);
    if (!nodes.length) {
      setRunning(false);
      return;
    }
    try {
      for (const node of nodes) {
        if (abort.signal.aborted) return;
        setSelected(node.id);
        setActive(node.id);
        for (let i = 0; i < node.steps.length; i++) {
          if (abort.signal.aborted) return;
          setStep(i);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, all ? 280 : 520);
            abort.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
        if (abort.signal.aborted) return;
        setStep(node.steps.length);
        setEvents((old) => [`${node.name} / ${node.steps.at(-1)}`, ...old].slice(0, 7));
      }
      if (!abort.signal.aborted) {
        setFinished(true);
        notify(all ? 'Демонстрация полного цикла завершена' : 'Демонстрация участка завершена');
      }
    } finally {
      if (control.current === abort) {
        setRunning(false);
        setActive(null);
        control.current = null;
      }
    }
  }
  const selectedIndex = stations.findIndex((s) => s.id === selected);
  const selectedPosition = positions[Math.max(0, selectedIndex)];
  const camera =
    selected && variant !== 'pipeline'
      ? { scale: 1.25, x: (400 - selectedPosition[0]) * 1.1, y: (240 - selectedPosition[1]) * 0.8 }
      : { scale: 1, x: 0, y: 0 };
  return (
    <section id="workshop" className="ec-section wg-section">
      <SectionHeading number="02" title="Цех">
        <span className="ec-demo">Демо</span>
      </SectionHeading>
      <div className="ec-section-controls">
        <Segment
          label="Вариант цеха"
          value={variant}
          onChange={(id) => {
            stop();
            setSelected(null);
            setVariant(id);
          }}
          values={[
            { id: 'isometric', label: 'Изометрия' },
            { id: 'network', label: 'Связи' },
            { id: 'pipeline', label: 'Линия' },
          ]}
        />
        <div className="ec-actions">
          <button
            className="ec-icon"
            onClick={() => {
              close();
            }}
            aria-label="Вернуть общий вид"
          >
            <RotateCcw size={18} />
          </button>
          <button
            className="ec-button ec-white"
            onClick={() => (running ? stop() : void run(true))}
          >
            {running ? <Square size={14} /> : <Play size={14} />}{' '}
            {running ? 'Остановить цикл' : 'Запустить весь цикл'}
          </button>
        </div>
      </div>
      <div className={'wg-scene ' + (running ? 'wg-running' : '')}>
        <svg className="wg-svg" viewBox="0 0 1100 520" role="group" aria-label="Участки цеха">
          <defs>
            <radialGradient id="wg-fade">
              <stop stopColor="white" />
              <stop offset=".65" stopColor="white" stopOpacity=".4" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <mask id="wg-mask">
              <ellipse cx="550" cy="260" rx="550" ry="250" fill="url(#wg-fade)" />
            </mask>
          </defs>
          <motion.g
            initial={false}
            animate={camera}
            transition={{ duration: reduced ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: '550px 260px' }}
          >
            {variant === 'isometric' && (
              <g className="wg-grid" mask="url(#wg-mask)">
                <g transform="translate(550 260) scale(1 .43) rotate(45)">
                  {Array.from({ length: 35 }, (_, i) => i * 30 - 510).map((n) => (
                    <g key={n}>
                      <path d={`M${n} -510V510`} />
                      <path d={`M-510 ${n}H510`} />
                    </g>
                  ))}
                </g>
              </g>
            )}
            {links.map(([from, to], i) => {
              const a = positions[from],
                b = positions[to];
              const path =
                variant === 'network'
                  ? `M${a[0]} ${a[1]}C${(a[0] + b[0]) / 2} ${a[1]} ${(a[0] + b[0]) / 2} ${b[1]} ${b[0]} ${b[1]}`
                  : `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
              return (
                <g
                  key={i}
                  className={
                    'wg-link ' +
                    (running && (active === stations[from].id || active === stations[to].id)
                      ? 'wg-link-active'
                      : '')
                  }
                >
                  <path d={path} />
                  {running &&
                    !reduced &&
                    (active === stations[from].id || active === stations[to].id) && (
                      <g className="wg-packet">
                        <rect x="-4" y="-5" width="8" height="10" rx="1" />
                        <animateMotion path={path} dur="1.8s" repeatCount="indefinite" />
                      </g>
                    )}
                </g>
              );
            })}
            {stations.map((s, i) => {
              const [x, y] = positions[i];
              const iso = variant === 'isometric';
              return (
                <g
                  key={s.id}
                  id={'wg-node-' + s.id}
                  className={
                    'wg-node ' +
                    (selected === s.id ? 'wg-selected' : '') +
                    ' ' +
                    (active === s.id ? 'wg-active' : '')
                  }
                  role="button"
                  tabIndex={0}
                  aria-label={`Открыть участок ${s.name}`}
                  aria-expanded={selected === s.id}
                  aria-controls={selected === s.id ? 'wg-process' : undefined}
                  onClick={() => choose(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choose(s.id);
                    }
                  }}
                >
                  {iso ? (
                    <>
                      <polygon
                        className="wg-foot"
                        points={`${x - 56},${y} ${x},${y + 28} ${x + 56},${y} ${x + 56},${y + 20} ${x},${y + 48} ${x - 56},${y + 20}`}
                      />
                      <path className="wg-seam" d={`M${x} ${y + 28}v20`} />
                      <polygon className="wg-face" points={face(x, y, 56)} />
                      <StationModel station={s} x={x} y={y} />
                    </>
                  ) : (
                    <>
                      <rect
                        className="wg-flat"
                        x={x - 40}
                        y={y - 40}
                        width="80"
                        height="80"
                        rx={variant === 'network' ? 22 : 14}
                      />
                      <s.Icon x={x - 17} y={y - 17} width="34" height="34" strokeWidth="1.4" />
                    </>
                  )}
                  <text x={x} y={y + (iso ? 83 : 68)} className="wg-name" textAnchor="middle">
                    {s.name}
                  </text>
                  <text x={x} y={y + (iso ? 105 : 91)} className="wg-sub" textAnchor="middle">
                    {s.sub}
                  </text>
                  {active === s.id && (
                    <rect
                      className="wg-node-running"
                      x={x + 28}
                      y={y - 48}
                      width="8"
                      height="8"
                      rx="1"
                    />
                  )}
                </g>
              );
            })}
          </motion.g>
        </svg>
        <div className="wg-source-tags">
          <span>
            <Send size={15} />
            Telegram
          </span>
          <span>
            <Layers size={15} />
            TikTok
          </span>
          <span>
            <FileText size={15} />
            Markdown
          </span>
        </div>
      </div>
      <div className="wg-mobile-nodes">
        {stations.map((s) => (
          <button key={s.id} onClick={() => choose(s.id)}>
            <s.Icon size={17} />
            {s.name}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {station && (
          <motion.aside
            id="wg-process"
            role="region"
            tabIndex={-1}
            ref={panel}
            aria-label={`Процесс ${station.name}`}
            className="wg-process-panel"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="wg-panel-top">
              <span>Процесс / Демо</span>
              <button className="ec-icon" aria-label="Закрыть процесс" onClick={close}>
                <X size={20} />
              </button>
            </div>
            <div className="wg-panel-title">
              <station.Icon size={26} />
              <h3>{station.name}</h3>
              <ThinkingGlyph active={running} />
            </div>
            <div className="wg-panel-source">
              <FileText size={15} />
              {station.steps.at(-1)}
              <span>{finished ? 'Готово' : running ? 'В работе' : 'Ожидает запуска'}</span>
            </div>
            <ol className="wg-steps" aria-live="polite">
              {station.steps.map((label, i) => (
                <li key={label} className={step > i ? 'is-done' : step === i ? 'is-current' : ''}>
                  <span>{step > i ? <Check size={13} /> : i + 1}</span>
                  <div>
                    {label}
                    <small>
                      {step > i
                        ? 'Завершено'
                        : step === i && running
                          ? 'Выполняется…'
                          : step === i
                            ? 'Остановлено'
                            : 'Ожидание'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            <div className="wg-panel-actions">
              <button
                className="ec-button ec-white"
                onClick={() => (running ? stop() : void run(cycle))}
              >
                {running ? <Square size={13} /> : <Play size={13} />}{' '}
                {running
                  ? cycle
                    ? 'Остановить цикл'
                    : 'Остановить'
                  : cycle
                    ? 'Повторить цикл'
                    : 'Запустить участок'}
              </button>
              {finished && (
                <button
                  className="ec-button"
                  onClick={() =>
                    downloadText(
                      'e-content-example.md',
                      '# e-content\n\nДемонстрационный цикл дизайн-системы.\n\n' +
                        events.map((e) => '- ' + e).join('\n'),
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  Скачать Markdown
                </button>
              )}
            </div>
            {events.length > 0 && (
              <div className="wg-events">
                <h4>Материалы</h4>
                {events.map((event, i) => (
                  <div key={i}>
                    <FileText size={14} />
                    {event}
                    <Check size={12} />
                  </div>
                ))}
              </div>
            )}
            <div className="wg-panel-bottom">
              <span className="wg-demo-dot" />
              Демонстрационный процесс
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
