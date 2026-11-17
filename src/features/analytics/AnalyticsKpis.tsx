import { AnimatedNumber } from '../../shared/ui';
import { metricLabel, type Metric } from './chart-model';
import { metrics } from './data';
import type { AnalyticsFilters } from './model';

export function AnalyticsKpis({
  filters,
  valueOf,
  onMetric,
}: {
  filters: AnalyticsFilters;
  valueOf: (metric: Metric) => number | undefined;
  onMetric: (metric: Metric) => void;
}) {
  return (
    <div className="ap-kpis" role="group" aria-label="Показатель аналитики">
      {metrics.map(({ id }) => {
        const value = valueOf(id);
        return (
          <button key={id} aria-pressed={filters.metric === id} onClick={() => onMetric(id)}>
            <span>{metricLabel(id, filters.source === 'telegram' ? 'telegram' : 'tiktok')}</span>
            {value === undefined ? (
              <span className="ap-kpi-value">—</span>
            ) : (
              <AnimatedNumber value={value} className="ap-kpi-value" duration={0.5} />
            )}
          </button>
        );
      })}
    </div>
  );
}
