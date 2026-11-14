import { useMemo, useState, type PointerEvent } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import './analytics-gallery.css';

type Metric = 'followers' | 'views' | 'comments';
type SeriesId = 'telegram' | 'tiktok' | 'total';
type Point = { date: string; telegram: Record<Metric, number>; tiktok: Record<Metric, number> };
type Coordinate = [number, number];
const fmt = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const compact = (value: number) =>
  new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const day = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
const fullDay = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
const samples: Point[] = Array.from({ length: 90 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString(),
  telegram: {
    followers: Math.round(11240 + i * 34 + Math.sin(i / 8) * 80),
    views: Math.round(
      2150 + i * 24 + Math.sin(i / 4) * 380 + Math.cos(i / 9) * 210 + (i > 64 && i < 72 ? 1000 : 0),
    ),
    comments: Math.round(24 + i * 0.5 + Math.sin(i / 4) * 12 + (i > 64 && i < 72 ? 28 : 0)),
  },
  tiktok: {
    followers: Math.round(2120 + i * 26 + Math.sin(i / 7) * 75),
    views: Math.round(
      4300 +
        i * 38 +
        Math.sin(i / 5 + 0.8) * 1800 +
        Math.cos(i / 9) * 420 +
        (i > 64 && i < 73 ? 2600 : 0),
    ),
    comments: Math.round(48 + i * 0.8 + Math.sin(i / 5) * 20 + (i > 64 && i < 73 ? 40 : 0)),
  },
}));
const series = [
  { id: 'telegram' as const, label: 'Telegram', color: '#eeeeee', dash: undefined },
  { id: 'tiktok' as const, label: 'TikTok', color: '#969696', dash: undefined },
  { id: 'total' as const, label: 'Вместе', color: '#5b5b5b', dash: '5 6' },
];
const metrics: { id: Metric; label: string }[] = [
  { id: 'followers', label: 'Подписчики' },
  { id: 'views', label: 'Просмотры' },
  { id: 'comments', label: 'Комментарии' },
];
const valueAt = (point: Point, id: SeriesId, metric: Metric) =>
  id === 'total' ? point.telegram[metric] + point.tiktok[metric] : point[id][metric];

