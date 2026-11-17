import { AppError } from '../errors.ts';
import { LocalStore } from '../store.ts';
import { TikTokConnectionModel } from './connection-model.ts';
import { ZenBridge } from './zen-bridge.ts';
import { parseIdentity } from './profile.ts';
import { parseComments, parseVideo, type TikTokVideo } from './parser.ts';
import type { TikTokReader, ReadOptions } from './contracts.ts';
import type { AnalysisSource } from '../../src/features/sources/model.ts';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export class ZenTikTokAccount extends TikTokConnectionModel implements TikTokReader {
  private connecting: Promise<void> | null = null;
  constructor(
    store: LocalStore,
    readonly bridge: ZenBridge,
  ) {
    super(store, 'tiktok-zen-account-v1');
  }
  get busy() {
    return this.bridge.busy;
  }
  override state() {
    return { ...super.state(), transport: 'zen' as const, extension: this.bridge.state() };
  }
  async connect(_owner?: string) {
    if (!this.bridge.online) {
      this.bridge.startPairing();
      return this.state();
    }
    if (!this.connecting) {
      this.update({ phase: 'checking', message: undefined });
      this.connecting = this.probe()
        .catch((error) => this.failed(error))
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.state();
  }
  private acceptIdentity(input: unknown) {
    const identity = parseIdentity(input);
    if (!identity)
      throw new AppError(
        401,
        'TIKTOK_LOGIN_REQUIRED',
        'Войдите в TikTok в Zen и проверьте подключение.',
      );
    if (this.value.account && this.value.account.id !== identity.id)
      throw new AppError(
        409,
        'TIKTOK_ACCOUNT_CHANGED',
        'В Zen открыт другой аккаунт TikTok. Отключите прежний перед сменой аккаунта.',
      );
    return identity;
  }
  private async probe() {
    let identity: ReturnType<typeof parseIdentity> = null;
    let received = false;
    await this.bridge.run(
      { kind: 'probe', maxVideos: 20, maxComments: 0, comments: false, replies: false },
      (type, data) => {
        if (type === 'identity') {
          identity = this.acceptIdentity(data);
          this.update({ account: identity, checkedAt: new Date().toISOString() });
        }
        if (type === 'profile') {
          if (!identity)
            throw new AppError(401, 'TIKTOK_LOGIN_REQUIRED', 'Аккаунт TikTok не подтверждён.');
          const payload = object(data);
          const videos = this.videos(payload.items, identity.handle);
          if (!videos.length && payload.complete !== true)
            throw new AppError(
              502,
              'TIKTOK_PROFILE_EMPTY',
              'TikTok не выдал список роликов. Профиль не отмечен пустым.',
            );
          received = true;
          this.update({
            videos: videos.slice(0, 20),
            coverage: payload.complete === true ? 'complete' : 'partial',
          });
        }
      },
    );
    if (!identity || !received)
      throw new AppError(
        502,
        'TIKTOK_PROFILE_EMPTY',
        'Расширение не подтвердило аккаунт и список роликов.',
      );
    this.update({ phase: 'connected', message: undefined });
  }
  private videos(input: unknown, handle: string) {
    if (!Array.isArray(input) || input.length > 1000)
      throw new AppError(400, 'ZEN_PAYLOAD', 'Некорректный список роликов.');
    const found = new Map<string, TikTokVideo>();
    for (const raw of input) {
      const video = parseVideo(raw);
      if (new URL(video.url).pathname.split('/')[1] !== '@' + handle)
        throw new AppError(409, 'TIKTOK_VIDEO_MISMATCH', 'Ролик относится к другому профилю.');
      found.set(video.id, video);
    }
    return [...found.values()].sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.id.localeCompare(a.id),
    );
  }
  private failed(error: unknown) {
    const message = error instanceof Error ? error.message : 'Связь с Zen прервана.';
    this.update({
      phase:
        error instanceof AppError && error.code === 'TIKTOK_LOGIN_REQUIRED'
          ? 'expired'
          : 'unavailable',
      message,
    });
  }
  async refresh() {
    if (this.connecting) return this.state();
    await this.probe().catch((error) => {
      this.failed(error);
      throw error;
    });
    return this.state();
  }
  async cancel(_owner?: string) {
    this.bridge.close();
    await this.connecting;
    return this.state();
  }
  async disconnect() {
    if (this.busy) throw new AppError(409, 'ZEN_BUSY', 'Сначала остановите сбор.');
    this.bridge.revoke();
    this.update({
      phase: 'disconnected',
      account: undefined,
      message: undefined,
      videos: [],
      coverage: 'unknown',
    });
    return this.state();
  }
  async close() {
    this.bridge.close();
    await this.connecting;
  }
  async read(source: AnalysisSource, options: ReadOptions) {
    const account = this.value.account;
    if (!account)
      throw new AppError(401, 'TIKTOK_LOGIN_REQUIRED', 'Подключите TikTok через расширение Zen.');
    if (source.accountId !== 'tiktok:' + account.id || source.url !== this.source()?.url)
      throw new AppError(400, 'ZEN_SOURCE', 'Сбор через Zen поддерживает подключённый профиль.');
    const seen = new Set<string>(),
      videos = new Map<string, TikTokVideo>();
    let identity = false,
      profileReceived = false,
      commentCount = 0,
      limited = false,
      completed = false;
    try {
      await this.bridge.run(
        {
          kind: 'collect',
          accountId: account.id,
          handle: account.handle,
          maxVideos: Math.min(20, options.maxVideos),
          maxComments: options.maxComments,
          comments: options.comments,
          replies: options.replies,
        },
        (type, data) => {
          const payload = object(data);
          if (type === 'identity') {
            this.acceptIdentity(data);
            identity = true;
          } else if (type === 'profile') {
            if (!identity)
              throw new AppError(
                401,
                'TIKTOK_LOGIN_REQUIRED',
                'Расширение не подтвердило аккаунт.',
              );
            const list = this.videos(payload.items, account.handle).slice(
              0,
              Math.min(20, options.maxVideos),
            );
            this.update({
              videos: list,
              coverage: payload.complete === true ? 'complete' : 'partial',
            });
            for (const video of list) videos.set(video.id, video);
            profileReceived = true;
            limited ||= payload.complete !== true;
          } else if (type === 'video') {
            const video = parseVideo(payload);
            if (!identity || videos.get(video.id)?.url !== video.url)
              throw new AppError(
                409,
                'TIKTOK_VIDEO_MISMATCH',
                'Ролик не входит в выбранную подборку.',
              );
            if (seen.has('video:' + video.id)) return;
            seen.add('video:' + video.id);
            videos.set(video.id, video);
            options.onVideo(video);
          } else if (type === 'comments') {
            const id = String(payload.videoId);
            const video = videos.get(id);
            if (!video || !seen.has('video:' + id))
              throw new AppError(
                409,
                'TIKTOK_VIDEO_MISMATCH',
                'Комментарии не относятся к выбранному ролику.',
              );
            const page = parseComments(
              payload.page,
              id,
              typeof payload.parentId === 'string' ? payload.parentId : undefined,
            );
            for (const comment of [...page.items, ...page.previews]) {
              if (seen.has(comment.id) || (!options.replies && comment.parentId)) continue;
              if (commentCount >= options.maxComments) {
                limited = true;
                break;
              }
              seen.add(comment.id);
              commentCount++;
              options.onComment(comment, video);
            }
          } else if (type === 'progress') {
            if (payload.status === 'limited') limited = true;
            if (payload.status === 'completed') completed = true;
            options.onProgress({
              url: source.url,
              comments: commentCount,
              status: limited ? 'limited' : 'reading',
              reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 300) : undefined,
            });
          }
        },
        () => options.beforeRequest('data'),
        options.signal,
      );
      if (
        !identity ||
        !profileReceived ||
        !completed ||
        [...videos.keys()].some((id) => !seen.has('video:' + id))
      )
        throw new AppError(
          502,
          'ZEN_INCOMPLETE',
          'Расширение не подтвердило завершение сбора. Полученные записи сохранены.',
        );
      this.update({ phase: 'connected', checkedAt: new Date().toISOString(), message: undefined });
      options.onProgress({
        url: source.url,
        comments: commentCount,
        status: limited ? 'limited' : 'completed',
        reason: limited ? 'Получена часть данных TikTok или достигнут заданный лимит.' : undefined,
      });
    } catch (error) {
      if (
        !options.signal.aborted &&
        error instanceof AppError &&
        ['TIKTOK_LOGIN_REQUIRED', 'TIKTOK_ACCOUNT_CHANGED'].includes(error.code)
      )
        this.failed(error);
      throw error;
    }
  }
}
