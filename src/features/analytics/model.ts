import { metrics } from './data';
import type { Metric, Platform } from './chart-model';
import type { CatalogVideo, TikTokMeasurement } from './contracts';
import { sumCounters } from './counters';

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

export function publicationPoints(videos: CatalogVideo[]): TikTokMeasurement[] {
  const byDate = new Map<string, CatalogVideo[]>();
  for (const video of videos) {
    const date = new Date(Date.parse(video.date) + 3 * 3600000).toISOString().slice(0, 10);
    const existing = byDate.get(date);
    if (existing) existing.push(video);
    else byDate.set(date, [video]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, group]) => ({
      id,
      date: id + 'T00:00:00+03:00',
      videos: group.length,
      counters: sumCounters(group),
    }));
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

export function analyticsCsv(points: TikTokMeasurement[]) {
  return (
    '\uFEFF' +
    [
      'Время сбора (UTC);Площадка;Ролики со счётчиками;Подписчики;Просмотры;Комментарии;Лайки;Репосты',
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