function smoothPath(points: Coordinate[]) {
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

function TrendChart() {
  const [period, setPeriod] = useState('30');
  const [metric, setMetric] = useState<Metric>('views');
  const [style, setStyle] = useState('area');
  const [visible, setVisible] = useState<SeriesId[]>(['telegram', 'tiktok']);
  const [active, setActive] = useState<number | null>(null);
  const [dataView, setDataView] = useState(false);
  const points = useMemo(() => samples.slice(-Number(period)), [period]);
  const shown = series.filter((item) => visible.includes(item.id));
  const max =
    Math.max(
      1,
      ...points.flatMap((point) => shown.map((item) => valueAt(point, item.id, metric))),
    ) * 1.1;
  const coords = (id: SeriesId): Coordinate[] =>
    points.map((point, i) => [
      (i / (points.length - 1)) * 1000,
      284 - (valueAt(point, id, metric) / max) * 264,
    ]);
  const last = points.at(-1)!;
  const combined =
    metric === 'followers'
      ? valueAt(last, 'total', metric)
      : points.reduce((sum, point) => sum + valueAt(point, 'total', metric), 0);
  const label = metrics.find((item) => item.id === metric)!.label;
  const current = active == null ? null : points[active];
  function pick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(
      Math.max(
        0,
        Math.min(
          points.length - 1,
          Math.round(((event.clientX - rect.left) / rect.width) * (points.length - 1)),
        ),
      ),
    );
  }
  return (
    <article className="ag-card ag-trend">
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">01 / Динамика</span>
          <h3>{label}</h3>
        </div>
        <label className="ag-select">
          <span className="ag-sr-only">Период графика</span>
          <select
            aria-label="Период графика"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value);
              setActive(null);
            }}
          >
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>
      <div className="ag-trend-summary">
        <strong>{fmt(combined)}</strong>
        <span>{metric === 'followers' ? 'на двух площадках' : 'за выбранный период'}</span>
        <div className="ag-switch-group" aria-label="Вид графика">
          {[
            ['area', 'Области'],
            ['line', 'Линии'],
          ].map(([id, title]) => (
            <button key={id} aria-pressed={style === id} onClick={() => setStyle(id)}>
              {title}
            </button>
          ))}
        </div>
      </div>
      <div className="ag-metric-tabs" aria-label="Показатель графика">
        {metrics.map((item) => (
          <button
            key={item.id}
            aria-pressed={metric === item.id}
            onClick={() => {
              setMetric(item.id);
              setActive(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ag-chart-legend" aria-label="Ряды графика">
        {series.map((item) => (
          <button
            key={item.id}
            aria-pressed={visible.includes(item.id)}
            onClick={() =>
              setVisible((previous) =>
                previous.includes(item.id)
                  ? previous.filter((id) => id !== item.id)
                  : [...previous, item.id],
              )
            }
          >
            <span
              style={{ background: item.color }}
              className={!visible.includes(item.id) ? 'is-off' : ''}
            />
            {item.label}
            <strong>{compact(valueAt(last, item.id, metric))}</strong>
          </button>
        ))}
        <button
          className="ag-table-toggle"
          aria-pressed={dataView}
          onClick={() => setDataView((value) => !value)}
        >
          {dataView ? 'График' : 'Данные'}
        </button>
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
        <div className="ag-chart-wrap">
          <div className="ag-y-axis" aria-hidden="true">
            {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
              <span key={ratio}>{compact(Math.round(max * ratio))}</span>
            ))}
          </div>
          <div className="ag-plot">
            <svg
              viewBox="0 0 1000 300"
              preserveAspectRatio="none"
              className="ag-trend-svg"
              role="img"
              tabIndex={0}
              aria-label={`${label}: ${period} дней. Стрелки выбирают день. Полные значения доступны по кнопке «Данные».`}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(points.length - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
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
                              (previous ?? points.length - 1) +
                                (event.key === 'ArrowLeft' ? -1 : 1),
                            ),
                          ),
                  );
                }
              }}
            >
              <defs>
                {series.map((item) => (
                  <linearGradient
                    key={item.id}
                    id={`ag-area-${item.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0" stopColor={item.color} stopOpacity=".18" />
                    <stop offset="1" stopColor={item.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>
              {[20, 86, 152, 218, 284].map((y) => (
                <line key={y} x1="0" y1={y} x2="1000" y2={y} className="ag-grid-line" />
              ))}
              {shown
                .slice()
                .reverse()
                .map((item) => {
                  const line = smoothPath(coords(item.id));
                  return (
                    <g key={item.id}>
                      {style === 'area' && (
                        <path d={`${line}L1000,284L0,284Z`} fill={`url(#ag-area-${item.id})`} />
                      )}
                      <path
                        d={line}
                        fill="none"
                        stroke={item.color}
                        strokeWidth={item.id === 'telegram' ? 2.2 : 1.8}
                        strokeDasharray={item.dash}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              {current && (
                <g>
                  <line
                    x1={(active! / (points.length - 1)) * 1000}
                    y1="12"
                    x2={(active! / (points.length - 1)) * 1000}
                    y2="284"
                    className="ag-cursor-line"
                  />
                  {shown.map((item) => (
                    <circle
                      key={item.id}
                      cx={(active! / (points.length - 1)) * 1000}
                      cy={284 - (valueAt(current, item.id, metric) / max) * 264}
                      r="4"
                      fill={item.color}
                      stroke="var(--bg, #090909)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              )}
            </svg>
            {current && (
              <div
                className="ag-tooltip"
                role="status"
                style={{
                  left: `clamp(95px, ${(active! / (points.length - 1)) * 100}%, calc(100% - 95px))`,
                }}
              >
                <strong>{fullDay(current.date)}</strong>
                {shown.map((item) => (
                  <span key={item.id}>
                    <i style={{ background: item.color }} />
                    {item.label}
                    <b>{fmt(valueAt(current, item.id, metric))}</b>
                  </span>
                ))}
              </div>
            )}
            <div className="ag-x-axis" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                <span key={i}>{day(points[Math.round((points.length - 1) * ratio)].date)}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ag-chart-empty">Выберите ряд на легенде</div>
      )}
    </article>
  );
}

const funnelSets = {
  all: { label: 'Все источники', counts: [1800, 1141, 352, 142] },
  telegram: { label: 'Telegram', counts: [1080, 638, 221, 84] },
  tiktok: { label: 'TikTok', counts: [720, 503, 131, 58] },
};
const stages = ['Публикации', 'Вопросы', 'Темы', 'Материалы'];
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
function ribbon(heights: number[], inset: number) {
  const center = 136;
  const xs = [0, 250, 500, 750];
  let result = `M0,${center - heights[0] * inset}`;
  for (let i = 0; i < 3; i++)
    result += `C${xs[i] + 125},${center - heights[i] * inset} ${xs[i + 1] - 125},${center - heights[i + 1] * inset} ${xs[i + 1]},${center - heights[i + 1] * inset}`;
  result += `L750,${center + heights[3] * inset}`;
  for (let i = 3; i > 0; i--)
    result += `C${xs[i] - 125},${center + heights[i] * inset} ${xs[i - 1] + 125},${center + heights[i - 1] * inset} ${xs[i - 1]},${center + heights[i - 1] * inset}`;
  return result + 'Z';
}
function FunnelChart() {
  const [source, setSource] = useState<keyof typeof funnelSets>('all');
  const [active, setActive] = useState(3);
  const counts = funnelSets[source].counts;
  const heights = counts.map((value) => 22 + (value / counts[0]) * 106);
  return (
    <article className="ag-card ag-funnel">
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">02 / Поток материалов</span>
          <h3>
            {fmt(counts[active])} <span>{stageNoun(counts[active], active)}</span>
          </h3>
        </div>
        <label className="ag-select">
          <span className="ag-sr-only">Источник воронки</span>
          <select
            aria-label="Источник воронки"
            value={source}
            onChange={(event) => setSource(event.target.value as keyof typeof funnelSets)}
          >
            {Object.entries(funnelSets).map(([key, set]) => (
              <option value={key} key={key}>
                {set.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>
      <div className="ag-funnel-stages">
        {stages.map((label, i) => (
          <button
            key={label}
            className={active === i ? 'is-active' : ''}
            aria-pressed={active === i}
            onClick={() => setActive(i)}
          >
            <strong>{fmt(counts[i])}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="ag-funnel-visual">
        <svg
          viewBox="0 0 750 272"
          preserveAspectRatio="none"
          role="img"
          aria-label="Переход от публикаций к материалам"
        >
          <path d={ribbon(heights, 1)} fill="#252525" />
          <path d={ribbon(heights, 0.88)} fill="#383838" />
          <path d={ribbon(heights, 0.75)} fill="#5d5d5d" />
          <path d={ribbon(heights, 0.63)} fill="#a3a3a3" />
          {[125, 375, 625].map((x) => (
            <line
              key={x}
              x1={x}
              y1="0"
              x2={x}
              y2="272"
              stroke="var(--bg, #090909)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="ag-funnel-percentages">
          {counts.map((value, i) => (
            <button
              key={i}
              aria-label={`${stages[i]}: ${fmt(value)}, ${Math.round((value / counts[0]) * 100)} процентов`}
              aria-pressed={active === i}
              onClick={() => setActive(i)}
            >
              {Math.round((value / counts[0]) * 100)}%
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

const donutSets = {
  platform: [
    { label: 'Telegram', value: 63 },
    { label: 'TikTok', value: 37 },
  ],
  format: [
    { label: 'Посты', value: 42 },
    { label: 'Видео', value: 35 },
    { label: 'Обсуждения', value: 23 },
  ],
};
function sector(start: number, end: number) {
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
  const data = donutSets[kind];
  let offset = 0;
  return (
    <article className="ag-card ag-donut">
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">03 / Структура</span>
          <h3>Материалы</h3>
        </div>
        <div className="ag-switch-group" aria-label="Группировка материалов">
          {[
            ['format', 'Форматы'],
            ['platform', 'Площадки'],
          ].map(([id, title]) => (
            <button
              key={id}
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id as keyof typeof donutSets);
                setSelected(0);
              }}
            >
              {title}
            </button>
          ))}
        </div>
      </div>
      <div className="ag-donut-body">
        <div className="ag-donut-visual">
          <svg
            viewBox="0 0 300 300"
            role="img"
            aria-label={`Доли материалов: ${data.map((item) => `${item.label} ${item.value}%`).join(', ')}`}
          >
            <defs>
              {[0, 1, 2].map((i) => (
                <pattern
                  id={`ag-stripes-${i}`}
                  key={i}
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
                    stroke={i === selected ? '#eeeeee' : i === 0 ? '#a1a1a1' : '#676767'}
                    strokeWidth={i === selected ? 1.8 : 1}
                  />
                </pattern>
              ))}
            </defs>
            {data.map((item, i) => {
              const start = offset;
              offset += (item.value / 100) * 360;
              return (
                <path
                  key={item.label}
                  d={sector(start, offset)}
                  fill={`url(#ag-stripes-${i})`}
                  stroke={i === selected ? '#b5b5b5' : '#303030'}
                  strokeWidth=".65"
                  onPointerEnter={() => setSelected(i)}
                  onClick={() => setSelected(i)}
                />
              );
            })}
          </svg>
          <div className="ag-donut-center">
            <strong>{data[selected].value}%</strong>
            <span>{data[selected].label}</span>
          </div>
        </div>
        <div className="ag-donut-legend">
          {data.map((item, i) => (
            <button key={item.label} aria-pressed={selected === i} onClick={() => setSelected(i)}>
              <span className={`ag-stripe-swatch stripe-${i}`} />
              <span>{item.label}</span>
              <strong>{item.value}%</strong>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
function ActivityHeatmap() {
  const [week, setWeek] = useState('current');
  const [selected, setSelected] = useState(4 * 24 + 19);
  const values = useMemo(
    () =>
      Array.from({ length: 168 }, (_, i) => {
        const hour = i % 24,
          dayIndex = Math.floor(i / 24);
        return Math.max(
          0,
          Math.round(
            (Math.sin(((hour - 8) / 24) * Math.PI * 2) + 1.2) * 18 +
              ((dayIndex * 7 + hour * 3 + (week === 'current' ? 4 : 9)) % 17) +
              (hour > 15 && hour < 21 ? 25 : 0),
          ),
        );
      }),
    [week],
  );
  const max = Math.max(...values);
  const selectedDay = Math.floor(selected / 24),
    selectedHour = selected % 24;
  function move(index: number) {
    const next = Math.max(0, Math.min(167, index));
    setSelected(next);
    requestAnimationFrame(() => document.getElementById(`ag-activity-${next}`)?.focus());
  }
  return (
    <article className="ag-card ag-activity">
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">04 / Активность</span>
          <h3>Когда отвечает аудитория</h3>
        </div>
        <label className="ag-select">
          <span className="ag-sr-only">Неделя активности</span>
          <select
            aria-label="Неделя активности"
            value={week}
            onChange={(event) => setWeek(event.target.value)}
          >
            <option value="current">Эта неделя</option>
            <option value="previous">Прошлая неделя</option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>
      <div className="ag-activity-summary">
        <strong>
          {weekdays[selectedDay]}, {String(selectedHour).padStart(2, '0')}:00
        </strong>
        <span>{values[selected]} сообщений</span>
      </div>
      <div className="ag-heatmap">
        <div className="ag-weekday-labels">
          {weekdays.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div
          className="ag-heatmap-grid"
          aria-label="Активность по дням и часам"
          onKeyDown={(event) => {
            const shift =
              event.key === 'ArrowLeft'
                ? -1
                : event.key === 'ArrowRight'
                  ? 1
                  : event.key === 'ArrowUp'
                    ? -24
                    : event.key === 'ArrowDown'
                      ? 24
                      : 0;
            if (shift || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              move(event.key === 'Home' ? 0 : event.key === 'End' ? 167 : selected + shift);
            }
          }}
        >
          {values.map((value, i) => (
            <button
              type="button"
              id={`ag-activity-${i}`}
              key={i}
              tabIndex={selected === i ? 0 : -1}
              className={selected === i ? 'is-selected' : ''}
              style={{
                background: `rgb(${Math.round(31 + (value / max) * 135)}, ${Math.round(31 + (value / max) * 135)}, ${Math.round(31 + (value / max) * 135)})`,
              }}
              aria-label={`${weekdays[Math.floor(i / 24)]}, ${i % 24}:00, ${value} сообщений`}
              aria-pressed={selected === i}
              onPointerEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
            />
          ))}
        </div>
      </div>
      <div className="ag-hour-labels">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      <div className="ag-heatmap-scale">
        <span>Меньше</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} style={{ background: `rgb(${31 + i * 31},${31 + i * 31},${31 + i * 31})` }} />
        ))}
        <span>Больше</span>
      </div>
    </article>
  );
}

const sourceRows = [
  {
    label: 'IT-сообщество',
    platform: 'Telegram',
    value: 146,
    trend: [3, 7, 4, 9, 5, 12, 9, 15, 18, 13, 21, 17],
  },
  {
    label: 'Комментарии к видео',
    platform: 'TikTok',
    value: 118,
    trend: [4, 3, 6, 9, 4, 7, 11, 8, 15, 17, 13, 20],
  },
  {
    label: 'Мой канал',
    platform: 'Telegram',
    value: 82,
    trend: [3, 4, 7, 4, 8, 6, 10, 9, 7, 12, 13, 11],
  },
  {
    label: 'Чат обсуждений',
    platform: 'Telegram',
    value: 61,
    trend: [4, 3, 3, 7, 4, 3, 8, 5, 6, 9, 7, 10],
  },
];
function SourceBars() {
  const [active, setActive] = useState('all');
  const filtered = sourceRows.filter((row) => active === 'all' || row.platform === active);
  return (
    <article className="ag-card ag-sources">
      <div className="ag-card-heading">
        <div>
          <span className="ag-overline">05 / Источники</span>
          <h3>Обсуждения</h3>
        </div>
        <div className="ag-switch-group" aria-label="Источники обсуждений">
          {[
            ['all', 'Все'],
            ['Telegram', 'TG'],
            ['TikTok', 'TT'],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={active === id} onClick={() => setActive(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="ag-source-list">
        {filtered.map((row) => (
          <div key={row.label} className="ag-source-row">
            <div className="ag-source-name">
              <strong>{row.label}</strong>
              <span>{row.platform}</span>
            </div>
            <div className="ag-source-meter" aria-label={`${row.value} обсуждений`}>
              <span style={{ width: `${(row.value / 146) * 100}%` }} />
            </div>
            <div className="ag-spark-bars" aria-hidden="true">
              {row.trend.map((height, i) => (
                <i key={i} style={{ height }} />
              ))}
            </div>
            <strong className="ag-source-value">
              {row.value}
              <ArrowUpRight size={13} aria-hidden="true" />
            </strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function AnalyticsGallery() {
  return (
    <section id="analytics" className="ag-section">
      <div className="ag-section-heading">
        <h2>Графики</h2>
        <span>Демо</span>
      </div>
      <TrendChart />
      <div className="ag-middle-grid">
        <FunnelChart />
        <DonutChart />
      </div>
      <div className="ag-bottom-grid">
        <SourceBars />
        <ActivityHeatmap />
      </div>
    </section>
  );
}
