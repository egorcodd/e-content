import { AnimatedNumber } from '../../shared/ui';
import { fmt, signedFmt } from './chart-model';
import type { TikTokMeasurement } from './contracts';
import { tiktokSeries } from './data';
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
        <span>{period === 'all' ? 'за всё время' : `за ${period} дней`}</span>
      </div>
      {!first || !last ? (
        <p className="ap-insight-empty">Нет замеров подписчиков за этот период.</p>
      ) : points.length === 1 ? (
        <div className="ap-growth-summary">
          <strong className="ap-growth-change">{fmt(first.followers)}</strong>
          <span className="ap-insight-empty">Для графика роста нужен второй сбор.</span>
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
              />
            </strong>
            {first.followers > 0 && (
              <MetricDelta
                value={((last.followers - first.followers) / first.followers) * 100}
                suffix="за период"
              />
            )}
          </div>
          <dl className="ap-growth-range">
            <div>
              <dt>Первый замер</dt>
              <dd>{fmt(first.followers)}</dd>
            </div>
            <div>
              <dt>Последний замер</dt>
              <dd>{fmt(last.followers)}</dd>
            </div>
          </dl>
          <TrendPlot
            key={period}
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
