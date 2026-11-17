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
  tiktok: TikTokMeasurement[];
  handle?: string;
  scan?: TikTokCatalogScan;
  catalog?: TikTokCatalogScan;
};
