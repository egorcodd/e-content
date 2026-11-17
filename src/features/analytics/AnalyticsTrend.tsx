import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { TrendPlot } from './TrendPlot';
import { Segment } from '../../shared/ui';
import { fmt, metricLabel, signedFmt, type Metric } from './chart-model';
import { measurementDate, publicationDate, tiktokSeries } from './data';
import { AnalyticsKpis } from './AnalyticsKpis';
import { metricValue, type AnalyticsFilters } from './model';
import type { TikTokCounters, TikTokMeasurement } from './contracts';

export function AnalyticsTrend({
  filters,
  publications,
  totals,
  history,
  followers,
  emptyLabel,
  onMetric,
}: {
  filters: AnalyticsFilters;
  publications: TikTokMeasurement[];
  totals: TikTokCounters;
  history: TikTokMeasurement[];
  followers?: number;
  emptyLabel: string;
  onMetric: (metric: Metric) => void;
}) {
  const [style, setStyle] = useState('area');
  const [table, setTable] = useState(false);
  const reduced = useReducedMotion();
  const audience = filters.metric === 'followers';
  const source = audience ? history : publications;
  const selectMetric = (point: TikTokMeasurement) => {
    const value = metricValue(point, filters.metric);
    return value === undefined ? [] : [{ ...point, value }];
  };
  const points = source.flatMap(selectMetric);
  const measurements = audience ? [] : history.flatMap(selectMetric);
  const label = metricLabel(filters.metric, 'tiktok');
  const singleMeasurement = audience && points.length === 1;
  return (
    <section className="ap-trend ag-card ec-glow" aria-label="Показатели TikTok">
      <AnalyticsKpis
        filters={filters}
        onMetric={onMetric}
        valueOf={(metric) =>
          metric === 'followers' ? followers : totals[metric === 'reactions' ? 'likes' : metric]
        }
      />
      <div className="ap-trend-body">
        {points.length > 0 && (
          <div className="ag-chart-toolbar">
            <div className="ag-chart-legend">
              <span className="ag-swatch ap-tiktok-swatch" />
              <span>TikTok</span>
              <span className="ap-chart-scope">
                {audience ? 'Замеры подписчиков' : 'Накопленные счётчики по датам публикаций'}
              </span>
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
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={!points.length ? 'empty' : table ? 'table' : singleMeasurement ? 'first' : 'plot'}
            initial={reduced ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
          >
            {!points.length ? (
              <div className="ag-chart-empty" role="status">
                {source.length ? 'За этот период показателя нет' : emptyLabel}
              </div>
            ) : table ? (
              <div className="ag-data-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{audience ? 'Время замера' : 'Дата публикации'}</th>
                      {!audience && <th>Ролики</th>}
                      <th>{label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.id}>
                        <td>
                          {audience ? measurementDate(point.date) : publicationDate(point.date)}
                        </td>
                        {!audience && <td>{fmt(point.videos)}</td>}
                        <td>{fmt(point.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {measurements.length > 1 && (
                  <details className="ap-measurement-details">
                    <summary>Замеры счётчиков</summary>
                    <table>
                      <thead>
                        <tr>
                          <th>Время замера</th>
                          <th>{label}</th>
                          <th>К прошлому замеру</th>
                        </tr>
                      </thead>
                      <tbody>
                        {measurements.map((point, index) => (
                          <tr key={point.id}>
                            <td>{measurementDate(point.date)}</td>
                            <td>{fmt(point.value)}</td>
                            <td>
                              {index ? signedFmt(point.value - measurements[index - 1].value) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            ) : singleMeasurement ? (
              <div className="ag-chart-empty" role="status">
                График подписчиков появится после второго замера.
              </div>
            ) : (
              <TrendPlot
                key={`${filters.period}-${filters.source}-${filters.metric}`}
                points={points}
                metric={filters.metric}
                label={audience ? label : `${label} по датам публикаций`}
                shown={tiktokSeries}
                area={style === 'area'}
                readValue={(point) => point.value}
                observations={audience}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
