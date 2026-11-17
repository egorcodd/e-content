import { setTimeout as delay } from 'node:timers/promises';
import { configuration } from './fixtures.ts';
import { parseVideo, parseComments } from '../tiktok/parser.ts';
import type { TikTokReader } from '../tiktok/contracts.ts';
import { rawVideo, rawComment, videoId, videoUrl } from './tiktok-fixtures.ts';
import { AppError } from '../errors.ts';

export const tiktokConfiguration = () => {
  const config = configuration();
  config.sources = [
    {
      id: 'tiktok-source',
      platform: 'tiktok',
      kind: 'video',
      url: videoUrl,
      title: 'Fixture TikTok',
      accountId: null,
      purpose: 'own',
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];
  return config;
};
export class FixtureTikTokReader implements TikTokReader {
  constructor(private mode: 'success' | 'login' | 'cancel' = 'success') {}
  async read(_source: unknown, options: Parameters<TikTokReader['read']>[1]) {
    await options.beforeRequest('data');
    const video = parseVideo(rawVideo);
    options.onVideo(video);
    options.onProgress({ status: 'reading', url: video.url, comments: 0, expectedComments: 3 });
    if (this.mode === 'login')
      throw new AppError(401, 'TIKTOK_LOGIN_REQUIRED', 'TikTok требует вход для комментариев.');
    if (this.mode === 'cancel') await delay(30000, undefined, { signal: options.signal });
    const records = Array.from({ length: 3 }, (_, i) => rawComment('900000000000000000' + (i + 1)));
    const page = parseComments({ status_code: 0, comments: records, has_more: false }, videoId);
    for (const comment of page.items.slice(0, options.maxComments))
      options.onComment(comment, video);
    options.onProgress({
      status: options.maxComments < 3 ? 'limited' : 'completed',
      url: video.url,
      comments: Math.min(3, options.maxComments),
      expectedComments: 3,
      reason: options.maxComments < 3 ? 'Достигнут лимит комментариев.' : undefined,
    });
  }
}
