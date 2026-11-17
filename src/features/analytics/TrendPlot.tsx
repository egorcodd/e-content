import { useId, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { compact, day, fullDay, fmt, ease, type Metric } from './chart-model';
import { series, metrics } from './data';
import { useChartSize } from './useChartSize';
import './analytics-charts.css';

function smoothPath(points: [number, number][]) {
  if (!points.length) return '';
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const before = points[i - 1] || points[i];
    const from = points[i];
    const to = points[i + 1];
    const after = points[i + 2] || to;
    const dx = (to[0] - from[0]) / 3;
    const bound = (y: number) =>
      Math.max(Math.min(from[1], to[1]), Math.min(Math.max(from[1], to[1]), y));
    path += `C${from[0] + dx},${bound(from[1] + (to[1] - before[1]) / 6)} ${to[0] - dx},${bound(to[1] - (after[1] - from[1]) / 6)} ${to[0]},${to[1]}`;
  }
  return path;
}
/** Round axis steps: 1, 2, 2.5, 5 × 10ⁿ. */
function niceTicks(min: number, max: number, count = 4) {
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const floor = Math.floor(min / step) * step;
  return Array.from({ length: Math.ceil((max - floor) / step) + 1 }, (_, i) => floor + i * step);
}

export function TrendPlot<P extends { date: string }>({
  points,
  shown,
  metric,
  area,
  label,
  formatValue = fmt,
  dataTableAvailable = true,
  readValue: value,
  observations = false,
}: {
  points: P[];
  shown: typeof series;
  metric: Metric;
  area: boolean;
  label?: string;
  formatValue?: (value: number) => string;
  dataTableAvailable?: boolean;
  readValue: (point: P, seriesId: (typeof series)[number]['id']) => number;
  observations?: boolean;
}) {
  const gradientId = useId();
  const [ref, { width, height }] = useChartSize<HTMLDivElement>();
  const seen = useInView(ref, { once: true, margin: '-80px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const left = 46;
  const right = 6;
  const top = 10;
  let max = 1;
  let min = 0;
  for (const point of points) {
    for (const item of shown) {
      max = Math.max(max, value(point, item.id));
      min = Math.min(min, value(point, item.id));
    }
  }
  const ticks = niceTicks(min * 1.05, max * 1.05);
  const ceiling = ticks.at(-1)!;
  const floor = ticks[0];
  const plotWidth = Math.max(1, width - left - right);
  const firstTime = Date.parse(points[0].date);
  const duration = Date.parse(points.at(-1)!.date) - firstTime;
  const x = (i: number) =>
    left + (duration ? (Date.parse(points[i].date) - firstTime) / duration : 0.5) * plotWidth;
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
  const shortDate = (date: string) =>
    observations && duration < 86400000 ? time.format(new Date(date)) : day(date);
  const y = (value: number) => top + ((ceiling - value) / (ceiling - floor)) * (height - top - 1);
  const lines = shown.map((item) => ({
    ...item,
    d: smoothPath(points.map((point, i) => [x(i), y(value(point, item.id))])),
  }));
  const current = active == null ? null : points[active];
  const cursor = active == null ? 0 : x(active);
  const tickCount = width < 420 ? 2 : 4;
  const step = Math.ceil((points.length - 1) / tickCount);
  const labels = Array.from({ length: tickCount }, (_, index) => index * step)
    .filter((i) => i < points.length - 1 - step / 2)
    .concat(points.length - 1);
  const distinctLabels = labels.filter(
    (index, i) => i === labels.length - 1 || x(labels[i + 1]) - x(index) > 65,
  );
  const draw = { duration: reduced ? 0 : 1.4, ease };
  const glide = reduced
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 700, damping: 50, mass: 0.6 } as const);
  const containedTooltip = width < 420;
  const tooltipWidth = Math.min(210, width);
  const tooltipX = containedTooltip
    ? Math.max(0, Math.min(width - tooltipWidth, cursor + 14))
    : cursor;
  function pick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - left) / plotWidth;
    const target = left + ratio * plotWidth;
    let nearest = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(x(index) - target) < Math.abs(x(nearest) - target)) nearest = index;
    }
    setActive(nearest);
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
            aria-label={`${label ?? metrics.find((m) => m.id === metric)!.label}. ${observations ? 'Стрелки выбирают сбор.' : 'Стрелки выбирают день.'}${dataTableAvailable ? ' Все значения по кнопке «Данные».' : ''}`}
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
                <linearGradient
                  key={item.id}
                  id={`${gradientId}-area-${item.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
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
                  {area && points.length > 1 && line.id !== 'total' && (
                    <motion.path
                      fill={`url(#${gradientId}-area-${line.id})`}
                      initial={{
                        opacity: 0,
                        d: `${line.d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`,
                      }}
                      animate={{
                        opacity: seen ? 1 : 0,
                        d: `${line.d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`,
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
                  {points.length === 1 && (
                    <circle
                      cx={x(0)}
                      cy={y(value(points[0], line.id))}
                      r={4}
                      style={{ fill: line.color }}
                      className="ag-observation-dot"
                    />
                  )}
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
                    y2={height}
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
                      initial={{ cx: cursor, cy: y(value(current, item.id)) }}
                      animate={{ cx: cursor, cy: y(value(current, item.id)) }}
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
              className={`ag-tooltip ${containedTooltip ? 'is-contained' : cursor > width / 2 ? 'is-left' : ''}`}
              style={containedTooltip ? { width: tooltipWidth } : undefined}
              role="status"
              initial={{ opacity: 0, scale: 0.96, x: tooltipX }}
              animate={{ opacity: 1, scale: 1, x: tooltipX }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ x: glide, opacity: { duration: 0.15 }, scale: { duration: 0.2 } }}
            >
              <strong>
                {fullDay(current.date)}
                {observations && ` · ${time.format(new Date(current.date))}`}
              </strong>
              {shown.map((item) => (
                <span key={item.id}>
                  <i style={{ background: item.color }} className={item.dash ? 'is-dashed' : ''} />
                  {item.label}
                  <b>{formatValue(value(current, item.id))}</b>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="ag-x-axis" aria-hidden="true">
        {distinctLabels.map((index) => (
          <span
            key={index}
            style={{
              left: x(index),
              opacity: current && Math.abs(x(index) - cursor) < 64 ? 0 : 1,
            }}
            className={
              points.length === 1
                ? ''
                : index === 0
                  ? 'is-first'
                  : index === points.length - 1
                    ? 'is-last'
                    : ''
            }
          >
            {shortDate(points[index].date)}
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
              {shortDate(current.date)}
            </motion.b>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
