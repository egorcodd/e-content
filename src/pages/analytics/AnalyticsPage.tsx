import { useEffect, useState } from 'react';
import { DownloadSimpleIcon, TelegramLogoIcon, TiktokLogoIcon } from '@phosphor-icons/react';
import { downloadText, Segment } from '../../shared/ui';
import { AnalyticsTrend } from '../../features/analytics/AnalyticsTrend';
import { AudienceGrowth } from '../../features/analytics/AudienceGrowth';
import { ViewSources } from '../../features/analytics/ViewSources';
import {
  analyticsCsv,
  getWindow,
  readFilters,
  type AnalyticsFilters,
} from '../../features/analytics/model';
import { day } from '../../features/analytics/chart-model';
import './analytics.css';

export default function AnalyticsPage() {
  const [filters, setFilters] = useState(() => readFilters(location.search));
  const { points } = getWindow(filters.period);
  useEffect(() => {
    const onBack = () => setFilters(readFilters(location.search));
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  function update(next: Partial<AnalyticsFilters>) {
    const value = { ...filters, ...next };
    const url = new URL(location.href);
    for (const [key, item] of Object.entries(value)) url.searchParams.set(key, item);
    history.replaceState(null, '', url);
    setFilters(value);
  }
  return (
    <div className="analytics-page">
      <header className="ap-page-heading">
        <div>
          <h1>Аналитика</h1>
          <span>
            {day(points[0].date)} — {day(points.at(-1)!.date)}{' '}
            {new Date(points.at(-1)!.date).getUTCFullYear()}
          </span>
        </div>
        <button
          className="ec-button ap-export"
          aria-label="Скачать CSV"
          onClick={() =>
            downloadText(
              `e-content-analytics-${filters.period}d-${filters.source}.csv`,
              analyticsCsv(filters),
              'text/csv;charset=utf-8',
            )
          }
        >
          <DownloadSimpleIcon size={18} />
          <span>Скачать CSV</span>
        </button>
      </header>
      <div className="ap-filters">
        <Segment
          label="Площадка аналитики"
          value={filters.source}
          onChange={(source) => update({ source: source as AnalyticsFilters['source'] })}
          values={[
            { id: 'all', label: 'Все площадки' },
            { id: 'telegram', label: 'Telegram', icon: <TelegramLogoIcon size={18} /> },
            { id: 'tiktok', label: 'TikTok', icon: <TiktokLogoIcon size={18} /> },
          ]}
        />
        <Segment
          label="Период аналитики"
          value={filters.period}
          onChange={(period) => update({ period: period as AnalyticsFilters['period'] })}
          values={[
            { id: '7', label: '7 дней' },
            { id: '30', label: '30 дней' },
            { id: '90', label: '90 дней' },
          ]}
        />
      </div>
      <AnalyticsTrend filters={filters} onMetric={(metric) => update({ metric })} />
      <div className="ap-insights">
        <AudienceGrowth filters={filters} />
        <ViewSources filters={filters} />
      </div>
    </div>
  );
}
