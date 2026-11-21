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
import { VideoGrowth } from '../../features/analytics/VideoGrowth';
import type {
  AnalyticsHistory,
  CatalogVideo,
  TikTokCatalogScan,
} from '../../features/analytics/contracts';
import { fmt } from '../../features/analytics/chart-model';
import { measurementDate, shortMeasurementDate } from '../../features/analytics/data';
import {
  accountWindow,
  analyticsCsv,
  analyticsPeriods,
  catalogCsv,
  getWindow,
  periodGrowth,
  previousPeriod,
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
  const points = accountWindow(available, filters.period);
  const channels = getWindow(history?.telegram ?? [], filters.period);
  const videos = data && data.id === catalogId ? data.videos : [];
  const lifetime = filters.period === 'all';
  const displayed = lifetime ? points : periodGrowth(points);
  const comparison = previousPeriod(available, points, filters.period);
  const running = history?.scan?.status === 'running';
  const scan = telegram ? undefined : history?.scan;
  const refreshing = starting || running;
  const refreshError = refreshing ? '' : requestError || scan?.error;
  const lastUpdate = catalog?.finishedAt;
  const audience = filters.metric === 'followers';
  const exportCatalog = lifetime && !audience;
  const empty = telegram
    ? 'Счётчики Telegram пока не подключены'
    : historyError ||
      (!history
        ? 'Читаем статистику'
        : !history.handle
          ? 'Выберите публичный профиль TikTok в «Источниках».'
          : running
            ? 'Собираем счётчики публичных роликов…'
            : points.length === 1
              ? 'Есть один замер. Прирост появится после следующего.'
              : available.length ? 'За выбранный период нет замеров.'
                : 'Для статистики аккаунта нужен полный замер.');

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
        <h1>Аналитика</h1>
        <div className="ap-heading-actions">
          {!telegram && (
            <button
              className="ec-button ap-export ap-refresh"
              aria-label="Обновить статистику"
              aria-busy={refreshing}
              title={refreshError || (lastUpdate
                ? `Последнее обновление TikTok · ${measurementDate(lastUpdate)} МСК`
                : 'Обновить статистику TikTok')}
              disabled={refreshing || !history?.handle}
              onClick={() => void refreshCatalog()}
            >
              <ArrowClockwiseIcon size={18} aria-hidden="true" />
              <span className="ap-refresh-copy">
                <span>{refreshing ? 'Обновляем…' : 'Обновить'}</span>
                <span className="ap-refresh-detail" data-error={!!refreshError} role="status">
                  {refreshError ? 'Ошибка обновления' : lastUpdate ? (
                    <>Обновлено <time dateTime={lastUpdate}>{shortMeasurementDate(lastUpdate)}</time></>
                  ) : 'Статистика TikTok'}
                </span>
              </span>
            </button>
          )}
          <button
            className="ec-button ap-export ap-download"
            aria-label="Скачать CSV"
            title={catalogError || 'Скачать CSV'}
            disabled={telegram ? !channels.length : exportCatalog ? !videos.length : !displayed.length}
            onClick={() =>
              downloadText(
                `e-content-${telegram ? 'telegram-history' : exportCatalog ? 'tiktok-publications' : lifetime ? 'tiktok-history' : 'tiktok-growth'}-${filters.period}.csv`,
                telegram ? '\uFEFF' + ['Время сбора (UTC);Канал;Подписчики;Публикации;Просмотры;Комментарии;Реакции;Пересылки',
                  ...channels.map(r => [r.date,r.url,r.subscribers,r.posts,r.views,r.comments,r.reactions,r.forwards].join(';'))].join('\r\n')
                  : exportCatalog ? catalogCsv(videos) : analyticsCsv(displayed, !lifetime),
                'text/csv;charset=utf-8',
              )
            }
          >
            <DownloadSimpleIcon size={18} aria-hidden="true" />
            <span><span className="ap-download-label">Скачать </span>CSV</span>
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
      {filters.source !== 'tiktok' && (telegram || !!history?.telegram?.length) && (
        <section className="ap-scan-message ap-channel-history" aria-label="Статистика Telegram">
          <h3>Telegram · замеры своих каналов</h3>
          {!channels.length ? <p>{historyError || 'За этот период нет замеров своих каналов.'}</p> :
            <table><thead><tr>{['Замер','Канал','Подписчики','Публикации','Просмотры','Комментарии','Реакции','Пересылки'].map(t => <th key={t}>{t}</th>)}</tr></thead>
              <tbody>{channels.slice().reverse().map(row => <tr key={row.date+row.sourceId}>
                <td>{measurementDate(row.date)}</td><td><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a></td>
                {[row.subscribers,row.posts,row.views,row.comments,row.reactions,row.forwards].map((v,i) => <td key={i}>{v === undefined ? '—' : fmt(v)}</td>)}
              </tr>)}</tbody></table>}
        </section>
      )}
      {!telegram && <><AnalyticsTrend
        filters={filters}
        points={displayed}
        previous={comparison}
        coverageChanged={!lifetime && points.slice(1).some(point => point.change?.coverageChanged)}
        emptyLabel={empty}
        onMetric={(metric) => update({ metric })}
      />
      <div className="ap-insights">
        <AudienceGrowth history={points} period={filters.period} />
        <VideoGrowth key={history?.handle} points={points} />
      </div></>}
    </div>
  );
}
