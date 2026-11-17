import { AppError } from '../errors.ts';
import { LocalStore } from '../store.ts';
import { TikTokConnectionModel } from './connection-model.ts';
import { NativeTikTokHost, TikTokRequestError, type TikTokTransport } from './native-host.ts';
import type { SourceProgress } from '../../src/features/collection/contracts.ts';
import { parseIdentity } from './profile.ts';
import { counter, parseComments, parseVideo, type TikTokVideo } from './parser.ts';
import {
  parseSource,
  type AnalysisSource,
  type SourceConfiguration,
} from '../../src/features/sources/model.ts';
import {
  tiktokCollectionLimits,
  type TikTokSelection,
} from '../../src/features/sources/tiktok-contracts.ts';
import type { TikTokReader, ReadOptions } from './contracts.ts';
import type { TikTokIdentity } from '../../src/features/sources/tiktok-contracts.ts';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Request = (path: string) => Promise<Record<string, unknown>>;

export class NativeTikTokSource extends TikTokConnectionModel implements TikTokReader {
  private controller?: AbortController;
  private connecting?: Promise<void>;
  private reading = false;
  constructor(
    store: LocalStore,
    private transport: TikTokTransport = new NativeTikTokHost(),
  ) {
    super(store, 'tiktok-native-profile-v1');
    this.value.selection.commentsPerVideo ??= tiktokCollectionLimits.defaultCommentsPerVideo;
  }
  get busy() {
    return !!this.connecting || this.reading;
  }
  override state() {
    return { ...super.state(), transport: 'native' as const, authentication: 'public' as const };
  }
  override accounts() {
    return [];
  }
  override select(input: unknown) {
    if (this.connecting)
      throw new AppError(409, 'TIKTOK_BUSY', 'Дождитесь завершения проверки профиля.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AppError(400, 'TIKTOK_SELECTION', 'Проверьте параметры TikTok.');
    const value = { ...this.value.selection, ...(input as Partial<TikTokSelection>) };
    const commentsPerVideo = value?.commentsPerVideo ?? this.value.selection.commentsPerVideo!;
    if (
      !value ||
      !Number.isInteger(value.latest) ||
      value.latest! < 1 ||
      value.latest! > tiktokCollectionLimits.videos ||
      typeof value.enabled !== 'boolean' ||
      !Number.isInteger(commentsPerVideo) ||
      commentsPerVideo < 1 ||
      commentsPerVideo > tiktokCollectionLimits.commentsPerVideo
    )
      throw new AppError(
        400,
        'TIKTOK_SELECTION',
        'Выберите от 1 до 100 роликов и от 1 до 10 000 комментариев на ролик.',
      );
    const needsMoreVideos =
      value.latest > this.value.selection.latest && value.latest > this.value.videos.length;
    this.update({ selection: { latest: value.latest, enabled: value.enabled, commentsPerVideo } });
    if (needsMoreVideos && this.value.account && !this.reading) void this.refresh();
    return this.state();
  }
  override configuration(config: SourceConfiguration): SourceConfiguration {
    const configured = super.configuration(config);
    return {
      ...configured,
      platforms: {
        ...configured.platforms,
        tiktok: {
          ...configured.platforms.tiktok,
          commentsPerVideo: this.value.selection.commentsPerVideo!,
        },
      },
    };
  }
  override source(): AnalysisSource | null {
    const source = super.source();
    return source
      ? { ...source, id: 'tiktok-profile-' + this.value.account!.id, accountId: null }
      : null;
  }
  async connect(_owner?: string, input: Record<string, unknown> = {}) {
    if (this.busy)
      throw new AppError(409, 'TIKTOK_BUSY', 'Сначала завершите текущую проверку или сбор.');
    const handle = this.handle(input.handle ?? this.value.account?.handle);
    this.controller = new AbortController();
    this.update({ phase: 'checking', message: undefined });
    this.connecting = this.probe(handle, this.controller.signal)
      .catch((error) => {
        this.update({
          phase: this.controller?.signal.aborted
            ? this.value.account
              ? 'connected'
              : 'disconnected'
            : 'unavailable',
          message: this.controller?.signal.aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : 'Не удалось проверить профиль TikTok.',
        });
      })
      .finally(() => {
        this.connecting = undefined;
        this.controller = undefined;
      });
    return this.state();
  }
  private handle(input: unknown) {
    if (typeof input !== 'string')
      throw new AppError(400, 'TIKTOK_PROFILE', 'Введите имя профиля TikTok.');
    try {
      const value = input.trim();
      const parsed = parseSource(
        /^[A-Za-z0-9_.]{2,24}$/.test(value) ? '@' + value : value,
        'tiktok',
      );
      if (parsed.kind !== 'profile') throw new Error();
      return new URL(parsed.url).pathname.slice(2);
    } catch {
      throw new AppError(400, 'TIKTOK_PROFILE', 'Введите @имя или ссылку на профиль TikTok.');
    }
  }
  private async profile(handle: string, get: Request) {
    const data = await get('/tiktok/user/detail?uniqueId=' + encodeURIComponent(handle));
    const info = object(data.userInfo);
    const raw = object(info.user);
    const identity = parseIdentity(raw);
    if (
      !identity ||
      identity.handle.toLowerCase() !== handle.toLowerCase() ||
      typeof raw.secUid !== 'string' ||
      !raw.secUid ||
      raw.secUid.length > 500
    )
      throw new AppError(502, 'TIKTOK_PROFILE_EMPTY', 'TikTok не выдал подтверждённый профиль.');
    const stats = (key: string) =>
      counter(object(info.statsV2)[key]) ?? counter(object(info.stats)[key]);
    return {
      identity,
      secUid: raw.secUid,
      followers: stats('followerCount'),
      videos: stats('videoCount'),
    };
  }
  private async *videoPages(handle: string, secUid: string, get: Request) {
    const cursors = new Set<string>();
    let cursor = '0';
    for (;;) {
      const data = await get(
        '/tiktok/user/posts?' + new URLSearchParams({ secUid, count: '30', cursor }),
      );
      if (!Array.isArray(data.itemList) || ![true, false, 0, 1].includes(data.hasMore as boolean))
        throw new AppError(502, 'TIKTOK_SCHEMA', 'TikTok не выдал подтверждённый список роликов.');
      const videos = data.itemList.map((raw) => {
        const video = parseVideo(raw);
        if (new URL(video.url).pathname.split('/')[1].toLowerCase() !== '@' + handle.toLowerCase())
          throw new AppError(502, 'TIKTOK_VIDEO_MISMATCH', 'Ролик относится к другому профилю.');
        if (!video.publishedAt)
          throw new AppError(502, 'TIKTOK_DATE', 'TikTok не вернул дату ролика.');
        return video;
      });
      yield { videos, last: !data.hasMore };
      if (!data.hasMore) return;
      const next = String(data.cursor ?? '');
      if (!videos.length || !next || next === cursor || cursors.has(next))
        throw new AppError(502, 'TIKTOK_CURSOR', 'TikTok повторил страницу роликов.');
      cursors.add(cursor);
      cursor = next;
    }
  }
  private async videos(handle: string, secUid: string, limit: number, get: Request) {
    const found = new Map<string, TikTokVideo>();
    let pageCount = 0;
    let exhausted = false;
    // Scan an additional page so pinned older videos do not displace recent ones.
    for await (const page of this.videoPages(handle, secUid, get)) {
      for (const video of page.videos) found.set(video.id, video);
      if (page.last) {
        exhausted = true;
        break;
      }
      pageCount++;
      if ((pageCount >= 2 && found.size >= limit) || pageCount >= 20) break;
    }
    const videos = [...found.values()]
      .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!) || b.id.localeCompare(a.id))
      .slice(0, limit);
    if (!videos.length && !exhausted)
      throw new AppError(502, 'TIKTOK_PROFILE_EMPTY', 'TikTok не выдал список роликов.');
    return { videos, complete: exhausted || videos.length === limit };
  }
  async readCatalog(
    account: TikTokIdentity,
    signal: AbortSignal,
    onProfile: (stats: { followers?: number; videos?: number }) => void,
    onPage: (videos: TikTokVideo[], last: boolean) => void,
  ) {
    if (this.busy) throw new AppError(409, 'TIKTOK_BUSY', 'Сборщик TikTok уже занят.');
    this.reading = true;
    try {
      const get: Request = (path) => this.transport.get(path, signal);
      const profile = await this.profile(account.handle, get);
      if (profile.identity.id !== account.id)
        throw new AppError(409, 'TIKTOK_PROFILE_CHANGED', 'TikTok вернул другой профиль.');
      onProfile(profile);
      for await (const page of this.videoPages(account.handle, profile.secUid, get)) {
        signal.throwIfAborted();
        onPage(page.videos, page.last);
      }
    } finally {
      this.reading = false;
    }
  }
  private async probe(handle: string, signal: AbortSignal) {
    const get: Request = (path) => this.transport.get(path, signal);
    const { identity, secUid } = await this.profile(handle, get);
    const result = await this.videos(identity.handle, secUid, this.value.selection.latest, get);
    signal.throwIfAborted();
    this.update({
      account: identity,
      videos: result.videos,
      phase: 'connected',
      checkedAt: new Date().toISOString(),
      coverage: result.complete ? 'complete' : 'partial',
      message: undefined,
    });
  }
  async refresh() {
    return this.connect();
  }
  async cancel(_owner?: string) {
    this.controller?.abort();
    await this.connecting;
    return this.state();
  }
  async disconnect() {
    if (this.busy) throw new AppError(409, 'TIKTOK_BUSY', 'Сначала остановите сбор.');
    this.update({
      account: undefined,
      videos: [],
      phase: 'disconnected',
      coverage: 'unknown',
      message: undefined,
    });
    await this.transport.close();
    return this.state();
  }
  async close() {
    await this.cancel();
    await this.transport.close();
  }

  async read(source: AnalysisSource, options: ReadOptions) {
    if (this.busy) throw new AppError(409, 'TIKTOK_BUSY', 'Сборщик TikTok уже занят.');
    this.reading = true;
    let comments = 0,
      selected = 0,
      processed = 0,
      limitedVideos = 0;
    const commentsPerVideo = options.commentsPerVideo ?? this.value.selection.commentsPerVideo!;
    const notices: { code: string; videoId?: string; count?: number }[] = [];
    let failedRequest: SourceProgress['failedRequest'];
    const progress = (
      status: 'reading' | 'completed' | 'limited',
      reason?: string,
      stopCode?: string,
    ) =>
      options.onProgress({
        url: source.url,
        status,
        comments,
        receivedComments: comments,
        videos: { selected, processed },
        limits: { commentsPerVideo, limitedVideos },
        notices: [...notices],
        reason,
        stopCode,
        failedRequest,
      });
    const get: Request = async (path) => {
      try {
        options.signal.throwIfAborted();
        await options.beforeRequest('data');
        return await this.transport.get(path, options.signal);
      } catch (error) {
        if (!options.signal.aborted) {
          const [route] = path.split('?');
          const videoId = /^\/tiktok\/video\/(\d+)/.exec(route)?.[1];
          const stage = route.endsWith('/replies')
            ? 'replies'
            : route.endsWith('/comments')
              ? 'comments'
              : route.endsWith('/posts')
                ? 'videos'
                : videoId
                  ? 'video'
                  : 'profile';
          failedRequest = {
            stage,
            videoId,
            videoNumber: stage === 'comments' || stage === 'replies' ? processed + 1 : undefined,
            upstreamStatus: error instanceof TikTokRequestError ? error.upstreamStatus : undefined,
          };
          progress('reading');
        }
        throw error;
      }
    };
    try {
      const handle = this.handle(
        source.kind === 'video' ? new URL(source.url).pathname.split('/')[1] : source.url,
      );
      let videos: TikTokVideo[];
      if (source.kind === 'video') {
        const id = new URL(source.url).pathname.split('/')[3];
        const raw = await get('/tiktok/video/' + id + '?');
        videos = [parseVideo(object(raw.itemInfo).itemStruct, id)];
      } else {
        const profile = await this.profile(handle, get);
        const result = await this.videos(
          handle,
          profile.secUid,
          Math.min(tiktokCollectionLimits.videos, options.maxVideos),
          get,
        );
        videos = result.videos;
        if (!result.complete) notices.push({ code: 'TIKTOK_VIDEO_LIST_INCOMPLETE' });
        if (
          this.value.account?.id === profile.identity.id &&
          options.maxVideos >= this.value.selection.latest
        )
          this.update({ videos, coverage: result.complete ? 'complete' : 'partial' });
      }
      const seen = new Set<string>();
      let videoComments = 0;
      const receive = (row: Parameters<ReadOptions['onComment']>[0], video: TikTokVideo) => {
        if (seen.has(row.id)) return;
        if (comments >= options.maxComments || videoComments >= commentsPerVideo) return;
        seen.add(row.id);
        comments++;
        videoComments++;
        options.onComment(row, video);
      };
      selected = videos.length;
      for (const video of videos) options.onVideo(video);
      progress('reading');
      for (const video of videos) {
        options.signal.throwIfAborted();
        if (!options.comments) {
          processed++;
          continue;
        }
        if (comments >= options.maxComments) break;
        videoComments = 0;
        let cursor = '0';
        const cursors = new Set<string>();
        while (true) {
          if (comments >= options.maxComments || videoComments >= commentsPerVideo) break;
          const raw = await get(
            `/tiktok/video/${video.id}/comments?count=${Math.min(20, commentsPerVideo - videoComments, options.maxComments - comments)}&cursor=${encodeURIComponent(cursor)}`,
          );
          const batch = parseComments(raw, video.id);
          if (
            !batch.items.length &&
            !batch.hasMore &&
            (video.commentCount ?? 0) > 0 &&
            cursor === '0'
          )
            throw new AppError(
              502,
              'TIKTOK_COMMENTS_EMPTY',
              'TikTok не выдал тексты комментариев. Полученный результат сохранён.',
            );
          for (const root of batch.items) {
            receive(root, video);
            if (
              options.replies &&
              (root.replyCount ?? 0) > 0 &&
              comments < options.maxComments &&
              videoComments < commentsPerVideo
            ) {
              let replyCursor = '0',
                received = 0;
              const replyCursors = new Set<string>();
              while (true) {
                const replyRaw = await get(
                  `/tiktok/video/${video.id}/comments/${root.id}/replies?cursor=${encodeURIComponent(replyCursor)}`,
                );
                const replies = parseComments(replyRaw, video.id, root.id);
                for (const reply of replies.items) receive(reply, video);
                received += replies.items.length;
                const total =
                  typeof replyRaw.total === 'number' ? replyRaw.total : root.replyCount!;
                if (comments >= options.maxComments || videoComments >= commentsPerVideo) break;
                // The replies endpoint can set has_more=0 while total still exceeds cursor.
                const next = String(replyRaw.cursor ?? '');
                if (!replies.hasMore && received >= total) break;
                if (
                  !replies.items.length ||
                  !next ||
                  next === replyCursor ||
                  replyCursors.has(next)
                ) {
                  notices.push({ code: 'TIKTOK_REPLIES_INCOMPLETE', videoId: video.id });
                  break;
                }
                replyCursors.add(replyCursor);
                replyCursor = next;
              }
            }
            if (comments >= options.maxComments || videoComments >= commentsPerVideo) break;
          }
          progress('reading');
          if (
            !batch.hasMore ||
            comments >= options.maxComments ||
            videoComments >= commentsPerVideo
          )
            break;
          const next = batch.cursor!;
          if (!batch.items.length || next === cursor || cursors.has(next))
            throw new AppError(502, 'TIKTOK_CURSOR', 'TikTok повторил страницу комментариев.');
          cursors.add(cursor);
          cursor = next;
        }
        processed++;
        if (videoComments >= commentsPerVideo) {
          limitedVideos++;
          notices.push({ code: 'TIKTOK_PER_VIDEO_LIMIT', videoId: video.id, count: videoComments });
        }
        progress('reading');
        if (comments >= options.maxComments) break;
      }
      const summary = `Обработано ${processed} из ${selected} роликов.`;
      const overall = options.comments && comments >= options.maxComments;
      const missing = notices.filter((notice) => notice.code === 'TIKTOK_REPLIES_INCOMPLETE');
      const listIncomplete = notices.some(
        (notice) => notice.code === 'TIKTOK_VIDEO_LIST_INCOMPLETE',
      );
      const reasons = [
        ...(overall
          ? [
              `Достигнут общий лимит комментариев запуска. Получено ${comments} комментариев TikTok, включая ответы.`,
            ]
          : []),
        ...(limitedVideos
          ? [
              `На ${limitedVideos} роликах достигнут лимит ${commentsPerVideo} комментариев на ролик, включая ответы.`,
            ]
          : []),
        ...(missing.length
          ? [`TikTok не выдал продолжение ответов: ${missing.length} веток.`]
          : []),
        ...(listIncomplete ? ['TikTok выдал не весь запрошенный список роликов.'] : []),
      ];
      const code = overall
        ? 'TIKTOK_TOTAL_COMMENT_LIMIT'
        : missing.length
          ? 'TIKTOK_REPLIES_INCOMPLETE'
          : listIncomplete
            ? 'TIKTOK_VIDEO_LIST_INCOMPLETE'
            : limitedVideos
              ? 'TIKTOK_PER_VIDEO_LIMIT'
              : undefined;
      const incomplete = overall || missing.length > 0 || listIncomplete;
      progress(incomplete ? 'limited' : 'completed', [summary, ...reasons].join(' '), code);
    } finally {
      this.reading = false;
    }
  }
}
