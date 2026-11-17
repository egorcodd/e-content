export type TikTokIdentity = { id: string; handle: string; displayName: string };
export type TikTokVideoSummary = {
  id: string;
  url: string;
  text: string;
  publishedAt: string | null;
  metrics: { views?: number; likes?: number; forwards?: number; comments?: number };
};
export const tiktokCollectionLimits = {
  videos: 100,
  commentsPerVideo: 10000,
  defaultCommentsPerVideo: 100,
};
export type TikTokSelection = { latest: number; enabled: boolean; commentsPerVideo?: number };
export type TikTokConnectionState = {
  transport?: 'zen' | 'native';
  authentication?: 'public';
  extension?: {
    paired: boolean;
    online: boolean;
    pairing?: { code: string; expiresAt: string };
    version?: string;
    lastFailure?: { code: string; stage?: string };
  };
  phase:
    | 'disconnected'
    | 'waiting_login'
    | 'checking'
    | 'connected'
    | 'expired'
    | 'verification_required'
    | 'unavailable';
  account?: TikTokIdentity;
  selection: TikTokSelection;
  videos: TikTokVideoSummary[];
  coverage: 'unknown' | 'complete' | 'partial';
  message?: string;
  checkedAt?: string;
  windowOpen: boolean;
};
