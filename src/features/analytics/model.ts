import { metrics, samples, valueAt } from './data';
import type { Metric, Platform, Point } from './chart-model';

export type AnalyticsPeriod = '7' | '30' | '90';
export type AnalyticsSource = 'all' | Platform;
export type AnalyticsFilters = { period: AnalyticsPeriod; source: AnalyticsSource; metric: Metric };
export function getWindow(period: AnalyticsPeriod) {
  const days = Number(period);
  return { points: samples.slice(-days), previous: samples.slice(-days * 2, -days) };
}
export function totalFor(points: Point[], metric: Metric, source: AnalyticsSource) {
  const id = source === 'all' ? 'total' : source;
  return metric === 'followers'
    ? valueAt(points.at(-1)!, id, metric)
    : points.reduce((total, point) => total + valueAt(point, id, metric), 0);
}
export function readFilters(search: string): AnalyticsFilters {
  const params = new URLSearchParams(search);
  const period = params.get('period');
  const source = params.get('source');
  const metric = params.get('metric');
  return {
    period: period === '7' || period === '90' ? period : '30',
    source: source === 'telegram' || source === 'tiktok' ? source : 'all',
    metric: metrics.find((item) => item.id === metric)?.id ?? 'views',
  };
}
export function analyticsCsv({ period, source }: AnalyticsFilters) {
  const { points, previous } = getWindow(period);
  const platforms: Platform[] = source === 'all' ? ['telegram', 'tiktok'] : [source];
  return (
    '\uFEFF' +
    [
      [
        'Дата',
        'Площадка',
        'Подписчики',
        'Просмотры',
        'Комментарии',
        'Реакции / лайки',
        'Репосты',
        'Прирост подписчиков',
      ].join(';'),
      ...points.flatMap((point, index) =>
        platforms.map((platform) =>
          [
            point.date.slice(0, 10),
            platform === 'telegram' ? 'Telegram' : 'TikTok',
            point[platform].followers,
            point[platform].views,
            point[platform].comments,
            point[platform].reactions,
            point[platform].shares,
            point[platform].followers - (points[index - 1] ?? previous.at(-1)!)[platform].followers,
          ].join(';'),
        ),
      ),
    ].join('\r\n')
  );
}

export function audienceGrowth({ period, source }: AnalyticsFilters) {
  const { points, previous } = getWindow(period);
  const baseline = previous.at(-1)!;
  const start = totalFor([baseline], 'followers', source);
  const end = totalFor(points, 'followers', source);
  return {
    start,
    end,
    change: end - start,
    percent: start ? ((end - start) / start) * 100 : null,
    points: points.map((point) => ({
      ...point,
      telegram: {
        ...point.telegram,
        followers: point.telegram.followers - baseline.telegram.followers,
      },
      tiktok: { ...point.tiktok, followers: point.tiktok.followers - baseline.tiktok.followers },
    })),
    days: points.map((point, index) => {
      const before = points[index - 1] ?? baseline;
      return {
        date: point.date,
        telegram: point.telegram.followers - before.telegram.followers,
        tiktok: point.tiktok.followers - before.tiktok.followers,
      };
    }),
  };
}
