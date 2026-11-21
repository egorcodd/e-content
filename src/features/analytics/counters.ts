import type { CatalogVideo, TikTokCounters } from './contracts';

export const counterKeys = ['views', 'comments', 'likes', 'shares'] as const;

// A newly visible old video has no baseline. Its lifetime total cannot be
// attributed to this interval, and a missing video is not a loss of views.
export function catalogDifferences(previous: CatalogVideo[], current: CatalogVideo[], from: string) {
  const before = new Map(previous.map((video) => [video.id, video]));
  const baseline = Date.parse(from);
  const changes: CatalogVideo[] = [];
  let coverageChanged = false;
  for (const video of current) {
    const prior = before.get(video.id);
    before.delete(video.id);
    if (!prior && Date.parse(video.date) <= baseline) {
      coverageChanged = true;
      continue;
    }
    const counters: TikTokCounters = {};
    for (const key of counterKeys) {
      const end = video.counters[key];
      const start = prior ? prior.counters[key] : 0;
      if (end !== undefined && start !== undefined) counters[key] = end - start;
    }
    changes.push({ ...video, counters });
  }
  coverageChanged ||= before.size > 0;
  return { changes, coverageChanged };
}

export function catalogChange(previous: CatalogVideo[], current: CatalogVideo[], from: string) {
  const { changes, coverageChanged } = catalogDifferences(previous, current, from);
  return { counters: coverageChanged && !changes.length ? {} : sumCounters(changes), coverageChanged };
}

export const videoGrowthMetrics = ['views', 'shares', 'comments'] as const;

export function accumulateVideoGrowth(totals: Map<string, CatalogVideo>, interval: CatalogVideo[]) {
  for (const video of interval) {
    const previous = totals.get(video.id);
    const counters: TikTokCounters = {};
    for (const metric of videoGrowthMetrics) {
      const before = previous ? previous.counters[metric] : 0;
      const change = video.counters[metric];
      if (before !== undefined && change !== undefined) counters[metric] = before + change;
    }
    totals.set(video.id, { ...video, counters });
  }
}

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
