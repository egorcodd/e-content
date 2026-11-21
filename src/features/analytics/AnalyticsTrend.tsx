import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { TrendPlot } from './TrendPlot';
import { AnimatedNumber, Segment } from '../../shared/ui';
import { fmt, metricLabel, signedFmt, type Metric } from './chart-model';
import { measurementDate, measurementRange, tiktokSeries } from './data';
import { AnalyticsKpis } from './AnalyticsKpis';
import { metricValue, type AnalyticsFilters } from './model';
import type { TikTokMeasurement } from './contracts';

export function AnalyticsTrend({
  filters,
  points: samples,
  previous,
  coverageChanged,
  emptyLabel,
  onMetric,
}: {
  filters: AnalyticsFilters;
  points: TikTokMeasurement[];
  previous: TikTokMeasurement[];
  coverageChanged: boolean;
  emptyLabel: string;
  onMetric: (metric: Metric) => void;
}) {
  const [style, setStyle] = useState('area');
  const [table, setTable] = useState(false);
  const reduced = useReducedMotion();
  const lifetime = filters.period === 'all';
  const last = samples.at(-1);
  const baseline = previous.at(-1);
  const points = samples.flatMap((point) => {
    const value = metricValue(point, filters.metric);
    return value === undefined ? [] : [{ ...point, value }];
  });
  const label = metricLabel(filters.metric, 'tiktok');
  const scope = lifetime ? 'Счётчики аккаунта' : 'Изменение по замерам';
  const format = lifetime ? fmt : signedFmt;
  const singleMeasurement = points.length === 1;
  return (
    <section className="ap-trend ag-card ec-glow" aria-label="Показатели TikTok">
      <AnalyticsKpis
        filters={filters}
        onMetric={onMetric}
        valueOf={(metric) => last && metricValue(last, metric)}
        compareTo={baseline && ((metric) => metricValue(baseline, metric))}
        comparisonTitle={
          baseline && `${measurementDate(previous[0].date)} — ${measurementDate(baseline.date)}`
        }
      />
      <div className="ap-trend-body">
        {points.length > 0 && (
          <div className="ag-chart-toolbar">
            <div className="ag-chart-legend">
              <span className="ag-swatch ap-tiktok-swatch" />
              <span>TikTok</span>
              {!lifetime && last && samples.length > 1 ? (
                <span
                  className="ap-chart-scope ap-measured-range"
                  title={
                    coverageChanged ? 'По сопоставимым роликам и новым публикациям' : undefined
                  }
                >
                  <span className="sr-only">Период по замерам </span>
                  {measurementRange(samples[0].date, last.date)}
                </span>
              ) : (
                <span className="ap-chart-scope">{scope}</span>
              )}
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
                {samples.length ? 'Для этого показателя недостаточно данных.' : emptyLabel}
              </div>
            ) : table ? (
              <div className="ag-data-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Время замера</th>
                      <th>Ролики</th>
                      <th>{lifetime ? label : label + ' · изменение'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.id}>
                        <td>{measurementDate(point.date)}</td>
                        <td>{fmt(point.videos)}</td>
                        <td>
                          <AnimatedNumber
                            value={point.value}
                            format={format}
                            duration={0.38}
                            animateOnMount={false}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : singleMeasurement ? (
              <div className="ag-chart-empty" role="status">
                {lifetime
                  ? 'История началась с первого замера. График появится после второго.'
                  : 'Для графика нужны два сопоставимых замера.'}
              </div>
            ) : (
              <TrendPlot
                points={points}
                metric={filters.metric}
                label={label + ' · ' + scope}
                shown={tiktokSeries}
                area={style === 'area'}
                readValue={(point) => point.value}
                observations
                formatValue={format}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
