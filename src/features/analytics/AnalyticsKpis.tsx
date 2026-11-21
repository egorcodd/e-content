import { AnimatedNumber } from '../../shared/ui';
import { metricLabel, signedFmt, type Metric } from './chart-model';
import { metrics } from './data';
import { MetricDelta } from './MetricDelta';
import type { AnalyticsFilters } from './model';

export function AnalyticsKpis({
  filters,
  valueOf,
  compareTo,
  comparisonTitle,
  onMetric,
}: {
  filters: AnalyticsFilters;
  valueOf: (metric: Metric) => number | undefined;
  compareTo?: (metric: Metric) => number | undefined;
  comparisonTitle?: string;
  onMetric: (metric: Metric) => void;
}) {
  return (
    <div className="ap-kpis" role="group" aria-label="Показатель аналитики">
      {metrics.map(({ id }) => {
        const value = valueOf(id);
        const before = compareTo?.(id);
        return (
          <button key={id} aria-pressed={filters.metric === id} onClick={() => onMetric(id)}>
            <span>{metricLabel(id, filters.source === 'telegram' ? 'telegram' : 'tiktok')}</span>
            {value === undefined ? (
              <span className="ap-kpi-value">—</span>
            ) : (
              <AnimatedNumber
                value={value}
                className="ap-kpi-value"
                duration={0.5}
                animateOnMount={false}
                format={filters.period === 'all' ? undefined : signedFmt}
              />
            )}
            {value !== undefined && before !== undefined && before > 0 && (
              <MetricDelta
                value={((value - before) / before) * 100}
                suffix={`к прошлым ${filters.period} дням`}
                title={comparisonTitle}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
