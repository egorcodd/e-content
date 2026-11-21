import type { AnalysisSource } from '../../src/features/sources/model.ts';
import type { SourceProgress } from '../../src/features/collection/contracts.ts';
import type { TikTokVideo, TikTokComment } from './parser.ts';

export type TikTokThread = {
  video: TikTokVideo;
  rootId: string;
  cursor: string;
  seen: string[];
  total: number;
  reportedReplies?: number;
};

export type ReadOptions = {
  collectUntil?: number;
  continueSample?: boolean;
  tiktokCollectionVersion?: 2 | 3;
  threadsOnly?: boolean;
  signal: AbortSignal;
  maxVideos: number;
  additionalBacklogVideos?: number;
  maxComments: number;
  commentsPerVideo?: number;
  replies: boolean;
  comments: boolean;
  since: string;
  beforeRequest: (kind: 'data' | 'resource', signal?: AbortSignal) => Promise<void>;
  journal?: { get<T>(key: string): T | undefined; put(key: string, value: unknown): void };
  savedRetry?: SourceProgress['retry'];
  requestsRemaining?: () => number;
  onVideo: (video: TikTokVideo, backlog?: boolean) => void;
  onComment: (comment: TikTokComment, video: TikTokVideo) => void;
  onProgress: (progress: Omit<SourceProgress, 'platform' | 'updatedAt'>) => void;
};
export type TikTokReader = { read(source: AnalysisSource, options: ReadOptions): Promise<void> };
export type TikTokReaderFactory = () => TikTokReader;
