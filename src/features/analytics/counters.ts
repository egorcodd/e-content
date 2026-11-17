import type { CatalogVideo, TikTokCounters } from './contracts';

export const counterKeys = ['views', 'comments', 'likes', 'shares'] as const;

export function sumCounters(videos: CatalogVideo[]): TikTokCounters {
  const totals: TikTokCounters = {};
  for (const key of counterKeys) {
    let sum = 0;
    let complete = true;
    for (const video of videos) {
      const value = video.counters[key];
      if (value === undefined) {
        complete = false;
        break;
      }
      sum += value;
    }
    if (complete) totals[key] = sum;
  }
  return totals;
}
