import { AnimatedNumber } from '../../shared/ui';
import { fmt, signedFmt } from './chart-model';
import { series } from './data';
import { MetricDelta } from './MetricDelta';
import { audienceGrowth, type AnalyticsFilters } from './model';
import { TrendPlot } from './TrendPlot';

export function AudienceGrowth({ filters }: { filters: AnalyticsFilters }) {
  const { start, end, change, percent, points } = audienceGrowth(filters);
  const shown = series.filter(
    (item) => item.id !== 'total' && (filters.source === 'all' || item.id === filters.source),
  );
  return (
    <section className="ag-card ec-glow ap-growth" aria-labelledby="growth-heading">
      <div className="ap-card-heading">
        <h2 id="growth-heading">Рост аудитории</h2>
        <span>за {filters.period} дней</span>
      </div>
      <div className="ap-growth-summary">
        <strong className="ap-growth-change" data-growth-change={change}>
          {change > 0 && <span>+</span>}
          <AnimatedNumber value={change} duration={0.5} />
        </strong>
        {percent !== null && <MetricDelta value={percent} suffix="за период" />}
      </div>
      <dl className="ap-growth-range">
        <div>
          <dt>На начало</dt>
          <dd data-growth-start={start}>{fmt(start)}</dd>
        </div>
        <div>
          <dt>На конец</dt>
          <dd data-growth-end={end}>{fmt(end)}</dd>
        </div>
      </dl>
      <div className="ap-growth-legend">
        {shown.map((item) => (
          <span key={item.id}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        <span className="ap-growth-caption">Прирост с начала периода</span>
      </div>
      <TrendPlot
        key={`${filters.source}-${filters.period}`}
        points={points}
        shown={shown}
        metric="followers"
        area
        label="Прирост подписчиков с начала периода"
        formatValue={signedFmt}
        dataTableAvailable={false}
      />
    </section>
  );
}
