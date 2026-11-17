import { useEffect, useState } from 'react';
import {
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
} from '@phosphor-icons/react';
import { downloadText, Segment } from '../../shared/ui';
import { api } from '../../features/collection/api';
import { AnalyticsTrend } from '../../features/analytics/AnalyticsTrend';
import { AudienceGrowth } from '../../features/analytics/AudienceGrowth';
import { ViewSources } from '../../features/analytics/ViewSources';
import type {
  AnalyticsHistory,
  CatalogVideo,
  TikTokCatalogScan,
} from '../../features/analytics/contracts';
import { fmt } from '../../features/analytics/chart-model';
import { sumCounters } from '../../features/analytics/counters';
import { measurementDate } from '../../features/analytics/data';
import {
  analyticsCsv,
  analyticsPeriods,
  catalogCsv,
  getWindow,
  publicationPoints,
  readFilters,
  type AnalyticsFilters,
} from '../../features/analytics/model';
import './analytics.css';

export default function AnalyticsPage() {
  const [filters, setFilters] = useState(() => readFilters(location.search));
  const [history, setHistory] = useState<AnalyticsHistory>();
  const [data, setData] = useState<{ id: string; videos: CatalogVideo[] }>();
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const telegram = filters.source === 'telegram';
  const catalog = telegram ? undefined : history?.catalog;
  const catalogId = catalog?.id;
  const available = telegram ? [] : (history?.tiktok ?? []);
  const points = getWindow(available, filters.period);
  const videos = getWindow(data && data.id === catalogId ? data.videos : [], filters.period);
  const running = history?.scan?.status === 'running';
  const scan = telegram ? undefined : history?.scan;
  const audience = filters.metric === 'followers';
  const empty = telegram
    ? 'Счётчики Telegram пока не подключены'
    : historyError ||
      catalogError ||
      (!history
        ? 'Читаем статистику'
        : !history.handle
          ? 'Выберите публичный профиль TikTok в «Источниках».'
          : running
            ? 'Собираем счётчики публичных роликов…'
            : audience && available.length
              ? 'За этот период нет замеров подписчиков.'
              : catalog
                ? data?.id === catalogId
                  ? 'За этот период нет публичных роликов.'
                  : 'Читаем статистику роликов'
                : 'Нажмите «Обновить статистику», чтобы собрать данные публичных роликов.');

  useEffect(() => {
    const onBack = () => setFilters(readFilters(location.search));
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  useEffect(() => {
    let closed = false;
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const result = await api<AnalyticsHistory>('/analytics/history');
        if (!closed) {
          setHistory(result);
          setHistoryError('');
        }
      } catch (error) {
        if (!closed)
          setHistoryError(
            error instanceof Error ? error.message : 'Не удалось прочитать статистику.',
          );
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      closed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    setCatalogError('');
    if (!catalogId) return;
    let closed = false;
    void api<{ videos: CatalogVideo[] }>(
      `/analytics/tiktok/catalog?id=${encodeURIComponent(catalogId)}`,
    )
      .then((result) => {
        if (!closed) setData({ id: catalogId, videos: result.videos });
      })
      .catch((error) => {
        if (!closed)
          setCatalogError(error instanceof Error ? error.message : 'Не удалось прочитать каталог.');
      });
    return () => {
      closed = true;
    };
  }, [catalogId]);

  async function refreshCatalog() {
    setRequestError('');
    setStarting(true);
    try {
      const result = await api<{ scan: TikTokCatalogScan }>('/analytics/tiktok/scans', 'POST', {});
      setHistory((current) => (current ? { ...current, scan: result.scan } : undefined));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Не удалось запустить сбор.');
    } finally {
      setStarting(false);
    }
  }
  function update(next: Partial<AnalyticsFilters>) {
    const value = { ...filters, ...next };
    const url = new URL(location.href);
    url.searchParams.delete('view');
    for (const [key, item] of Object.entries(value)) url.searchParams.set(key, item);
    window.history.replaceState(null, '', url);
    setFilters(value);
  }
  return (
    <div className="analytics-page">
      <header className="ap-page-heading">
        <div>
          <h1>Аналитика</h1>
          {!telegram && history?.handle && (
            <span>
              {catalog
                ? `Последний замер TikTok · ${measurementDate(catalog.finishedAt!)}`
                : `@${history.handle}`}
            </span>
          )}
        </div>
        <div className="ap-heading-actions">
          {!telegram && (
            <button
              className="ec-button ap-export ap-refresh"
              aria-label="Обновить статистику"
              title="Обновить статистику TikTok"
              disabled={starting || running || !history?.handle}
              onClick={() => void refreshCatalog()}
            >
              <ArrowClockwiseIcon size={18} />
            </button>
          )}
          <button
            className="ec-button ap-export"
            aria-label="Скачать CSV"
            disabled={audience ? !points.length : !videos.length}
            onClick={() =>
              downloadText(
                `e-content-tiktok-${audience ? 'history' : 'publications'}-${filters.period}.csv`,
                audience ? analyticsCsv(points) : catalogCsv(videos),
                'text/csv;charset=utf-8',
              )
            }
          >
            <DownloadSimpleIcon size={18} />
            <span>Скачать CSV</span>
          </button>
        </div>
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
          values={analyticsPeriods}
        />
      </div>
      {scan?.status === 'running' && (
        <p className="ap-scan-message" role="status">
          Собираем весь публичный каталог TikTok · найдено {fmt(scan.videos)}
          {scan.expectedVideos !== undefined && scan.expectedVideos > scan.videos
            ? ` из ${fmt(scan.expectedVideos)}`
            : ''}
        </p>
      )}
      {!telegram && (requestError || scan?.error) && (
        <p className="ap-scan-message is-error" role="status">
          {requestError || scan?.error}
          {!requestError &&
            scan?.status === 'partial' &&
            ` Получено ${fmt(scan.videos)} роликов${scan.expectedVideos === undefined ? '' : ` из ${fmt(scan.expectedVideos)}`}.`}
        </p>
      )}
      <AnalyticsTrend
        filters={filters}
        publications={publicationPoints(videos)}
        totals={videos.length ? sumCounters(videos) : {}}
        followers={catalog?.followers}
        history={points}
        emptyLabel={empty}
        onMetric={(metric) => update({ metric })}
      />
      <div className="ap-insights">
        <AudienceGrowth history={points} period={filters.period} />
        <ViewSources source={filters.source} />
      </div>
    </div>
  );
}
