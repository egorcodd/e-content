import type { AnalysisSource } from '../../src/features/sources/model.ts';
import type { SourceProgress } from '../../src/features/collection/contracts.ts';
import type { TikTokVideo, TikTokComment } from './parser.ts';

export type ReadOptions = {
  signal: AbortSignal;
  maxVideos: number;
  maxComments: number;
  commentsPerVideo?: number;
  replies: boolean;
  comments: boolean;
  since: string;
  beforeRequest: (kind: 'data' | 'resource') => Promise<void>;
  onVideo: (video: TikTokVideo) => void;
  onComment: (comment: TikTokComment, video: TikTokVideo) => void;
  onProgress: (progress: Omit<SourceProgress, 'platform' | 'updatedAt'>) => void;
};
export type TikTokReader = { read(source: AnalysisSource, options: ReadOptions): Promise<void> };
export type TikTokReaderFactory = () => TikTokReader;
