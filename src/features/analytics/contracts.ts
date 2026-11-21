export type TikTokCounters = {
  views?: number;
  comments?: number;
  likes?: number;
  shares?: number;
};

export type TikTokMeasurement = {
  id: string;
  date: string;
  videos: number;
  counters: TikTokCounters;
  followers?: number;
  change?: { counters: TikTokCounters; coverageChanged: boolean };
};

export type CatalogVideo = {
  id: string;
  date: string;
  url: string;
  title: string;
  counters: TikTokCounters;
};

export type TikTokCatalogScan = {
  id: string;
  status: 'running' | 'complete' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  videos: number;
  expectedVideos?: number;
  followers?: number;
  counters?: TikTokCounters;
  error?: string;
};

export type AnalyticsHistory = {
  telegram?: TelegramMeasurement[];
  tiktok: TikTokMeasurement[];
  handle?: string;
  scan?: TikTokCatalogScan;
  catalog?: TikTokCatalogScan;
};
export type TelegramMeasurement = {
  date: string; sourceId: string; title: string; url: string; posts: number;
  subscribers?: number; views?: number; reactions?: number; forwards?: number; comments?: number;
};
