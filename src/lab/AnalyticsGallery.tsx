import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import {
  ArrowDownIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
} from '@phosphor-icons/react';
import { AnimatedNumber, Reveal, SectionHeading, Segment, StatusIcon } from './shared';
import './analytics-gallery.css';

type Metric = 'followers' | 'views' | 'comments';
type Platform = 'telegram' | 'tiktok';
type SeriesId = Platform | 'total';
type Point = { date: string; telegram: Record<Metric, number>; tiktok: Record<Metric, number> };
const ease = [0.16, 1, 0.3, 1] as const;
const fmt = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.round(value));
const compact = (value: number) =>
  new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const percent = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
const day = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
const fullDay = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
const platformColor: Record<Platform, string> = { telegram: 'var(--tg)', tiktok: 'var(--tt)' };
const platformLabel: Record<Platform, string> = { telegram: 'Telegram', tiktok: 'TikTok' };

/** Measures an element; the chart draws in real pixels so dots and text never stretch. */
function useSize<T extends Element>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

// 180 days: the last 90 are shown, the rest feed the "vs previous period" deltas.
const spike = (t: number, from: number, to: number, value: number) =>
  t > from && t < to ? value : 0;
const samples: Point[] = Array.from({ length: 180 }, (_, t) => ({
  date: new Date(Date.UTC(2026, 4, 20 + t)).toISOString(),
  telegram: {
    followers: Math.round(9100 + t * 13 + Math.sin(t / 8) * 60),
    views: Math.round(
      1700 + t * 6 + Math.sin(t / 4) * 380 + Math.cos(t / 9) * 210 + spike(t, 154, 162, 1000),
    ),
    comments: Math.max(
      0,
      Math.round(
        18 +
          t * 0.2 +
          Math.sin(t / 4) * 10 +
          spike(t, 154, 162, 26) -
          (t > 170 ? (t - 170) * 4 : 0),
      ),
    ),
  },
  tiktok: {
    followers: Math.round(1200 + t * 11 + Math.sin(t / 7) * 55),
    views: Math.round(
      3000 +
        t * 10 +
        Math.sin(t / 5 + 0.8) * 1500 +
        Math.cos(t / 9) * 420 +
        spike(t, 154, 163, 2600),
    ),
    comments: Math.max(
      0,
      Math.round(
        35 +
          t * 0.3 +
          Math.sin(t / 5) * 16 +
          spike(t, 154, 163, 38) -
          (t > 170 ? (t - 170) * 5 : 0),
      ),
    ),
  },
}));
const series: { id: SeriesId; label: string; color: string; dash?: string }[] = [
  { id: 'telegram', label: 'Telegram', color: 'var(--tg)' },
  { id: 'tiktok', label: 'TikTok', color: 'var(--tt)' },
  { id: 'total', label: 'Вместе', color: '#d4d4d4', dash: '4 5' },
];
const metrics: { id: Metric; label: string }[] = [
  { id: 'followers', label: 'Подписчики' },
  { id: 'views', label: 'Просмотры' },
  { id: 'comments', label: 'Комментарии' },
];
const valueAt = (point: Point, id: SeriesId, metric: Metric) =>
  id === 'total' ? point.telegram[metric] + point.tiktok[metric] : point[id][metric];
const summary = (points: Point[], metric: Metric) =>
  metric === 'followers'
    ? valueAt(points.at(-1)!, 'total', metric)
    : points.reduce((sum, point) => sum + valueAt(point, 'total', metric), 0);

