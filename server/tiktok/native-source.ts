import { readApifyComments } from './apify-comments.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../errors.ts';
import { LocalStore } from '../store.ts';
import { TikTokConnectionModel } from './connection-model.ts';
import { TikTokReadBacklog } from './read-backlog.ts';
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
import type { TikTokReader, ReadOptions, TikTokThread } from './contracts.ts';
import type { TikTokIdentity } from '../../src/features/sources/tiktok-contracts.ts';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Request = <T>(path: string, decode: (raw: Record<string, unknown>) => T) => Promise<T>;
type PendingPage = {
  path: string;
  at: string;
  attempt: number;
  code: string;
  failedRequest: SourceProgress['failedRequest'];
  // While several discussions are unavailable, alternate between these unfinished
  // pages. Persist the scheduling decision so replay uses the same page cursors.
  probeVideos?: [number, number] | null;
  sharedCooldown?: boolean;
};

// Supplementary replies may be deferred once their waiting allowance is spent.
const maxRetryWaitMs = 90_000;
const maxConsecutiveFailures = 6;
const maxOutageMs = 24 * 60 * 60 * 1000;
const automaticStopReasons: Record<string, string> = {
  TIKTOK_SAMPLE_PAUSED: 'TikTok временно приостановил выдачу. Место чтения сохранено.',
  TIKTOK_SAVED_SAMPLE: 'Обновление отложено. Для разбора доступны сохранённые комментарии.',
  TIKTOK_SAMPLE_TIME: 'Выборка ограничена пятью минутами. Непрочитанные страницы сохранены в очереди.',
  TIKTOK_RETRY_EXHAUSTED: 'TikTok несколько раз не вернул данные. Место остановки сохранено.',
  TIKTOK_RETRY_TOO_LATE:
    'Пауза TikTok превышает срок автоматического продолжения. Место остановки сохранено.',
};

