import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
} from '@phosphor-icons/react';
import { AnimatedNumber, Reveal, SectionHeading, Segment, StatusIcon } from '../shared/ui';
import { TrendPlot } from '../features/analytics/TrendPlot';
import { MetricDelta as Delta } from '../features/analytics/MetricDelta';
import { analyticsPeriods, type AnalyticsPeriod } from '../features/analytics/model';
import {
  fmt,
  compact,
  ease,
  day,
  platformColor,
  platformLabel,
  type Metric,
  type Platform,
  type SeriesId,
} from '../features/analytics/chart-model';
import { series, coreMetrics as metrics, valueAt, summary } from '../features/analytics/data';
import { samples } from './analytics-samples';
import './analytics-gallery.css';

function TrendChart() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('30');
  const [metric, setMetric] = useState<Metric>('views');
  const [style, setStyle] = useState('area');
  const [visible, setVisible] = useState<SeriesId[]>(['telegram', 'tiktok']);
  const [dataView, setDataView] = useState(false);
  const { points, previous } = useMemo(() => {
    if (period === 'all') return { points: samples, previous: [] };
    const days = Number(period);
    return { points: samples.slice(-days), previous: samples.slice(-days * 2, -days) };
  }, [period]);
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
          onChange={(value) => setPeriod(value as AnalyticsPeriod)}
          values={analyticsPeriods}
        />
      </div>
      <div className="ag-kpis" role="group" aria-label="Показатель графика">
        {metrics.map((item) => {
          const now = summary(points, item.id);
          const before = previous.length ? summary(previous, item.id) : null;
          return (
            <button
              type="button"
              key={item.id}
              aria-pressed={metric === item.id}
              onClick={() => setMetric(item.id)}
            >
              <span className="ag-kpi-label">{item.label}</span>
              <AnimatedNumber value={now} className="ag-kpi-value" />
              {before !== null && (
                <Delta
                  value={before ? ((now - before) / before) * 100 : 0}
                  suffix={`к прошлым ${period} дням`}
                />
              )}
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
        <TrendPlot
          points={points}
          shown={shown}
          metric={metric}
          area={style === 'area'}
          readValue={(point, id) => valueAt(point, id, metric)}
        />
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
      <SectionHeading number="04" title="Графики" />
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
