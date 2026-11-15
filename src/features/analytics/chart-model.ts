export type Metric = 'followers' | 'views' | 'comments' | 'reactions' | 'shares';
export type Platform = 'telegram' | 'tiktok';
export type SeriesId = Platform | 'total';
export type Point = {
  date: string;
  telegram: Record<Metric, number>;
  tiktok: Record<Metric, number>;
};
export const ease = [0.16, 1, 0.3, 1] as const;
export const fmt = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.round(value));
export const compact = (value: number) =>
  new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const percent = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
export const day = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
export const fullDay = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
export const platformColor: Record<Platform, string> = {
  telegram: 'var(--tg)',
  tiktok: 'var(--tt)',
};
export const platformLabel: Record<Platform, string> = { telegram: 'Telegram', tiktok: 'TikTok' };
export const metricLabel = (metric: Metric, source: Platform | 'all' = 'all') => {
  if (metric === 'reactions') {
    return source === 'telegram' ? 'Реакции' : source === 'tiktok' ? 'Лайки' : 'Реакции и лайки';
  }
  return {
    followers: 'Подписчики',
    views: 'Просмотры',
    comments: 'Комментарии',
    shares: 'Репосты',
  }[metric];
};
export const signedFmt = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;
