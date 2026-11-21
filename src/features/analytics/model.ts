import { metrics } from './data';
import type { Metric, Platform } from './chart-model';
import type { CatalogVideo, TikTokMeasurement } from './contracts';
import { counterKeys } from './counters';

export type AnalyticsPeriod = '7' | '30' | 'all';
export const analyticsPeriods: { id: AnalyticsPeriod; label: string }[] = [
  { id: '7', label: '7 дней' },
  { id: '30', label: '30 дней' },
  { id: 'all', label: 'За всё время' },
];
export type AnalyticsSource = 'all' | Platform;
export type AnalyticsFilters = {
  period: AnalyticsPeriod;
  source: AnalyticsSource;
  metric: Metric;
};

export function getWindow<T extends { date: string }>(
  history: T[],
  period: AnalyticsPeriod,
  now = Date.now(),
) {
  if (period === 'all') return history;
  const today = new Date(now + 3 * 3600000).toISOString().slice(0, 10);
  const since = Date.parse(today + 'T00:00:00+03:00') - (Number(period) - 1) * 86400000;
  return history.filter((point) => Date.parse(point.date) >= since);
}

export function metricValue(point: TikTokMeasurement, metric: Metric) {
  if (metric === 'followers') return point.followers;
  return point.counters[metric === 'reactions' ? 'likes' : metric];
}

export function accountWindow(history: TikTokMeasurement[], period: AnalyticsPeriod) {
  const last = history.at(-1);
  if (!last || period === 'all') return history;
  const since = Date.parse(last.date) - Number(period) * 86400000;
  return history.filter(point => Date.parse(point.date) >= since);
}

// Only attribute intervals whose two endpoints were actually measured in the window.
export function periodGrowth(points: TikTokMeasurement[]): TikTokMeasurement[] {
  if (points.length < 2) return [];
  const first = points[0];
  let totals: TikTokMeasurement['counters'] = {};
  for (const key of counterKeys) {
    if (first.counters[key] !== undefined) totals[key] = 0;
  }
  return points.map((point, index) => {
    if (index > 0) {
      const next: typeof totals = {};
      for (const key of counterKeys) {
        const change = point.change?.counters[key];
        const prior = totals[key];
        if (prior !== undefined && change !== undefined) next[key] = prior + change;
      }
      totals = next;
    }
    return { ...point, counters: totals, followers: point.followers === undefined || first.followers === undefined
      ? undefined : point.followers - first.followers };
  });
}

export function previousPeriod(
  history: TikTokMeasurement[],
  current: TikTokMeasurement[],
  period: AnalyticsPeriod,
) {
  if (period === 'all' || current.length < 2) return [];
  const first = Date.parse(current[0].date);
  const duration = Date.parse(current.at(-1)!.date) - first;
  const day = 86400000;
  // Daily observations can fall just after the requested boundary.
  if (duration < (Number(period) - 1) * day) return [];
  const previous = accountWindow(history.filter((point) => Date.parse(point.date) <= first), period);
  if (previous.length < 2) return [];
  const previousDuration = first - Date.parse(previous[0].date);
  if (previousDuration < (Number(period) - 1) * day || Math.abs(previousDuration - duration) > day / 2)
    return [];
  return periodGrowth(previous);
}

export function readFilters(search: string): AnalyticsFilters {
  const params = new URLSearchParams(search);
  const period = params.get('period');
  const source = params.get('source');
  const metric = metrics.find((item) => item.id === params.get('metric'))?.id ?? 'views';
  return {
    period: period === '7' || period === '30' ? period : 'all',
    source: source === 'telegram' || source === 'tiktok' ? source : 'all',
    metric,
  };
}

export function catalogCsv(videos: CatalogVideo[]) {
  return (
    '\uFEFF' +
    [
      'Дата публикации (UTC);Название;Просмотры;Комментарии;Лайки;Репосты;Ссылка',
      ...videos.map(({ date, title, counters, url }) => {
        const safeTitle = /^[\s]*[=+@-]|^[\t\r\n]/u.test(title) ? "'" + title : title;
        return [
          date,
          '"' + safeTitle.replaceAll('"', '""') + '"',
          counters.views,
          counters.comments,
          counters.likes,
          counters.shares,
          url,
        ].join(';');
      }),
    ].join('\r\n')
  );
}

export function analyticsCsv(points: TikTokMeasurement[], growth = false) {
  return (
    '\uFEFF' +
    [
      ['Время сбора (UTC)', 'Площадка', 'Ролики со счётчиками',
        ...['Подписчики','Просмотры','Комментарии','Лайки','Репосты'].map(name =>
          growth ? name + ' (изменение с первого замера периода)' : name)].join(';'),
      ...points.map(({ date, videos, counters, followers }) =>
        [
          date,
          'TikTok',
          videos,
          followers,
          counters.views,
          counters.comments,
          counters.likes,
          counters.shares,
        ].join(';'),
      ),
    ].join('\r\n')
  );
}