function smoothPath(points: [number, number][]) {
  if (!points.length) return '';
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const before = points[i - 1] || points[i];
    const from = points[i];
    const to = points[i + 1];
    const after = points[i + 2] || to;
    path += `C${from[0] + (to[0] - before[0]) / 6},${from[1] + (to[1] - before[1]) / 6} ${to[0] - (after[0] - from[0]) / 6},${to[1] - (after[1] - from[1]) / 6} ${to[0]},${to[1]}`;
  }
  return path;
}
/** Round axis steps: 1, 2, 2.5, 5 × 10ⁿ. */
function niceTicks(max: number, count = 4) {
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

function Delta({ value, suffix }: { value: number; suffix: string }) {
  const up = value >= 0;
  return (
    <span className={`ag-delta ${up ? 'is-up' : 'is-down'}`}>
      <span className="ag-delta-badge">
        {up ? (
          <ArrowUpRightIcon size={12} weight="bold" />
        ) : (
          <ArrowDownRightIcon size={12} weight="bold" />
        )}
        {percent(Math.abs(value))}
      </span>
      <span className="ag-delta-suffix">{suffix}</span>
    </span>
  );
}

function TrendPlot({
  points,
  shown,
  metric,
  area,
}: {
  points: Point[];
  shown: typeof series;
  metric: Metric;
  area: boolean;
}) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const seen = useInView(ref, { once: true, margin: '-80px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const left = 46;
  const right = 6;
  const top = 10;
  const max = Math.max(
    1,
    ...points.flatMap((point) => shown.map((item) => valueAt(point, item.id, metric))),
  );
  const ticks = niceTicks(max * 1.05);
  const ceiling = ticks.at(-1)!;
  const plotWidth = Math.max(1, width - left - right);
  const x = (i: number) => left + (i / (points.length - 1)) * plotWidth;
  const y = (value: number) => top + (1 - value / ceiling) * (height - top - 1);
  const lines = shown.map((item) => ({
    ...item,
    d: smoothPath(points.map((point, i) => [x(i), y(valueAt(point, item.id, metric))])),
  }));
  const current = active == null ? null : points[active];
  const cursor = active == null ? 0 : x(active);
  const step = Math.ceil((points.length - 1) / 4);
  const labels = [0, step, step * 2, step * 3]
    .filter((i) => i < points.length - 1 - step / 2)
    .concat(points.length - 1);
  const draw = { duration: reduced ? 0 : 1.4, ease };
  const glide = { type: 'spring', stiffness: 700, damping: 50, mass: 0.6 } as const;
  function pick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - left) / plotWidth;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }
  return (
    <div className="ag-plot">
      <div className="ag-plot-canvas" ref={ref}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className="ag-trend-svg"
            role="img"
            tabIndex={0}
            aria-label={`${metrics.find((m) => m.id === metric)!.label}: ${points.length} дней. Стрелки выбирают день. Все значения — по кнопке «Данные».`}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              setActive((previous) =>
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? points.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          points.length - 1,
                          (previous ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1),
                        ),
                      ),
              );
            }}
          >
            <defs>
              {series.map((item) => (
                <linearGradient key={item.id} id={`ag-area-${item.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: item.color, stopOpacity: 0.24 }} />
                  <stop offset="1" style={{ stopColor: item.color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'ag-baseline' : 'ag-grid-line'}
                />
                <text x={left - 12} y={y(tick)} className="ag-tick" textAnchor="end" dy="0.35em">
                  {compact(tick)}
                </text>
              </g>
            ))}
            {lines
              .slice()
              .reverse()
              .map((line) => (
                <g key={line.id + metric + points.length}>
                  {area && line.id !== 'total' && (
                    <motion.path
                      fill={`url(#ag-area-${line.id})`}
                      initial={{
                        opacity: 0,
                        d: `${line.d}L${width - right},${y(0)}L${left},${y(0)}Z`,
                      }}
                      animate={{
                        opacity: seen ? 1 : 0,
                        d: `${line.d}L${width - right},${y(0)}L${left},${y(0)}Z`,
                      }}
                      transition={{
                        opacity: { duration: 1, delay: reduced ? 0 : 0.5 },
                        d: { duration: 0.6, ease },
                      }}
                    />
                  )}
                  <motion.path
                    fill="none"
                    style={{ stroke: line.color }}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={line.dash}
                    // the dashed total fades in: pathLength would overwrite its dasharray
                    initial={line.dash ? { opacity: 0, d: line.d } : { pathLength: 0, d: line.d }}
                    animate={
                      line.dash
                        ? { opacity: seen ? 1 : 0, d: line.d }
                        : { pathLength: seen ? 1 : 0, d: line.d }
                    }
                    transition={{
                      pathLength: draw,
                      opacity: { duration: 0.8, delay: 0.6 },
                      d: { duration: 0.6, ease },
                    }}
                  />
                </g>
              ))}
            <AnimatePresence>
              {current && (
                <motion.g
                  key="cursor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <motion.line
                    className="ag-cursor-line"
                    y1={top}
                    y2={y(0)}
                    initial={{ x1: cursor, x2: cursor }}
                    animate={{ x1: cursor, x2: cursor }}
                    transition={glide}
                  />
                  {shown.map((item) => (
                    <motion.circle
                      key={item.id}
                      r={4.5}
                      style={{ fill: item.color }}
                      className="ag-cursor-dot"
                      initial={{ cx: cursor, cy: y(valueAt(current, item.id, metric)) }}
                      animate={{ cx: cursor, cy: y(valueAt(current, item.id, metric)) }}
                      transition={glide}
                    />
                  ))}
                </motion.g>
              )}
            </AnimatePresence>
          </svg>
        )}
        <AnimatePresence>
          {current && (
            <motion.div
              key="tooltip"
              className={`ag-tooltip ${cursor > width / 2 ? 'is-left' : ''}`}
              role="status"
              initial={{ opacity: 0, scale: 0.96, x: cursor }}
              animate={{ opacity: 1, scale: 1, x: cursor }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ x: glide, opacity: { duration: 0.15 }, scale: { duration: 0.2 } }}
            >
              <strong>{fullDay(current.date)}</strong>
              {shown.map((item) => (
                <span key={item.id}>
                  <i style={{ background: item.color }} className={item.dash ? 'is-dashed' : ''} />
                  {item.label}
                  <b>{fmt(valueAt(current, item.id, metric))}</b>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="ag-x-axis" aria-hidden="true">
        {labels.map((index) => (
          <span
            key={index}
            style={{
              left: x(index),
              opacity: current && Math.abs(x(index) - cursor) < 64 ? 0 : 1,
            }}
            className={index === 0 ? 'is-first' : index === points.length - 1 ? 'is-last' : ''}
          >
            {day(points[index].date)}
          </span>
        ))}
        <AnimatePresence>
          {current && (
            <motion.b
              key="pill"
              className="ag-date-pill"
              initial={{ opacity: 0, y: 4, x: Math.max(left + 36, Math.min(width - 36, cursor)) }}
              animate={{ opacity: 1, y: 0, x: Math.max(left + 36, Math.min(width - 36, cursor)) }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ x: glide, default: { duration: 0.2 } }}
            >
              {day(current.date)}
            </motion.b>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TrendChart() {
  const [period, setPeriod] = useState('30');
  const [metric, setMetric] = useState<Metric>('views');
  const [style, setStyle] = useState('area');
  const [visible, setVisible] = useState<SeriesId[]>(['telegram', 'tiktok']);
  const [dataView, setDataView] = useState(false);
  const days = Number(period);
  const points = useMemo(() => samples.slice(-days), [days]);
  const previous = useMemo(() => samples.slice(-days * 2, -days), [days]);
  const shown = series.filter((item) => visible.includes(item.id));
  const last = points.at(-1)!;
  return (
    <>
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">01 / Динамика</span>
          <h3>Рост площадок</h3>
        </div>
        <Segment
          label="Период графика"
          size="sm"
          value={period}
          onChange={setPeriod}
          values={[
            { id: '7', label: '7 дней' },
            { id: '30', label: '30 дней' },
            { id: '90', label: '90 дней' },
          ]}
        />
      </div>
      <div className="ag-kpis" role="group" aria-label="Показатель графика">
        {metrics.map((item) => {
          const now = summary(points, item.id);
          const before = summary(previous, item.id);
          return (
            <button
              type="button"
              key={item.id}
              aria-pressed={metric === item.id}
              onClick={() => setMetric(item.id)}
            >
              <span className="ag-kpi-label">{item.label}</span>
              <AnimatedNumber value={now} className="ag-kpi-value" />
              <Delta value={((now - before) / before) * 100} suffix={`к прошлым ${days} дням`} />
            </button>
          );
        })}
      </div>
      <div className="ag-chart-toolbar">
        <div className="ag-chart-legend" role="group" aria-label="Ряды графика">
          {series.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={visible.includes(item.id)}
              onClick={() =>
                setVisible((now) =>
                  now.includes(item.id) ? now.filter((id) => id !== item.id) : [...now, item.id],
                )
              }
            >
              <span
                className={`ag-swatch ${item.dash ? 'is-dashed' : ''}`}
                style={{ '--c': item.color } as CSSProperties}
              />
              {item.label}
              <strong>{compact(valueAt(last, item.id, metric))}</strong>
            </button>
          ))}
        </div>
        <div className="ag-chart-tools">
          <Segment
            label="Вид графика"
            size="sm"
            value={style}
            onChange={setStyle}
            values={[
              { id: 'area', label: 'Области' },
              { id: 'line', label: 'Линии' },
            ]}
          />
          <button
            type="button"
            className="ag-table-toggle"
            aria-pressed={dataView}
            onClick={() => setDataView((value) => !value)}
          >
            {dataView ? 'График' : 'Данные'}
          </button>
        </div>
      </div>
      {dataView ? (
        <div className="ag-data-scroll">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                {series.map((item) => (
                  <th key={item.id}>{item.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{day(point.date)}</td>
                  {series.map((item) => (
                    <td key={item.id}>{fmt(valueAt(point, item.id, metric))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : shown.length ? (
        <TrendPlot points={points} shown={shown} metric={metric} area={style === 'area'} />
      ) : (
        <div className="ag-chart-empty">Выберите ряд на легенде</div>
      )}
    </>
  );
}

const flow: Record<Platform, number[]> = {
  telegram: [1080, 638, 221, 84],
  tiktok: [720, 503, 131, 58],
};
const stages = ['Публикации', 'Вопросы', 'Темы', 'Материалы'];
const stageSteps = [
  '',
  'публикаций дали вопросы',
  'вопросов сложились в темы',
  'тем стали материалами',
];
const stageNouns = [
  ['публикация', 'публикации', 'публикаций'],
  ['вопрос', 'вопроса', 'вопросов'],
  ['тема', 'темы', 'тем'],
  ['материал', 'материала', 'материалов'],
];
function stageNoun(value: number, stage: number) {
  const tail = value % 100;
  return stageNouns[stage][
    tail > 10 && tail < 20 ? 2 : value % 10 === 1 ? 0 : value % 10 >= 2 && value % 10 <= 4 ? 1 : 2
  ];
}
function FlowChart() {
  const [source, setSource] = useState<'all' | Platform>('all');
  const [active, setActive] = useState(3);
  const ref = useRef<HTMLOListElement>(null);
  const seen = useInView(ref, { once: true, margin: '-60px' });
  const parts: Platform[] = source === 'all' ? ['telegram', 'tiktok'] : [source];
  const totals = stages.map((_, i) => parts.reduce((sum, part) => sum + flow[part][i], 0));
  return (
    <>
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">02 / Путь к материалу</span>
          <h3>
            <AnimatedNumber value={totals[active]} />{' '}
            <span className="ag-h3-sub">{stageNoun(totals[active], active)}</span>
          </h3>
        </div>
        <Segment
          label="Источник воронки"
          size="sm"
          value={source}
          onChange={(id) => setSource(id as typeof source)}
          values={[
            { id: 'all', label: 'Все' },
            { id: 'telegram', label: 'TG', icon: <TelegramLogoIcon size={14} /> },
            { id: 'tiktok', label: 'TT', icon: <TiktokLogoIcon size={14} /> },
          ]}
        />
      </div>
      <p className="ag-card-lead">
        Сколько публикаций доходит до готового материала — и где отсеивается больше всего.
      </p>
      <ol className="ag-flow" ref={ref}>
        {stages.map((label, i) => (
          <li key={label}>
            {i > 0 && (
              <motion.div
                className="ag-flow-step"
                initial={{ opacity: 0, y: -4 }}
                animate={seen ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.25 + i * 0.12, ease }}
              >
                <ArrowDownIcon size={12} />
                <strong>
                  <AnimatedNumber
                    value={Math.round((totals[i] / totals[i - 1]) * 100)}
                    format={(n) => Math.round(n) + '%'}
                  />
                </strong>
                {stageSteps[i]}
              </motion.div>
            )}
            <button
              type="button"
              className="ag-flow-row"
              aria-pressed={active === i}
              aria-label={`${label}: ${fmt(totals[i])}${parts.length > 1 ? `, Telegram ${fmt(flow.telegram[i])}, TikTok ${fmt(flow.tiktok[i])}` : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <span className="ag-flow-label">{label}</span>
              <span className="ag-flow-split">
                {parts.length > 1 &&
                  parts.map((part) => (
                    <span key={part}>
                      <i style={{ background: platformColor[part] }} />
                      {fmt(flow[part][i])}
                    </span>
                  ))}
              </span>
              <strong className="ag-flow-value">{fmt(totals[i])}</strong>
              <span className="ag-flow-bar">
                {(['telegram', 'tiktok'] as Platform[]).map((part, k) => (
                  <motion.span
                    key={part}
                    style={{ background: platformColor[part] }}
                    initial={{ width: '0%' }}
                    animate={{
                      width:
                        seen && parts.includes(part)
                          ? `${(flow[part][i] / totals[0]) * 100}%`
                          : '0%',
                      marginRight: k === 0 && parts.length > 1 ? 2 : 0,
                    }}
                    transition={{ duration: 0.9, delay: seen ? 0.1 + i * 0.12 : 0, ease }}
                  />
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {parts.length > 1 && (
        <div className="ag-mini-legend" aria-hidden="true">
          {parts.map((part) => (
            <span key={part}>
              <i style={{ background: platformColor[part] }} />
              {platformLabel[part]}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

const donutSets = {
  platform: [
    { label: 'Telegram', value: 63, color: 'var(--tg)' },
    { label: 'TikTok', value: 37, color: 'var(--tt)' },
  ],
  format: [
    { label: 'Посты', value: 42, color: '#a1a1a1' },
    { label: 'Видео', value: 35, color: '#767676' },
    { label: 'Обсуждения', value: 23, color: '#5c5c5c' },
  ],
};
function sector(start: number, end: number) {
  if (end - start < 2.5) return '';
  const at = (angle: number, radius: number) => [
    150 + Math.cos(((angle - 90) / 180) * Math.PI) * radius,
    150 + Math.sin(((angle - 90) / 180) * Math.PI) * radius,
  ];
  const outside1 = at(start + 1.2, 124),
    outside2 = at(end - 1.2, 124),
    inside1 = at(end - 1.2, 76),
    inside2 = at(start + 1.2, 76);
  const large = end - start > 180 ? 1 : 0;
  return `M${outside1}A124,124 0 ${large} 1 ${outside2}L${inside1}A76,76 0 ${large} 0 ${inside2}Z`;
}
function DonutChart() {
  const [kind, setKind] = useState<keyof typeof donutSets>('format');
  const [selected, setSelected] = useState(0);
  const [sweep, setSweep] = useState(0);
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, margin: '-60px' });
  const reduced = useReducedMotion();
  const data = donutSets[kind];
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setSweep(1);
    const controls = animate(0, 1, { duration: 1.1, ease, onUpdate: setSweep });
    return () => controls.stop();
  }, [kind, seen, reduced]);
  let offset = 0;
  return (
    <>
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">03 / Структура</span>
          <h3>Материалы</h3>
        </div>
        <Segment
          label="Группировка материалов"
          size="sm"
          value={kind}
          onChange={(id) => {
            setKind(id as keyof typeof donutSets);
            setSelected(0);
          }}
          values={[
            { id: 'format', label: 'Форматы' },
            { id: 'platform', label: 'Площадки' },
          ]}
        />
      </div>
      <div className="ag-donut-body">
        <div className="ag-donut-visual">
          <svg
            ref={ref}
            viewBox="0 0 300 300"
            role="img"
            aria-label={`Доли материалов: ${data.map((item) => `${item.label} ${item.value}%`).join(', ')}`}
          >
            <defs>
              {data.map((item, i) => (
                <pattern
                  id={`ag-stripes-${i}`}
                  key={kind + i}
                  width={i === 0 ? 4 : 5}
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform={`rotate(${i === 0 ? 45 : i === 1 ? -45 : 0})`}
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="5"
                    style={{
                      stroke: i === selected && kind === 'format' ? '#eeeeee' : item.color,
                      strokeWidth: i === selected ? 1.9 : 1.1,
                    }}
                  />
                </pattern>
              ))}
            </defs>
            {data.map((item, i) => {
              const start = offset * sweep;
              offset += (item.value / 100) * 360;
              return (
                <path
                  key={kind + item.label}
                  className={i === selected ? 'is-selected' : ''}
                  d={sector(start, offset * sweep)}
                  fill={`url(#ag-stripes-${i})`}
                  style={{
                    stroke:
                      i === selected ? (kind === 'platform' ? item.color : '#b5b5b5') : '#303030',
                  }}
                  strokeWidth=".8"
                  onPointerEnter={() => setSelected(i)}
                  onClick={() => setSelected(i)}
                />
              );
            })}
          </svg>
          <div className="ag-donut-center">
            <AnimatedNumber
              value={data[selected].value}
              format={(n) => Math.round(n) + '%'}
              className="ag-donut-number"
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={data[selected].label}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {data[selected].label}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
        <div className="ag-donut-legend">
          {data.map((item, i) => (
            <button
              type="button"
              key={kind + item.label}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
              onPointerEnter={() => setSelected(i)}
            >
              <span
                className={`ag-stripe-swatch stripe-${i}`}
                style={{ '--c': item.color } as CSSProperties}
              />
              <span>{item.label}</span>
              <strong>{item.value}%</strong>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const sourceRows: { label: string; platform: Platform; value: number; trend: number[] }[] = [
  {
    label: 'IT-сообщество',
    platform: 'telegram',
    value: 146,
    trend: [3, 7, 4, 9, 5, 12, 9, 15, 18, 13, 21, 17],
  },
  {
    label: 'Комментарии к видео',
    platform: 'tiktok',
    value: 118,
    trend: [4, 3, 6, 9, 4, 7, 11, 8, 15, 17, 13, 20],
  },
  {
    label: 'Мой канал',
    platform: 'telegram',
    value: 82,
    trend: [3, 4, 7, 4, 8, 6, 10, 9, 7, 12, 13, 11],
  },
  {
    label: 'Чат обсуждений',
    platform: 'telegram',
    value: 61,
    trend: [4, 3, 3, 7, 4, 3, 8, 5, 6, 9, 7, 10],
  },
];
function SourceBars() {
  const [active, setActive] = useState('all');
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-60px' });
  const filtered = sourceRows.filter((row) => active === 'all' || row.platform === active);
  return (
    <>
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">04 / Источники</span>
          <h3>Обсуждения</h3>
        </div>
        <Segment
          label="Источники обсуждений"
          size="sm"
          value={active}
          onChange={setActive}
          values={[
            { id: 'all', label: 'Все' },
            { id: 'telegram', label: 'TG', icon: <TelegramLogoIcon size={14} /> },
            { id: 'tiktok', label: 'TT', icon: <TiktokLogoIcon size={14} /> },
          ]}
        />
      </div>
      <motion.div className="ag-source-list" ref={ref} layout>
        <AnimatePresence mode="popLayout" initial={false}>
          {filtered.map((row, i) => (
            <motion.div
              layout
              key={row.label}
              className="ag-source-row"
              style={{ '--c': platformColor[row.platform] } as CSSProperties}
              initial={{ opacity: 0, y: 14 }}
              animate={seen ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
              transition={{ duration: 0.6, delay: i * 0.08, ease }}
            >
              <div className="ag-source-name">
                <strong>{row.label}</strong>
                <span>
                  <i />
                  {platformLabel[row.platform]}
                </span>
              </div>
              <div className="ag-source-meter" aria-label={`${row.value} обсуждений`}>
                <motion.span
                  initial={{ width: '0%' }}
                  animate={{ width: seen ? `${(row.value / sourceRows[0].value) * 100}%` : '0%' }}
                  transition={{ duration: 1.1, delay: 0.2 + i * 0.08, ease }}
                />
              </div>
              <div className="ag-spark-bars" aria-hidden="true">
                {row.trend.map((height, k) => (
                  <motion.i
                    key={k}
                    style={{ height }}
                    className={k === row.trend.length - 1 ? 'is-last' : ''}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: seen ? 1 : 0 }}
                    transition={{ duration: 0.5, delay: 0.3 + i * 0.08 + k * 0.035, ease }}
                  />
                ))}
              </div>
              <strong className="ag-source-value">
                <AnimatedNumber value={row.value} delay={0.2 + i * 0.08} />
                <ArrowUpRightIcon size={13} aria-hidden="true" />
              </strong>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

type Session =
  | {
      kind: 'run';
      platform: Platform;
      title: string;
      minutes: number;
      activity: number[];
      note: string;
      detail: string;
    }
  | { kind: 'pause'; minutes: number };
const journal: Session[] = [
  {
    kind: 'run',
    platform: 'telegram',
    title: 'Каналы',
    minutes: 6,
    activity: [1, 2, 1, 3, 2, 4, 3],
    note: '4 канала',
    detail: '312 публикаций, 18 повторов отброшено',
  },
  { kind: 'pause', minutes: 4 },
  {
    kind: 'run',
    platform: 'tiktok',
    title: 'Комментарии к роликам',
    minutes: 53,
    activity: [0, 1, 2, 2, 0, 1, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 1],
    note: '45% с вопросами',
    detail: '12 роликов, 486 комментариев, 219 вопросов',
  },
  { kind: 'pause', minutes: 12 },
  {
    kind: 'run',
    platform: 'telegram',
    title: 'Чат обсуждений',
    minutes: 21,
    activity: [0, 0, 1, 3, 4, 2, 1],
    note: '46% с вопросами',
    detail: '128 сообщений, 59 вопросов',
  },
  { kind: 'pause', minutes: 3 },
  {
    kind: 'run',
    platform: 'tiktok',
    title: 'Ответы авторам',
    minutes: 2,
    activity: [1, 2],
    note: '9 веток',
    detail: '9 веток ответов, 4 новые темы',
  },
];
const duration = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
function CollectionJournal() {
  const [open, setOpen] = useState<number | null>(null);
  const runs = journal.filter((s) => s.kind === 'run');
  const total = journal.reduce((sum, s) => sum + s.minutes, 0);
  const longest = Math.max(...runs.map((s) => s.minutes));
  const pauses = journal.length - runs.length;
  return (
    <>
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">05 / Журнал сбора</span>
          <h3>
            Сегодня <span className="ag-h3-sub">· {duration(total)}</span>
          </h3>
        </div>
      </div>
      <ol className="ag-journal">
        {journal.map((session, i) => (
          <motion.li
            key={i}
            className={`ag-journal-item is-${session.kind}`}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, delay: i * 0.07, ease }}
          >
            {session.kind === 'pause' ? (
              <div className="ag-journal-row">
                <span className="ag-journal-rail">
                  <i className="ag-journal-pause" />
                </span>
                <span className="ag-journal-title">Пауза</span>
                <span className="ag-journal-time">{duration(session.minutes)}</span>
              </div>
            ) : (
              <button
                type="button"
                className="ag-journal-row"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                style={{ '--c': platformColor[session.platform] } as CSSProperties}
              >
                <span className="ag-journal-rail">
                  <motion.i
                    className="ag-journal-bar"
                    style={{ height: 26 + (session.minutes / longest) * 74 }}
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ duration: 0.8, delay: 0.15 + i * 0.07, ease }}
                  />
                </span>
                <span className="ag-journal-body">
                  <span className="ag-journal-title">
                    {session.platform === 'telegram' ? (
                      <TelegramLogoIcon size={15} />
                    ) : (
                      <TiktokLogoIcon size={15} />
                    )}
                    {session.title}
                  </span>
                  <span className="ag-journal-activity" aria-hidden="true">
                    {session.activity.map((level, k) => (
                      <i key={k} data-level={level} style={{ height: level ? 4 + level * 4 : 4 }} />
                    ))}
                  </span>
                  <span className="ag-journal-note">{session.note}</span>
                  <AnimatePresence initial={false}>
                    {open === i && (
                      <motion.span
                        className="ag-journal-detail"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease }}
                      >
                        {session.detail}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="ag-journal-time">{duration(session.minutes)}</span>
              </button>
            )}
          </motion.li>
        ))}
        <motion.li
          className="ag-journal-item is-end"
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: journal.length * 0.07, ease }}
        >
          <div className="ag-journal-row">
            <span className="ag-journal-rail">
              <StatusIcon kind="done" size={15} />
            </span>
            <span className="ag-journal-title">Завершено</span>
            <span className="ag-journal-time is-total">{duration(total)}</span>
          </div>
        </motion.li>
      </ol>
      <div className="ag-journal-stats">
        <div>
          <strong>
            <AnimatedNumber value={longest} /> мин
          </strong>
          <span>Самая длинная сессия</span>
        </div>
        <div>
          <strong>
            <AnimatedNumber value={new Set(runs.map((s) => s.platform)).size} />
          </strong>
          <span>Площадки</span>
        </div>
        <div>
          <strong>
            <AnimatedNumber value={pauses} />
          </strong>
          <span>Паузы</span>
        </div>
      </div>
    </>
  );
}

export function AnalyticsGallery() {
  return (
    <section id="analytics" className="ec-section ag-section">
      <SectionHeading number="04" title="Графики">
        <span className="ec-demo">Демо</span>
      </SectionHeading>
      <Reveal className="ag-card ag-trend ec-glow">
        <TrendChart />
      </Reveal>
      <div className="ag-middle-grid">
        <Reveal className="ag-card ag-funnel ec-glow">
          <FlowChart />
        </Reveal>
        <Reveal className="ag-card ag-donut ec-glow" delay={0.08}>
          <DonutChart />
        </Reveal>
      </div>
      <div className="ag-bottom-grid">
        <Reveal className="ag-card ag-sources ec-glow">
          <SourceBars />
        </Reveal>
        <Reveal className="ag-card ag-journal-card ec-glow" delay={0.08}>
          <CollectionJournal />
        </Reveal>
      </div>
    </section>
  );
}
