import type { Evidence } from '../materials/idea-model';

type RecordFields = {
  id: string;
  sourceId: string;
  kind: 'post' | 'comment';
  publicationId: string;
  parentId?: string;
  text: string;
  url: string;
  publishedAt: string | null;
  purpose: 'own' | 'inspiration';
  metrics?: {
    views?: number;
    forwards?: number;
    reactions?: number;
    likes?: number;
    comments?: number;
  };
};
export type CollectedRecord = RecordFields &
  (
    | { platform: 'telegram'; peerId: string; messageId: number }
    | { platform: 'tiktok'; videoId: string; commentId?: string }
  );
export type FoundIdea = {
  id: string;
  title: string;
  body: string;
  format: 'undecided' | 'video';
  source: 'telegram' | 'tiktok';
  evidence: Evidence[];
};
export type CollectionRun = {
  id: string;
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'interrupted';
  active: string | null;
  done: string[];
  steps: Record<string, number>;
  skipped: string[];
  events: string[];
  counts: { posts: number; comments: number; requests: number; ideas: number };
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  retryAt?: string;
  ideas: FoundIdea[];
  ideaAnalysisVersion?: number;
  failures?: Record<string, string>;
  sources?: Record<string, SourceProgress>;
  parameters?: {
    tiktok?: { latestVideos: number; commentsPerVideo: number };
    limits: { maxPublications: number; maxComments: number; maxRequests: number };
  };
};
export type SourceProgress = {
  platform: 'telegram' | 'tiktok';
  status:
    | 'reading'
    | 'completed'
    | 'limited'
    | 'login_required'
    | 'confirmation_required'
    | 'blocked'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  url: string;
  comments: number;
  videos?: { selected: number; processed: number };
  receivedComments?: number;
  limits?: { commentsPerVideo: number; limitedVideos: number };
  notices?: { code: string; videoId?: string; count?: number }[];
  expectedComments?: number;
  cursor?: string;
  reason?: string;
  stopCode?: string;
  failedRequest?: {
    stage: 'profile' | 'videos' | 'video' | 'comments' | 'replies';
    videoId?: string;
    videoNumber?: number;
    upstreamStatus?: number;
  };
  updatedAt: string;
};
export type TelegramAuthState = {
  phase: 'setup' | 'phone' | 'code' | 'password' | 'connected';
  phone?: string;
  codeLength?: number;
  delivery?: string;
  expiresAt?: string;
  passwordHint?: string;
};
