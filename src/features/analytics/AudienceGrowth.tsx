import { AnimatedNumber } from '../../shared/ui';
import { fmt, signedFmt } from './chart-model';
import type { TikTokMeasurement } from './contracts';
import { measurementDate, tiktokSeries } from './data';
import { MetricDelta } from './MetricDelta';
import type { AnalyticsPeriod } from './model';
import { TrendPlot } from './TrendPlot';

export function AudienceGrowth({
  history,
  period,
}: {
  history: TikTokMeasurement[];
  period: AnalyticsPeriod;
}) {
  const points = history.flatMap(({ date, followers }) =>
    followers === undefined ? [] : [{ date, followers }],
  );
  const first = points[0];
  const last = points.at(-1);
  return (
    <section className="ag-card ec-glow ap-growth" aria-labelledby="growth-heading">
      <div className="ap-card-heading">
        <h2 id="growth-heading">Рост аудитории</h2>
        {period !== 'all' && <span>последние {period} дней</span>}
      </div>
      {!first || !last ? (
        <p className="ap-insight-empty">Нет замеров подписчиков за этот период.</p>
      ) : points.length === 1 ? (
        <div className="ap-growth-summary">
          <strong className="ap-growth-change">{fmt(first.followers)}</strong>
          <span className="ap-insight-empty">
            Подписчиков при первом замере · {measurementDate(first.date)}
          </span>
        </div>
      ) : (
        <>
          <div className="ap-growth-summary">
            <strong
              className="ap-growth-change"
              data-growth-change={last.followers - first.followers}
            >
              <AnimatedNumber
                value={last.followers - first.followers}
                format={signedFmt}
                duration={0.5}
                animateOnMount={false}
              />
            </strong>
            {first.followers > 0 && (
              <MetricDelta
                value={((last.followers - first.followers) / first.followers) * 100}
                suffix="за период"
              />
            )}
          </div>
          <p className="ap-growth-range">
            <span title={measurementDate(first.date)}>
              <span className="sr-only">Первый замер </span>
              <AnimatedNumber
                value={first.followers}
                format={fmt}
                duration={0.38}
                animateOnMount={false}
              />
            </span>
            <span className="ap-growth-range-arrow" aria-hidden="true">
              →
            </span>
            <span title={measurementDate(last.date)}>
              <span className="sr-only">Последний замер </span>
              <AnimatedNumber
                value={last.followers}
                format={fmt}
                duration={0.38}
                animateOnMount={false}
              />
            </span>
          </p>
          <TrendPlot
            points={points}
            shown={tiktokSeries}
            metric="followers"
            area
            label="Изменение числа подписчиков"
            formatValue={signedFmt}
            readValue={(point) => point.followers - first.followers}
            observations
            dataTableAvailable={false}
          />
        </>
      )}
    </section>
  );
}
