import { metricLabel, type Point, type SeriesId, type Metric } from './chart-model';
export const series: { id: SeriesId; label: string; color: string; dash?: string }[] = [
  { id: 'telegram', label: 'Telegram', color: 'var(--tg)' },
  { id: 'tiktok', label: 'TikTok', color: 'var(--tt)' },
  { id: 'total', label: 'Вместе', color: '#d4d4d4', dash: '4 5' },
];
export const tiktokSeries = series.filter((item) => item.id === 'tiktok');
const measurementFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
export const measurementDate = (date: string) => measurementFormat.format(new Date(date));
const publicationFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});
export const publicationDate = (date: string) => publicationFormat.format(new Date(date));
export const coreMetrics: { id: Metric; label: string }[] = [
  { id: 'followers', label: 'Подписчики' },
  { id: 'views', label: 'Просмотры' },
  { id: 'comments', label: 'Комментарии' },
];
export const metrics: { id: Metric; label: string }[] = [
  ...coreMetrics,
  { id: 'reactions', label: metricLabel('reactions') },
  { id: 'shares', label: metricLabel('shares') },
];
export const valueAt = (point: Point, id: SeriesId, metric: Metric) =>
  id === 'total' ? point.telegram[metric] + point.tiktok[metric] : point[id][metric];
export const summary = (points: Point[], metric: Metric) =>
  metric === 'followers'
    ? valueAt(points.at(-1)!, 'total', metric)
    : points.reduce((sum, point) => sum + valueAt(point, 'total', metric), 0);
