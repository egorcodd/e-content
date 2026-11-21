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
  excludedEvidenceIds?: string[];
  mergedFrom?: { id: string; title: string; body: string }[];
  id: string;
  title: string;
  body: string;
  format: 'undecided' | 'video' | 'post';
  source: 'telegram' | 'tiktok';
  evidence: Evidence[];
};
export type AiIdeaReport = {
  model: string;
  comments: number;
  videos: number;
  ideas: { topicId?: string; title: string; angle: string; evidence: (Evidence & { quote?: string })[] }[];
  usage: { input: number; output: number; cachedInput?: number };
};
export type CollectionRun = {
  tiktokCollectUntil?: number;
  followUp?: { state: 'manual' | 'queued' | 'reading' | 'complete' | 'limited'; attempts: number; sample: number; at: string; reason?: string };
  ideaMode?: 'ai' | 'collect';
  aiUsage?: AiIdeaReport['usage'];
  aiCostUsd?: number;
  canResumeTikTok?: boolean;
  previousTikTokRun?: Pick<CollectionRun, 'id' | 'counts' | 'updatedAt'>;
  tiktokCollectionVersion?: 2 | 3;
  threadsOnly?: boolean;
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
  ideaInputCount?: number;
  ideaRevision?: number;
  failures?: Record<string, string>;
  sources?: Record<string, SourceProgress>;
  parameters?: {
    tiktok?: { latestVideos: number; commentsPerVideo: number };
    limits: { maxPublications: number; maxComments: number; maxRequests: number };
  };
};
export type SourceProgress = {
  provider?: 'apify';
  reusedComments?: number;
  sampleVideos?: number;
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
  backlogVideos?: number;
  threads?: { selected: number; completed: number };
  receivedComments?: number;
  limits?: { commentsPerVideo: number; limitedVideos: number };
  notices?: { code: string; videoId?: string; count?: number }[];
  expectedComments?: number;
  cursor?: string;
  reason?: string;
  stopCode?: string;
  retry?: { at: string; attempt: number; scope?: 'discussions' };
  deferredVideos?: number[];
  inlineReplies?: { threads: number; comments: number };
  failedRequest?: {
    stage: 'profile' | 'videos' | 'video' | 'comments' | 'replies';
    videoId?: string;
    videoNumber?: number;
    upstreamStatus?: number;
    responseIssue?: 'empty' | 'overloaded' | 'limited' | 'access';
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
