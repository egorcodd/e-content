import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { TrendPlot } from './TrendPlot';
import { MetricDelta } from './MetricDelta';
import { AnimatedNumber, Segment } from '../../shared/ui';
import { compact, day, fmt, metricLabel, type SeriesId } from './chart-model';
import { metrics, series, valueAt } from './data';
import { getWindow, totalFor, type AnalyticsFilters } from './model';

export function AnalyticsTrend({
  filters,
  onMetric,
}: {
  filters: AnalyticsFilters;
  onMetric: (metric: AnalyticsFilters['metric']) => void;
}) {
  const [style, setStyle] = useState('area');
  const [hidden, setHidden] = useState<SeriesId[]>(['total']);
  const [table, setTable] = useState(false);
  const reduced = useReducedMotion();
  const { points, previous } = getWindow(filters.period);
  const available = series.filter((item) => filters.source === 'all' || item.id === filters.source);
  const shown = available.filter((item) => !hidden.includes(item.id));
  return (
    <section className="ap-trend ag-card ec-glow" aria-label="Динамика показателей">
      <div className="ap-kpis" role="group" aria-label="Показатель аналитики">
        {metrics.map((metric) => {
          const now = totalFor(points, metric.id, filters.source);
          const before = totalFor(previous, metric.id, filters.source);
          return (
            <button
              key={metric.id}
              aria-pressed={filters.metric === metric.id}
              onClick={() => onMetric(metric.id)}
            >
              <span
                title={
                  metric.id === 'followers' && filters.source === 'all'
                    ? 'Сумма подписок на площадках. Один человек может подписываться на обе.'
                    : undefined
                }
              >
                {metricLabel(metric.id, filters.source)}
              </span>
              <AnimatedNumber value={now} className="ap-kpi-value" duration={0.5} />
              <MetricDelta
                value={before ? ((now - before) / before) * 100 : 0}
                suffix={`к прошлым ${filters.period} дням`}
              />
            </button>
          );
        })}
      </div>
      <div className="ap-trend-body">
        <div className="ag-chart-toolbar">
          <div className="ag-chart-legend" role="group" aria-label="Ряды графика">
            {available.map((item) => (
              <button
                key={item.id}
                aria-pressed={!hidden.includes(item.id)}
                onClick={() =>
                  setHidden((old) =>
                    old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id],
                  )
                }
              >
                <span
                  className={`ag-swatch ${item.dash ? 'is-dashed' : ''}`}
                  style={{ '--c': item.color } as CSSProperties}
                />
                {item.label}
                <strong>{compact(valueAt(points.at(-1)!, item.id, filters.metric))}</strong>
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
              className="ag-table-toggle"
              aria-pressed={table}
              onClick={() => setTable(!table)}
            >
              {table ? 'График' : 'Данные'}
            </button>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={table ? 'table' : shown.length ? 'plot' : 'empty'}
            initial={reduced ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
          >
            {table ? (
              <div className="ag-data-scroll">
                <table>
                  <caption className="sr-only">
                    {metricLabel(filters.metric, filters.source)} по дням
                  </caption>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      {available.map((item) => (
                        <th key={item.id}>{item.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.date}>
                        <td>{day(point.date)}</td>
                        {available.map((item) => (
                          <td key={item.id}>{fmt(valueAt(point, item.id, filters.metric))}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : shown.length ? (
              <TrendPlot
                key={`${filters.period}-${filters.source}`}
                points={points}
                metric={filters.metric}
                shown={shown}
                area={style === 'area'}
              />
            ) : (
              <div className="ag-chart-empty">Выберите ряд на легенде</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