export class NativeTikTokSource extends TikTokConnectionModel implements TikTokReader {
  private controller?: AbortController;
  private connecting?: Promise<void>;
  private reading = false;
  constructor(
    store: LocalStore,
    private transport: TikTokTransport = new NativeTikTokHost(),
    private retryDelaysMs: readonly number[] = [
      60_000, 120_000, 240_000, 600_000, 1_800_000, 3_600_000,
    ],
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
  private profile(handle: string, get: Request) {
    return get('/tiktok/user/detail?uniqueId=' + encodeURIComponent(handle), (data) => {
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
    });
  }
  private async *videoPages(handle: string, secUid: string, get: Request) {
    const cursors = new Set<string>();
    let cursor = '0';
    for (;;) {
      const page = await get(
        '/tiktok/user/posts?' + new URLSearchParams({ secUid, count: '30', cursor }),
        (data) => {
          if (
            !Array.isArray(data.itemList) ||
            ![true, false, 0, 1].includes(data.hasMore as boolean)
          )
            throw new AppError(
              502,
              'TIKTOK_SCHEMA',
              'TikTok не выдал подтверждённый список роликов.',
            );
          const videos = data.itemList.map((raw) => {
            const video = parseVideo(raw);
            if (
              new URL(video.url).pathname.split('/')[1].toLowerCase() !==
              '@' + handle.toLowerCase()
            )
              throw new AppError(
                502,
                'TIKTOK_VIDEO_MISMATCH',
                'Ролик относится к другому профилю.',
              );
            if (!video.publishedAt)
              throw new AppError(502, 'TIKTOK_DATE', 'TikTok не вернул дату ролика.');
            return video;
          });
          return { videos, last: !data.hasMore, next: String(data.cursor ?? '') };
        },
      );
      yield page;
      if (page.last) return;
      const next = page.next;
      if (!page.videos.length || !next || next === cursor || cursors.has(next))
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
      const get: Request = async (path, decode) => decode(await this.transport.get(path, signal));
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
    const get: Request = async (path, decode) => decode(await this.transport.get(path, signal));
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
    const sampleJournal = options.journal;
    const timeLimit = options.collectUntil === undefined ? undefined
      : AbortSignal.timeout(Math.max(0, options.collectUntil - Date.now()));
    const requestSignal = timeLimit ? AbortSignal.any([options.signal, timeLimit]) : options.signal;
    const sampleEnded = (code: 'TIKTOK_SAMPLE_TIME' | 'TIKTOK_SAMPLE_PAUSED') =>
      new AppError(503, code, automaticStopReasons[code]);
    const managedToken = options.comments && !options.threadsOnly
      ? this.store.secret<string>('apify-api-token') ?? process.env.APIFY_TOKEN : undefined;
    const frozenVideos = options.continueSample ? sampleJournal?.get<TikTokVideo[]>('analysis-videos') : undefined;
    // A continuation consumes the live page positions. The foreground request
    // journal exists for reproducing that pass after a process interruption.
    if (options.continueSample && !managedToken) options = {...options, journal: undefined, savedRetry: undefined};
    const rootsFirst = !!options.tiktokCollectionVersion;
    const automaticRecovery = options.tiktokCollectionVersion === 3 && !options.threadsOnly;
    const rootBacklog = new TikTokReadBacklog(this.store.db);
    const savedRoots = rootsFirst
      ? (options.journal?.get<ReturnType<TikTokReadBacklog['roots']>>('starting-roots') ??
        rootBacklog.roots(source.id))
      : [];
    if (rootsFirst) {
      options.journal?.put('starting-roots', savedRoots);
      rootBacklog.pruneCooldowns(source.id);
    }
    const deferredVideos = options.collectUntil
      ? options.journal?.get<Record<string,number>>('deferred-at-start') ?? rootBacklog.deferredVideos(source.id)
      : {};
    if (options.collectUntil) options.journal?.put('deferred-at-start',deferredVideos);
    const startingRoots = new Map(savedRoots.map((task) => [task.video.id, task]));
    const rootVideos = new Map<string, TikTokVideo>();
    const knownVideos = this.source()?.id === source.id && source.kind === 'profile'
      ? this.value.videos.slice(0, options.maxVideos) : [];
    const unreadRoots = new Map<string, { video: TikTokVideo; cursor: string }>();
    const waitLedger = options.journal?.get<{ used: number; reservedUntil: number }>(
      'retry-wait',
    ) ?? { used: 0, reservedUntil: 0 };
    let outage =
      options.journal?.get<{ since: number; failures: number; videoId?: string } | null>('primary-outage') ?? null;
    this.reading = true;
    let comments = 0,
      selected = 0,
      processed = 0,
      limitedVideos = 0;
    const commentsPerVideo = options.commentsPerVideo ?? this.value.selection.commentsPerVideo!;
    const notices: { code: string; videoId?: string; count?: number }[] = [];
    let failedRequest: SourceProgress['failedRequest'];
    let retry: SourceProgress['retry'];
    let pending = options.journal?.get<PendingPage | null>('retry') ?? undefined;
    // Replay past queue rotations in order, so saved pages, cursors and run limits
    // are consumed in exactly the same order after a server restart.
    const turns =
      options.journal?.get<PendingPage[]>('video-turns') ??
      (pending?.failedRequest?.videoNumber ? [pending] : []);
    if (pending?.failedRequest?.videoNumber) pending = undefined;
    const replayCount = turns.length;
    let replayIndex = 0;
    const parkVideo = Symbol('defer this video');
    const waiting = new Map<string, PendingPage>();
    let gate =
      options.journal?.get<number>('last-cleared-turn') === turns.length ? undefined : turns.at(-1);
    if (rootsFirst && gate?.sharedCooldown === false) gate = undefined;
    const previous = turns.at(-2);
    // Older runs recorded rotations only. Upgrade just the currently waiting turn;
    // changing an earlier rotation would alter the order of already collected pages.
    if (
      gate &&
      gate.probeVideos === undefined &&
      gate.at === options.savedRetry?.at &&
      gate.code === 'TIKTOK_BLOCKED' &&
      previous?.code === gate.code &&
      previous.attempt + 1 === gate.attempt &&
      previous.failedRequest?.videoNumber &&
      gate.failedRequest?.videoNumber &&
      previous.failedRequest.videoNumber !== gate.failedRequest.videoNumber
    ) {
      gate.probeVideos = [previous.failedRequest.videoNumber, gate.failedRequest.videoNumber];
      options.journal?.put('video-turns', turns);
    }
    let consecutiveFailures = gate?.attempt ?? 0;
    const clearVideoPause = () => {
      if (gate) options.journal?.put('last-cleared-turn', turns.length);
      gate = undefined;
      consecutiveFailures = 0;
    };
    const inlineReplies = { threads: 0, comments: 0 };
    const threadProgress = { selected: 0, completed: 0 };
    let backlogVideos = 0;
    let videoNumber = 0;
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
        ...(backlogVideos ? { backlogVideos } : {}),
        ...(options.threadsOnly ? { threads: { ...threadProgress } } : {}),
        limits: { commentsPerVideo, limitedVideos },
        notices: [...notices],
        reason,
        stopCode,
        failedRequest,
        retry,
        deferredVideos: [...waiting.values()].flatMap(
          (page) => page.failedRequest?.videoNumber ?? [],
        ),
        inlineReplies: { ...inlineReplies },
      });
    const request: Request = async <T>(path: string, read: (raw: Record<string, unknown>) => T) => {
      options.signal.throwIfAborted();
      const address = new URL(path, 'http://localhost');
      const rootId = /^\/tiktok\/video\/(\d+)\/comments$/.exec(address.pathname)?.[1];
      const requiredPage = automaticRecovery && !address.pathname.endsWith('/replies');
      const rootPosition = address.searchParams.get('cursor') ?? '0';
      // The batch size can change between launches. Cooldowns identify the
      // page being requested independently of the new run's remaining limit.
      const pageKey = rootId ? address.pathname + '?cursor=' + rootPosition : path;
      const checkpointRoot = () => {
        const video = rootId && rootVideos.get(rootId);
        if (rootsFirst && video) rootBacklog.save(source.id, video, rootPosition);
      };
      if (replayIndex < replayCount && turns[replayIndex].path === path) {
        waiting.set(path, turns[replayIndex++]);
        throw parkVideo;
      }
      const cached = options.journal?.get<T>(path);
      if (cached !== undefined) {
        waiting.delete(path);
        return cached;
      }
      const skipped = options.journal?.get<{ status: number; code: string; message: string }>(
        'unavailable:' + path,
      );
      if (skipped && !(requiredPage && skipped.code === 'TIKTOK_DEFERRED')) {
        waiting.delete(path);
        throw new AppError(skipped.status, skipped.code, skipped.message);
      }
      for (;;) {
        const pause =
          pending?.path === path ? pending : (gate ?? (rootsFirst ? waiting.get(path) : undefined));
        const nextAttempt = Math.max(
          pause ? Date.parse(pause.at) : 0,
          rootsFirst ? rootBacklog.cooldown(source.id, pageKey) : 0,
        );
        let stopCode: string | undefined;
        if (requiredPage && (pause || nextAttempt > Date.now())) {
          if (outage && outage.failures >= maxConsecutiveFailures)
            stopCode = 'TIKTOK_RETRY_EXHAUSTED';
          else if (nextAttempt - (outage?.since ?? Date.now()) > maxOutageMs)
            stopCode = 'TIKTOK_RETRY_TOO_LATE';
        }
        if (
          automaticRecovery &&
          !requiredPage &&
          gate?.sharedCooldown &&
          outage &&
          outage.failures >= maxConsecutiveFailures
        ) {
          stopCode = 'TIKTOK_DEFERRED';
        } else if (nextAttempt > Date.now() && rootsFirst && !requiredPage) {
          const additional = Math.max(
            0,
            nextAttempt - Math.max(Date.now(), waitLedger.reservedUntil),
          );
          if (waitLedger.used + additional > maxRetryWaitMs) {
            stopCode = 'TIKTOK_DEFERRED';
          } else {
            waitLedger.used += additional;
            waitLedger.reservedUntil = Math.max(waitLedger.reservedUntil, nextAttempt);
            options.journal?.put('retry-wait', waitLedger);
          }
        }
        if (options.collectUntil !== undefined) {
          if (Date.now() >= options.collectUntil) throw sampleEnded('TIKTOK_SAMPLE_TIME');
          if (nextAttempt > Date.now()) throw sampleEnded('TIKTOK_SAMPLE_PAUSED');
        }
        if (stopCode) {
          checkpointRoot();
          const message =
            automaticStopReasons[stopCode] ??
            'Оставшиеся страницы сохранены для следующего запуска.';
          options.journal?.put('unavailable:' + path, { status: 503, code: stopCode, message });
          waiting.delete(path);
          retry = undefined;
          throw new AppError(503, stopCode, message, new Date(nextAttempt).toISOString());
        }
        if (nextAttempt > Date.now()) {
          retry = {
            at: new Date(nextAttempt).toISOString(),
            attempt: pause?.attempt ?? 1,
            ...(pause?.probeVideos ? { scope: 'discussions' as const } : {}),
          };
          failedRequest = pause?.failedRequest;
          progress('reading');
          while (Date.now() < nextAttempt)
            await delay(Math.min(nextAttempt - Date.now(), 2_147_483_647), undefined, {
              signal: options.signal,
            });
        }
        retry = undefined;
        failedRequest = undefined;
        if (pause) progress('reading');
        try {
          options.signal.throwIfAborted();
          await options.beforeRequest('data', requestSignal);
          requestSignal.throwIfAborted();
          const result = read(await this.transport.get(path, requestSignal));
          options.journal?.put(path, result);
          if (requiredPage && outage) {
            outage = null;
            options.journal?.put('primary-outage', null);
          }
          waiting.delete(path);
          clearVideoPause();
          if (pending?.path === path) {
            pending = undefined;
            options.journal?.put('retry', null);
          }
          return result;
        } catch (error) {
          options.signal.throwIfAborted();
          if (timeLimit?.aborted) throw sampleEnded('TIKTOK_SAMPLE_TIME');
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
            videoNumber: stage === 'comments' || stage === 'replies' ? videoNumber : undefined,
            upstreamStatus: error instanceof TikTokRequestError ? error.upstreamStatus : undefined,
            responseIssue: error instanceof TikTokRequestError ? error.responseIssue : undefined,
          };
          const attempt = Math.max(
            consecutiveFailures,
            waiting.get(path)?.attempt ?? 0,
            pending?.path === path ? pending.attempt : 0,
          );
          const retryDelay = this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)];
          const temporary =
            error instanceof AppError &&
            ((error.code === 'TIKTOK_BLOCKED' && error.status === 429) ||
              error.code === 'TIKTOK_TIMEOUT' ||
              error.code === 'TIKTOK_UNAVAILABLE' ||
              error.code === 'TIKTOK_COMMENTS_EMPTY');
          const upstreamTime =
            error instanceof AppError && error.retryAt ? Date.parse(error.retryAt) : 0;
          const nextAttempt = Math.max(Date.now() + (retryDelay ?? 0), upstreamTime || 0);
          const isolatedEmpty = rootsFirst && rootId && error instanceof TikTokRequestError &&
            error.responseIssue === 'empty' && (!outage?.videoId || outage.videoId === rootId);
          const shared = error instanceof AppError &&
            ((error.status === 429 && !isolatedEmpty) || upstreamTime > Date.now());
          if (rootsFirst && temporary) {
            checkpointRoot();
            rootBacklog.rememberCooldown(source.id, shared ? '*' : pageKey, nextAttempt);
            if (requiredPage) {
              outage = {
                since: outage?.since ?? Date.now(),
                failures: (outage?.failures ?? 0) + 1,
                videoId: rootId,
              };
              options.journal?.put('primary-outage', outage);
            }
          }
          if (options.collectUntil !== undefined && temporary) {
            if (videoId) rootBacklog.deferVideo(source.id,videoId);
            throw sampleEnded('TIKTOK_SAMPLE_PAUSED');
          }
          if (!temporary || retryDelay === undefined) {
            waiting.delete(path);
            if (
              error instanceof AppError &&
              (stage === 'comments' || stage === 'replies') &&
              ['TIKTOK_CURSOR', 'TIKTOK_DISCUSSION_UNAVAILABLE'].includes(error.code)
            ) {
              options.journal?.put('unavailable:' + path, {
                status: error.status,
                code: error.code,
                message: error.message,
              });
              clearVideoPause();
            }
            retry = undefined;
            progress('reading');
            throw error;
          }
          if (options.requestsRemaining?.() === 0) {
            retry = undefined;
            progress('reading');
            throw new AppError(
              429,
              'REQUEST_BUDGET',
              'Достигнут предел сетевых запросов запуска. Полученные данные сохранены.',
            );
          }
          const failure: PendingPage = {
            path,
            code: error.code,
            failedRequest,
            at: new Date(nextAttempt).toISOString(),
            attempt: attempt + 1,
            ...(rootsFirst ? { sharedCooldown: shared } : {}),
          };
          if (failedRequest.videoNumber) {
            failure.probeVideos = null;
            const previousVideo = gate?.failedRequest?.videoNumber;
            if (
              error.code === 'TIKTOK_BLOCKED' &&
              gate?.code === error.code &&
              previousVideo &&
              previousVideo !== failedRequest.videoNumber
            ) {
              failure.probeVideos = gate.probeVideos ?? [previousVideo, failedRequest.videoNumber];
            }
            turns.push(failure);
            options.journal?.put('video-turns', turns);
            waiting.set(path, failure);
            if (!rootsFirst || shared) {
              consecutiveFailures = failure.attempt;
              gate = failure;
            }
            throw parkVideo;
          }
          pending = failure;
          options.journal?.put('retry', pending);
        }
      }
    };
    async function* videoPage<T>(
      path: string,
      decode: (raw: Record<string, unknown>) => T,
    ): AsyncGenerator<number | undefined, T> {
      for (;;) {
        try {
          return await request(path, decode);
        } catch (error) {
          if (error !== parkVideo) throw error;
          const pair = waiting.get(path)?.probeVideos;
          yield pair ? (videoNumber === pair[0] ? pair[1] : pair[0]) : undefined;
        }
      }
    }
    try {
      const handle = this.handle(
        source.kind === 'video' ? new URL(source.url).pathname.split('/')[1] : source.url,
      );
      let videos: TikTokVideo[];
      const store = this.store;
      // Replay against the starting positions even if a previous process already
      // committed later pages or removed a completed thread from the live queue.
      const savedThreads =
        options.journal?.get<TikTokThread[]>('starting-threads') ?? store.pendingThreads(source.id);
      options.journal?.put('starting-threads', savedThreads);
      const startingThreads = new Map(
        savedThreads.map((task) => [task.video.id + '/' + task.rootId, task]),
      );
      const closed = new Map<string, number>();
      if (rootsFirst && !options.threadsOnly) {
        const snapshot = options.journal?.get<{
          at: number;
          threads: ReturnType<typeof store.closedThreads>;
        }>('starting-closed-threads') ?? {
          at: Date.now(),
          threads: store.closedThreads(source.id),
        };
        options.journal?.put('starting-closed-threads', snapshot);
        for (const item of snapshot.threads) {
          if (snapshot.at - item.checkedAt < 24 * 60 * 60 * 1000)
            closed.set(item.videoId + '/' + item.rootId, item.reportedReplies);
        }
      }
      const managedCatalog = managedToken ? sampleJournal?.get<{videos: TikTokVideo[]; complete: boolean}>('apify-catalog') : undefined;
      const frozen = managedToken ? managedCatalog?.videos : frozenVideos;
      let catalogComplete = managedCatalog?.complete ?? true;
      const catalogRequest: Request = managedToken ? async (path, decode) => {
        await options.beforeRequest('data', requestSignal);
        return decode(await this.transport.get(path, requestSignal));
      } : request;
      if (frozen?.length) {
        videos = frozen;
      } else if (options.threadsOnly) {
        videos = [
          ...new Map(savedThreads.map((task) => [task.video.id, task.video])).values(),
        ].slice(0, options.maxVideos);
        const selectedIds = new Set(videos.map((video) => video.id));
        threadProgress.selected = savedThreads.filter((task) =>
          selectedIds.has(task.video.id),
        ).length;
      } else if (source.kind === 'video') {
        const id = new URL(source.url).pathname.split('/')[3];
        videos = [
          await catalogRequest('/tiktok/video/' + id + '?', (raw) =>
            parseVideo(object(raw.itemInfo).itemStruct, id),
          ),
        ];
      } else {
        try {
          const profile = await this.profile(handle, catalogRequest);
          if (this.source()?.id === source.id && profile.identity.id !== this.value.account?.id)
            throw new AppError(409, 'TIKTOK_PROFILE_CHANGED', 'TikTok вернул другой профиль. Проверьте подключение.');
          const result = await this.videos(
            handle,
            profile.secUid,
            Math.min(tiktokCollectionLimits.videos, options.maxVideos),
            catalogRequest,
          );
          videos = result.videos;
          catalogComplete = result.complete;
          if (!result.complete) notices.push({ code: 'TIKTOK_VIDEO_LIST_INCOMPLETE' });
          if (
            this.value.account?.id === profile.identity.id &&
            options.maxVideos >= this.value.selection.latest
          )
            this.update({ videos, coverage: result.complete ? 'complete' : 'partial' });
        } catch (error) {
          if (!managedToken || !knownVideos.length || requestSignal.aborted ||
              error instanceof AppError && error.code === 'TIKTOK_PROFILE_CHANGED') throw error;
          videos = knownVideos;
          catalogComplete = false;
        }
      }
      if (managedToken) {
        sampleJournal?.put('apify-catalog', {videos, complete: catalogComplete});
        await readApifyComments(source.url, videos, options, managedToken, fetch, catalogComplete);
        return;
      }
      const seen = new Set<string>();
      if ((options.collectUntil || options.continueSample && !frozen?.length) && videos.length)
        sampleJournal?.put('analysis-videos', videos);
      const latest = new Set(videos.map((video) => video.id));
      const resumingSelection = !!(options.continueSample && frozen?.length);
      if (resumingSelection) {
        const needed = new Set([...startingRoots.keys(), ...savedThreads.filter(() => options.replies).map(t => t.video.id)]);
        for (const video of videos) if (!needed.has(video.id)) options.onVideo(video,false);
        videos = videos.filter(v => needed.has(v.id));
        for (const video of frozen ?? videos)
          for (const id of sampleJournal?.get<string[]>('received:' + video.id) ?? []) seen.add(id);
        // Each button press has a fresh total allowance; per-video limits span the selection.
        comments = 0;
      }
      if (rootsFirst && options.comments && !options.threadsOnly && !options.collectUntil && !options.continueSample) {
        const retained = [
          ...Array.from(startingRoots.values(), (root) => root.video),
          ...(options.replies ? savedThreads.map((task) => task.video) : []),
        ];
        const outside = new Map(
          retained.filter((video) => !latest.has(video.id)).map((video) => [video.id, video]),
        );
        const room =
          (options.additionalBacklogVideos ?? 0) + Math.max(0, options.maxVideos - videos.length);
        const additional = [...outside.values()].slice(0, room);
        videos = [...videos, ...additional];
        backlogVideos = additional.length;
      }
      selected = resumingSelection ? frozen!.length : videos.length;
      processed = selected - videos.length;
      const firstRootPages = resumingSelection
        ? new Set(videos.filter(v => startingRoots.has(v.id)).map(v => v.id))
        : new Set(latest);
      for (const video of videos) {
        rootVideos.set(video.id, video);
        if (
          rootsFirst &&
          options.comments &&
          !options.threadsOnly &&
          ((!resumingSelection && latest.has(video.id)) || startingRoots.has(video.id))
        ) {
          unreadRoots.set(video.id, { video, cursor: startingRoots.get(video.id)?.cursor ?? '0' });
          if (options.collectUntil || options.continueSample) rootBacklog.save(source.id, video, unreadRoots.get(video.id)!.cursor);
        }
        options.onVideo(video, !latest.has(video.id));
      }
      progress('reading');
      const replyPhase = Symbol('read saved reply pages');
      const commentPageSize = this.transport.maxCommentPageSize ?? 20;
      async function* collectVideo(video: TikTokVideo) {
        const later = new Map<string, TikTokThread>();
        for (const task of savedThreads) {
          if (task.video.id === video.id && options.replies) later.set(task.rootId, task);
        }
        const track = !!sampleJournal && !!(options.collectUntil || options.continueSample);
        const received = new Set(track ? sampleJournal?.get<string[]>('received:' + video.id) : []);
        let videoComments = options.continueSample ? received.size : 0;
        const receive = (row: Parameters<ReadOptions['onComment']>[0], video: TikTokVideo) => {
          if (seen.has(row.id)) return;
          if (comments >= options.maxComments || videoComments >= commentsPerVideo) return;
          seen.add(row.id);
          comments++;
          videoComments++;
          options.onComment(row, video);
          if (track && !received.has(row.id)) {
            received.add(row.id);
            sampleJournal!.put('received:' + video.id, [...received]);
          }
        };
        options.signal.throwIfAborted();
        if (!options.comments) {
          processed++;
          return;
        }
        if (comments >= options.maxComments) return;
        let unavailable = false;
        let cursor = rootsFirst ? (startingRoots.get(video.id)?.cursor ?? '0') : '0';
        const cursors = new Set<string>();
        const atLimit = () => comments >= options.maxComments || videoComments >= commentsPerVideo;
        async function* readThread(task: TikTokThread) {
          const covered = new Set(task.seen);
          const visited = new Set<string>();
          let position = task.cursor;
          let total = task.total;
          const checkpoint = () =>
            store.saveThread(source.id, { ...task, cursor: position, seen: [...covered], total });
          checkpoint();
          while (!atLimit()) {
            const page = yield* videoPage(
              `/tiktok/video/${video.id}/comments/${task.rootId}/replies?cursor=${encodeURIComponent(position)}`,
              (raw) => ({
                ...parseComments(raw, video.id, task.rootId),
                next: String(raw.cursor ?? ''),
                total: typeof raw.total === 'number' ? raw.total : total,
              }),
            );
            total = Math.max(total, page.total);
            for (const reply of page.items) {
              if (covered.has(reply.id)) continue;
              if (atLimit()) {
                checkpoint();
                return;
              }
              receive(reply, video);
              covered.add(reply.id);
            }
            // The public counter can include replies that are absent from this feed.
            // Some nonempty pages also report has_more=0 while advancing the cursor.
            const publicEnd =
              rootsFirst && !page.hasMore && !page.items.length && page.next === position;
            if (publicEnd || (!page.hasMore && covered.size >= total)) {
              if (publicEnd)
                store.closePublicThread(source.id, task, task.reportedReplies ?? task.total);
              else store.finishThread(source.id, video.id, task.rootId);
              if (options.threadsOnly) threadProgress.completed++;
              return;
            }
            visited.add(position);
            if (!page.items.length || !page.next || page.next === '0' || visited.has(page.next)) {
              checkpoint();
              notices.push({ code: 'TIKTOK_REPLIES_INCOMPLETE', videoId: video.id });
              return;
            }
            position = page.next;
            checkpoint();
          }
        }
        async function* readQueuedThreads() {
          for (const task of later.values()) {
            if (atLimit()) break;
            try {
              yield* readThread(task);
            } catch (error) {
              if (
                !(error instanceof AppError) ||
                !['TIKTOK_CURSOR', 'TIKTOK_DISCUSSION_UNAVAILABLE', 'TIKTOK_DEFERRED'].includes(
                  error.code,
                )
              )
                throw error;
              notices.push({
                code: error.code === 'TIKTOK_DEFERRED' ? 'TIKTOK_DEFERRED_REPLIES' : error.code,
                videoId: video.id,
              });
              failedRequest = undefined;
            }
            progress('reading');
          }
        }
        try {
          if (options.threadsOnly) yield* readQueuedThreads();
          else if ((!resumingSelection && latest.has(video.id)) || startingRoots.has(video.id))
            while (true) {
              if (comments >= options.maxComments || videoComments >= commentsPerVideo) break;
              // In a small sample leave at least one comment for each recent video
              // still awaiting its first page, as far as the user's limit allows.
              const reserve =
                rootsFirst && options.replies
                  ? firstRootPages.size - Number(firstRootPages.has(video.id))
                  : 0;
              const room = Math.max(1, options.maxComments - comments - reserve);
              const pagePath = (size: number) =>
                `/tiktok/video/${video.id}/comments?count=${Math.min(size, commentsPerVideo - videoComments, room)}&cursor=${encodeURIComponent(cursor)}`;
              const legacyPath = pagePath(20);
              // Preserve the original rotation and cached cursors when reopening an older run.
              const replayLegacy = options.journal?.get(legacyPath) !== undefined ||
                turns.some(turn => turn.path === legacyPath);
              const path = replayLegacy ? legacyPath : pagePath(commentPageSize);
              const batch = yield* videoPage(path, (raw) => {
                const page = parseComments(raw, video.id);
                if (
                  !page.items.length &&
                  !page.hasMore &&
                  (video.commentCount ?? 0) > 0 &&
                  cursor === '0'
                ) {
                  if (waiting.get(path)?.code === 'TIKTOK_COMMENTS_EMPTY') return null;
                  throw new AppError(
                    502,
                    'TIKTOK_COMMENTS_EMPTY',
                    'TikTok не выдал тексты комментариев. Полученный результат сохранён.',
                  );
                }
                return page;
              });
              firstRootPages.delete(video.id);
              if (!batch) {
                unavailable = true;
                notices.push({ code: 'TIKTOK_COMMENTS_EMPTY', videoId: video.id });
                break;
              }
              for (const [index, root] of batch.items.entries()) {
                receive(root, video);
                if (options.replies && (root.replyCount ?? 0) > 0) {
                  const key = video.id + '/' + root.id;
                  const existing =
                    (rootsFirst ? later.get(root.id) : undefined) ?? startingThreads.get(key);
                  const task: TikTokThread = existing
                    ? { ...existing, total: Math.max(existing.total, root.replyCount!) }
                    : { video, rootId: root.id, cursor: '0', seen: [], total: root.replyCount! };
                  const firstReplyPath = `/tiktok/video/${video.id}/comments/${root.id}/replies?cursor=0`;
                  const preview = new Map(
                    batch.previews
                      .filter(
                        (reply) =>
                          (reply.threadId ?? reply.parentId) === root.id &&
                          reply.publishedAt &&
                          reply.text.trim(),
                      )
                      .map((reply) => [reply.id, reply]),
                  );
                  // A previously visited or deferred thread must replay its original page sequence.
                  const remaining = Math.min(
                    commentsPerVideo - videoComments,
                    options.maxComments - comments,
                  );
                  const available = [...preview.values()].filter((reply) => !seen.has(reply.id));
                  if (rootsFirst) {
                    task.reportedReplies = root.replyCount;
                    const covered = new Set(task.seen);
                    const before = videoComments;
                    const otherRoots = batch.items.length - index - 1;
                    for (const reply of preview.values()) {
                      if (seen.has(reply.id)) covered.add(reply.id);
                      if (
                        covered.has(reply.id) ||
                        comments + otherRoots + firstRootPages.size >= options.maxComments ||
                        videoComments + otherRoots >= commentsPerVideo
                      )
                        continue;
                      receive(reply, video);
                      covered.add(reply.id);
                    }
                    if (videoComments > before) {
                      inlineReplies.threads++;
                      inlineReplies.comments += videoComments - before;
                    }
                    if (covered.size >= task.total) {
                      later.delete(root.id);
                      store.finishThread(source.id, video.id, root.id);
                    } else if (existing || closed.get(key) !== root.replyCount) {
                      task.seen = [...covered];
                      later.set(root.id, task);
                      store.saveThread(source.id, task);
                    }
                  } else if (
                    !existing &&
                    remaining > 0 &&
                    (preview.size === root.replyCount || available.length >= remaining) &&
                    !options.journal?.get(firstReplyPath) &&
                    !options.journal?.get('unavailable:' + firstReplyPath) &&
                    !turns.some((turn) => turn.path === firstReplyPath)
                  ) {
                    const before = videoComments;
                    const accepted = available.slice(0, remaining);
                    for (const reply of accepted) receive(reply, video);
                    const covered = [...preview.keys()].filter((id) => seen.has(id));
                    if (covered.length < task.total)
                      store.saveThread(source.id, { ...task, seen: covered });
                    else store.finishThread(source.id, video.id, root.id);
                    inlineReplies.threads++;
                    inlineReplies.comments += videoComments - before;
                    continue;
                  } else yield* readThread(task);
                }
                if (comments >= options.maxComments || videoComments >= commentsPerVideo) break;
              }
              progress('reading');
              if (options.collectUntil && comments >= options.maxComments && videoComments < commentsPerVideo) {
                const pageConsumed = batch.items.every(root => seen.has(root.id));
                if (!pageConsumed || batch.hasMore) {
                  const position = pageConsumed && batch.cursor ? batch.cursor : cursor;
                  rootBacklog.save(source.id, video, position);
                  // Other videos were already checkpointed before starting the selection.
                  throw new AppError(409, 'TIKTOK_TOTAL_COMMENT_LIMIT', 'Достигнут лимит комментариев за запуск.');
                }
              }
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
              if (rootsFirst) unreadRoots.set(video.id, { video, cursor });
              if (options.collectUntil || options.continueSample) rootBacklog.save(source.id, video, cursor);
              if (rootsFirst && options.replies) yield undefined;
            }
        } catch (error) {
          options.signal.throwIfAborted();
          if (
            !(error instanceof AppError) ||
            (!['TIKTOK_CURSOR', 'TIKTOK_DISCUSSION_UNAVAILABLE', 'TIKTOK_DEFERRED'].includes(
              error.code,
            ) &&
              !Object.hasOwn(automaticStopReasons, error.code))
          )
            throw error;
          if (error.code === 'TIKTOK_SAMPLE_TIME' || error.code === 'TIKTOK_SAMPLE_PAUSED') throw error;
          unavailable = true;
          notices.push({ code: error.code, videoId: video.id });
          failedRequest = undefined;
          pending = undefined;
        }
        firstRootPages.delete(video.id);
        unreadRoots.delete(video.id);
        if (!unavailable) {
          processed++;
          if (options.collectUntil) rootBacklog.clearDeferral(source.id,video.id);
        }
        if (rootsFirst && !options.threadsOnly) {
          if (!unavailable) rootBacklog.finish(source.id, video.id);
          if (later.size && !atLimit() && !(options.collectUntil && unavailable)) {
            progress('reading');
            yield replyPhase;
            yield* readQueuedThreads();
          }
        }
        if (videoComments >= commentsPerVideo) {
          limitedVideos++;
          notices.push({ code: 'TIKTOK_PER_VIDEO_LIMIT', videoId: video.id, count: videoComments });
        }
        progress('reading');
      }
      const queue = videos.map((video, index) => ({
        number: index + 1,
        thread: collectVideo(video),
      }));
      if (rootsFirst && !options.threadsOnly && startingRoots.size) {
        // With a small request limit, refreshing completed videos first can
        // repeatedly spend the whole run before the oldest unfinished page.
        const order = new Map(savedRoots.map((task, index) => [task.video.id, index]));
        const rank = (number: number) => order.get(videos[number - 1].id) ?? order.size;
        queue.sort((a, b) => rank(a.number) - rank(b.number));
      }
      if (options.collectUntil && Object.keys(deferredVideos).length) {
        const lastDeferral = (number: number) => deferredVideos[videos[number - 1].id] ?? 0;
        queue.sort((a,b) => lastDeferral(a.number) - lastDeferral(b.number));
      }
      const replies: typeof queue = [];
      while (
        (queue.length || replies.length) &&
        (!options.comments || comments < options.maxComments)
      ) {
        if (!queue.length) queue.push(...replies.splice(0));
        if (rootsFirst && replayIndex >= replayCount && !gate && waiting.size && queue.length > 1) {
          const due = new Map<number, number>();
          for (const page of waiting.values()) {
            const number = page.failedRequest?.videoNumber;
            if (number) due.set(number, Date.parse(page.at));
          }
          const now = Date.now();
          const readyAt = (number: number) => Math.max(now, due.get(number) ?? 0);
          const first = queue.reduce((a, b) => readyAt(a.number) <= readyAt(b.number) ? a : b);
          if (first !== queue[0]) queue.unshift(queue.splice(queue.indexOf(first), 1)[0]);
        }
        const next = queue.shift()!;
        videoNumber = next.number;
        const step = await next.thread.next();
        if (!step.done) {
          if (step.value === replyPhase) {
            replies.push(next);
            continue;
          }
          queue.push(next);
          if (step.value !== undefined) {
            const index = queue.findIndex((entry) => entry.number === step.value);
            if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
          }
        }
      }
      const queuedRemaining = threadProgress.selected - threadProgress.completed;
      const summary = options.threadsOnly
        ? `Дочитано веток: ${threadProgress.completed} из ${threadProgress.selected}.`
        : `Обработано ${processed} из ${selected} роликов.`;
      const overall =
        options.comments &&
        comments >= options.maxComments &&
        (!options.threadsOnly || queuedRemaining > 0);
      const missing = notices.filter((notice) => notice.code === 'TIKTOK_REPLIES_INCOMPLETE');
      const empty = notices.filter((notice) => notice.code === 'TIKTOK_COMMENTS_EMPTY');
      const skipped = notices.filter(
        (notice) =>
          notice.code === 'TIKTOK_CURSOR' || notice.code === 'TIKTOK_DISCUSSION_UNAVAILABLE',
      );
      const delayedRoots = notices.filter(
        (notice) =>
          notice.code === 'TIKTOK_DEFERRED' || Object.hasOwn(automaticStopReasons, notice.code),
      );
      const delayedReplies = notices.filter((notice) => notice.code === 'TIKTOK_DEFERRED_REPLIES');
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
        ...(empty.length ? [`Роликов с недоступными комментариями: ${empty.length}.`] : []),
        ...(skipped.length ? [`Не удалось дочитать обсуждения: ${skipped.length}.`] : []),
        ...(delayedRoots.length
          ? [
              automaticStopReasons[delayedRoots[0].code] ??
                `Роликов с отложенным сбором комментариев: ${delayedRoots.length}.`,
            ]
          : []),
        ...(delayedReplies.length ? [`Отложено веток с ответами: ${delayedReplies.length}.`] : []),
      ];
      const code = overall
        ? 'TIKTOK_TOTAL_COMMENT_LIMIT'
        : delayedRoots.length
          ? delayedRoots[0].code
          : empty.length
            ? 'TIKTOK_COMMENTS_EMPTY'
            : skipped.length
              ? skipped[0].code
              : missing.length
                ? 'TIKTOK_REPLIES_INCOMPLETE'
                : listIncomplete
                  ? 'TIKTOK_VIDEO_LIST_INCOMPLETE'
                  : delayedReplies.length
                    ? 'TIKTOK_DEFERRED_REPLIES'
                    : limitedVideos
                      ? 'TIKTOK_PER_VIDEO_LIMIT'
                      : undefined;
      const incomplete =
        overall ||
        queuedRemaining > 0 ||
        missing.length > 0 ||
        listIncomplete ||
        empty.length > 0 ||
        delayedRoots.length > 0 ||
        skipped.length > 0;
      progress(incomplete ? 'limited' : 'completed', [summary, ...reasons].join(' '), code);
    } catch (error) {
      if (options.collectUntil && error instanceof AppError &&
          ['TIKTOK_TOTAL_COMMENT_LIMIT', 'REQUEST_BUDGET'].includes(error.code)) {
        progress('limited', error.message, error.code);
        return;
      }
      if (rootsFirst && error instanceof AppError && error.code === 'REQUEST_BUDGET') {
        for (const { video, cursor } of unreadRoots.values())
          rootBacklog.save(source.id, video, cursor);
      }
      // A catalog request can meet a cooldown saved by an earlier manual run
      // before any videos can be selected. No upstream request is warranted.
      if (
        !(error instanceof AppError) ||
        (error.code !== 'TIKTOK_DEFERRED' && !Object.hasOwn(automaticStopReasons, error.code))
      )
        throw error;
      if (options.collectUntil && !selected && knownVideos.length) {
        if (knownVideos.length >= options.maxVideos ||
            (this.value.coverage === 'complete' && knownVideos.length < this.value.selection.latest))
          sampleJournal?.put('analysis-videos', knownVideos);
        for (const video of knownVideos) {
          options.onVideo(video);
          rootBacklog.save(source.id, video, startingRoots.get(video.id)?.cursor ?? '0');
        }
        selected = knownVideos.length;
        notices.push({ code: 'TIKTOK_SAVED_CATALOG' });
      }
      progress(
        'limited',
        automaticStopReasons[error.code] ??
          'TikTok временно недоступен. Цех продолжит сбор при следующем запуске.',
        error.code,
      );
    } finally {
      this.reading = false;
    }
  }
}
