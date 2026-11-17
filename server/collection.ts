import { setTimeout as delay } from 'node:timers/promises';
import {
  buildCollectionPlan,
  migrateConfiguration,
} from '../src/features/sources/collection-policy.ts';
import {
  parseSource,
  type AnalysisSource,
  type SourceConfiguration,
} from '../src/features/sources/model.ts';
import type { CollectionRun, CollectedRecord } from '../src/features/collection/contracts.ts';
import { LocalStore } from './store.ts';
import { TelegramAccount } from './telegram-account.ts';
import { AppError, telegramError } from './errors.ts';
import type { Gateway, Peer, TelegramMessage } from './telegram.ts';
import { PublicTikTokReader } from './tiktok/reader.ts';
import type { TikTokReaderFactory } from './tiktok/contracts.ts';
import { analyzeIdeas } from './idea-analysis.ts';

export const ideaAnalysisVersion = 7;

export const runModes = [
  'cycle',
  'telegram',
  'tiktok',
  'comments',
  'collector',
  'ideas',
  'materials',
  'analytics',
  'orchestrator',
] as const;
export type RunMode = (typeof runModes)[number];

export function readConfiguration(input: unknown): SourceConfiguration {
  if (!input || typeof input !== 'object')
    throw new AppError(400, 'CONFIGURATION', 'Передайте настройки источников.');
  const value = input as SourceConfiguration;
  if (!Array.isArray(value.sources) || value.sources.length > 200)
    throw new AppError(400, 'SOURCES', 'Допускается до 200 источников.');
  const ids = new Set<string>();
  const sources = value.sources.map((source) => {
    if (
      !source ||
      typeof source.id !== 'string' ||
      !source.id ||
      source.id.length > 100 ||
      ids.has(source.id) ||
      typeof source.title !== 'string' ||
      !source.title.trim() ||
      source.title.length > 100 ||
      !['telegram', 'tiktok'].includes(source.platform) ||
      typeof source.url !== 'string' ||
      source.url.length > 2048 ||
      typeof source.enabled !== 'boolean' ||
      !['own', 'inspiration'].includes(source.purpose) ||
      !(
        source.accountId === null ||
        (typeof source.accountId === 'string' && source.accountId.length <= 100)
      )
    )
      throw new AppError(400, 'SOURCE_INVALID', 'Проверьте параметры источника.');
    ids.add(source.id);
    const parsed = parseSource(source.url, source.platform);
    if (source.kind !== parsed.kind)
      throw new AppError(400, 'SOURCE_KIND', 'Формат источника не соответствует ссылке.');
    return {
      id: source.id,
      title: source.title.trim(),
      platform: source.platform,
      url: parsed.url,
      kind: parsed.kind,
      enabled: source.enabled,
      purpose: source.purpose,
      accountId: source.accountId,
      createdAt: source.createdAt,
    };
  });
  return migrateConfiguration({ ...value, sources });
}

export class CollectionEngine {
  private current: { id: string; control: AbortController; promise: Promise<void> } | null = null;
  constructor(
    private store: LocalStore,
    private account: TelegramAccount,
    private interval = 1000,
    private readerFactory: TikTokReaderFactory = () => new PublicTikTokReader(),
  ) {
    for (const run of store.legacyIdeaRuns(ideaAnalysisVersion)) {
      this.analyze(run);
      store.replaceRunIdeas(run);
    }
  }
  get busy() {
    return !!this.current;
  }
  async start(id: string, mode: RunMode, config: SourceConfiguration) {
    const existing = this.store.run(id);
    if (existing) return existing;
    if (this.current)
      throw new AppError(409, 'RUN_ACTIVE', 'Сбор уже выполняется. Откройте текущий запуск.');
    if (this.account.isBusy)
      throw new AppError(409, 'AUTH_BUSY', 'Дождитесь завершения подключения аккаунта.');
    if (mode === 'analytics')
      throw new AppError(
        409,
        'ANALYTICS_UNAVAILABLE',
        'Статистика TikTok обновляется на странице «Аналитика».',
      );
    const collect = mode === 'cycle' || mode === 'telegram' || mode === 'tiktok';
    if (
      collect &&
      !config.sources.some(
        (source) => source.enabled && (mode === 'cycle' || source.platform === mode),
      )
    )
      throw new AppError(
        400,
        'NO_SOURCES',
        mode === 'tiktok'
          ? 'Выберите хотя бы один источник TikTok.'
          : 'Выберите хотя бы один источник Telegram или TikTok.',
      );
    if (mode === 'telegram' && !this.account.accounts().some((item) => item.status === 'connected'))
      throw new AppError(409, 'ACCOUNT_REQUIRED', 'Подключите аккаунт Telegram в источниках.');
    const previous = this.store.latest();
    if (!collect && (!previous || previous.counts.posts + previous.counts.comments === 0))
      throw new AppError(409, 'NO_RECORDS', 'Сначала соберите данные участка Telegram или TikTok.');
    const now = new Date().toISOString();
    const run: CollectionRun = {
      id,
      status: 'running',
      active: collect
        ? mode === 'cycle'
          ? (config.sources.find((source) => source.enabled)?.platform ?? null)
          : mode
        : mode,
      done: [],
      steps: {},
      skipped: [
        'analytics',
        ...(['telegram', 'tiktok'] as const).filter(
          (platform) =>
            !config.sources.some(
              (source) =>
                source.enabled &&
                source.platform === platform &&
                (mode === 'cycle' || mode === platform),
            ),
        ),
      ],
      events: [],
      counts: { posts: 0, comments: 0, requests: 0, ideas: 0 },
      startedAt: now,
      updatedAt: now,
      ideas: [],
      failures: {},
      sources: {},
      parameters: {
        limits: { ...config.runLimits },
        ...(config.platforms.tiktok.commentsPerVideo === undefined
          ? {}
          : {
              tiktok: {
                latestVideos:
                  config.platforms.tiktok.custom?.maxPublications ??
                  config.settings.maxPublications,
                commentsPerVideo: config.platforms.tiktok.commentsPerVideo,
              },
            }),
      },
    };
    this.store.saveRun(run);
    const control = new AbortController();
    const current = { id, control, promise: Promise.resolve() };
    this.current = current;
    current.promise = this.execute(run, mode, config, previous, control.signal).finally(() => {
      if (this.current === current) this.current = null;
    });
    return this.store.run(id)!;
  }
  cancel(id: string) {
    if (this.current?.id === id) this.current.control.abort();
    return this.store.run(id);
  }
  async close() {
    this.current?.control.abort();
    await this.current?.promise;
  }
  private update(run: CollectionRun, event?: string) {
    if (event) run.events = [event, ...run.events].slice(0, 20);
    this.store.saveRun(run);
  }
  private stage(run: CollectionRun, id: string, step = 0) {
    run.active = id;
    run.steps[id] = step;
    this.update(run);
  }
  private done(run: CollectionRun, id: string) {
    run.steps[id] = 4;
    if (!run.done.includes(id)) run.done.push(id);
    const names: Record<string, string> = {
      telegram: 'Telegram',
      comments: 'Комментарии',
      collector: 'Сбор',
      ideas: 'Темы',
      materials: 'Материалы',
      orchestrator: 'Ядро',
      analytics: 'Аналитика',
    };
    this.update(run, `${names[id] ?? id} / завершено`);
  }
  private async execute(
    run: CollectionRun,
    mode: RunMode,
    config: SourceConfiguration,
    previous: CollectionRun | null,
    signal: AbortSignal,
  ) {
    const budget = { publications: 0, comments: 0 };
    try {
      if (mode === 'cycle' || mode === 'telegram' || mode === 'tiktok') {
        const providers = (['telegram', 'tiktok'] as const).filter((platform) =>
          config.sources.some(
            (source) =>
              source.enabled &&
              source.platform === platform &&
              (mode === 'cycle' || mode === platform),
          ),
        );
        let nextRequest = 0;
        const consume = async (pace = true) => {
          signal.throwIfAborted();
          if (run.counts.requests >= config.runLimits.maxRequests)
            throw new AppError(
              429,
              'REQUEST_BUDGET',
              'Достигнут предел сетевых запросов запуска. Полученные данные сохранены.',
            );
          run.counts.requests++;
          this.update(run);
          if (pace) {
            const at = Math.max(nextRequest, Date.now());
            nextRequest = at + this.interval;
            await delay(Math.max(0, at - Date.now()), undefined, { signal });
          }
        };
        for (const provider of providers) {
          signal.throwIfAborted();
          this.stage(run, provider);
          let gateway: Gateway | undefined;
          try {
            if (provider === 'telegram') {
              gateway = await this.account.connected();
              gateway.beforeRequest = () => consume();
              await this.collect(run, config, gateway, signal, budget);
            } else {
              await this.collectTikTok(run, config, signal, budget, (kind) =>
                consume(kind === 'data'),
              );
              if (!run.failures?.tiktok) this.done(run, 'tiktok');
            }
          } catch (error) {
            if (signal.aborted) throw error;
            if (provider === 'telegram') this.account.recordError(error);
            const mapped =
              provider === 'telegram'
                ? telegramError(error)
                : error instanceof AppError
                  ? error
                  : new AppError(502, 'TIKTOK_UNAVAILABLE', 'Не удалось прочитать данные TikTok.');
            run.failures ??= {};
            run.failures[provider] = mapped.message;
            run.retryAt = mapped.retryAt;
            this.update(run, mapped.message);
          } finally {
            if (gateway) gateway.beforeRequest = undefined;
          }
        }
        const problems = Object.values(run.failures ?? {});
        if (problems.length) {
          run.error = [...new Set(problems)].join(' ');
          run.done = run.done.filter((id) => id !== 'comments');
        } else this.done(run, 'comments');
        if (problems.length && !run.counts.posts && !run.counts.comments) {
          run.status = 'failed';
          run.finishedAt = new Date().toISOString();
          this.update(run);
          return;
        }
      } else if (previous) {
        for (let offset = 0; ; offset += 200) {
          signal.throwIfAborted();
          const records = this.store.records(previous.id, offset, 200);
          if (!records.length) break;
          for (const record of records)
            if (this.store.addRecord(run.id, record))
              run.counts[record.kind === 'post' ? 'posts' : 'comments']++;
        }
        this.update(run, 'Используются сохранённые данные, без нового обращения к площадкам');
      }
      signal.throwIfAborted();
      const stages =
        mode === 'cycle' || mode === 'tiktok'
          ? ['collector', 'ideas', 'materials']
          : mode === 'telegram'
            ? []
            : mode === 'orchestrator'
              ? ['collector', 'ideas', 'materials']
              : [mode];
      for (const stage of stages) {
        this.stage(run, stage);
        if (
          (stage === 'ideas' || stage === 'materials') &&
          run.ideaAnalysisVersion !== ideaAnalysisVersion
        )
          this.analyze(run);
        signal.throwIfAborted();
        this.done(run, stage);
      }
      this.stage(run, 'orchestrator');
      this.done(run, 'orchestrator');
      run.active = null;
      run.status = run.error ? 'partial' : 'completed';
      run.finishedAt = new Date().toISOString();
      this.update(run);
    } catch (error) {
      const mapped =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              'COLLECTION_ERROR',
              'Не удалось завершить обработку. Полученные записи сохранены.',
            );
      run.status = signal.aborted
        ? 'cancelled'
        : run.counts.posts || run.counts.comments
          ? 'partial'
          : 'failed';
      run.error = signal.aborted ? 'Сбор остановлен. Полученные данные сохранены.' : mapped.message;
      run.retryAt = mapped.retryAt;
      run.finishedAt = new Date().toISOString();
      for (const source of Object.values(run.sources ?? {}))
        if (source.status === 'reading') {
          source.status = signal.aborted ? 'cancelled' : 'failed';
          source.reason = run.error;
          source.updatedAt = new Date().toISOString();
        }
      this.update(run, run.error);
    }
  }
  private async collectTikTok(
    run: CollectionRun,
    config: SourceConfiguration,
    signal: AbortSignal,
    budget: { publications: number; comments: number },
    beforeRequest: (kind: 'data' | 'resource') => Promise<void>,
  ) {
    const selected = config.sources.filter(
      (source) => source.enabled && source.platform === 'tiktok',
    );
    const plan = buildCollectionPlan(
      { ...config, sources: selected },
      {
        at: run.startedAt,
        access: selected.map((source) => ({
          sourceId: source.id,
          platform: 'tiktok',
          connectorId: 'tiktok-public-browser:1',
          accountId: source.accountId,
          status: 'ready',
          capabilities: [
            'publicationText',
            'publicationDates',
            'comments',
            'commentDates',
            'replies',
            'publicMetrics',
            'commentLikes',
          ],
          commentOrders: ['platform'],
        })),
      },
    );
    if (plan.status !== 'ready')
      throw new AppError(
        400,
        'PLAN_BLOCKED',
        plan.issues[0]?.message ?? 'Выбранные лимиты не позволяют собирать TikTok.',
      );
    for (const job of plan.jobs) {
      signal.throwIfAborted();
      const source = job.source;
      const maxVideos = Math.min(
        job.limits.publications,
        config.runLimits.maxPublications - budget.publications,
      );
      const maxComments = Math.min(
        job.limits.comments,
        config.runLimits.maxComments - budget.comments,
      );
      if (maxVideos <= 0) {
        run.failures ??= {};
        run.failures.tiktok = 'Достигнут общий предел публикаций запуска.';
        break;
      }
      run.sources ??= {};
      run.sources[source.id] = {
        platform: 'tiktok',
        status: 'reading',
        url: source.url,
        comments: 0,
        updatedAt: new Date().toISOString(),
      };
      this.update(run);
      let saved = 0,
        unknownDates = false;
      try {
        await this.readerFactory().read(source, {
          signal,
          maxVideos,
          maxComments,
          commentsPerVideo: config.platforms.tiktok.commentsPerVideo,
          replies: job.options.includeReplies,
          comments: job.outputs.comments,
          since: job.window.since,
          beforeRequest,
          onVideo: (video) => {
            run.steps.tiktok = 1;
            budget.publications++;
            if (
              !video.publishedAt ||
              (config.platforms.tiktok.commentsPerVideo === undefined &&
                video.publishedAt < job.window.since) ||
              video.publishedAt > job.window.until ||
              (!job.outputs.publications && job.outputs.metrics === 'none')
            )
              return;
            const record: CollectedRecord = {
              id: 'tiktok:video:' + video.id,
              platform: 'tiktok',
              kind: 'post',
              videoId: video.id,
              publicationId: 'tiktok:video:' + video.id,
              sourceId: source.id,
              text: job.outputs.publications ? video.text : '',
              url: video.url,
              publishedAt: video.publishedAt,
              purpose: source.purpose,
              ...(job.outputs.metrics !== 'none' ? { metrics: video.metrics } : {}),
            };
            if (this.store.addRecord(run.id, record)) run.counts.posts++;
            this.update(run);
          },
          onComment: (comment, video) => {
            run.steps.tiktok = 2;
            if (budget.comments >= config.runLimits.maxComments) return;
            budget.comments++;
            if (!comment.publishedAt) {
              unknownDates = true;
              return;
            }
            if (
              comment.publishedAt < job.window.since ||
              comment.publishedAt > job.window.until ||
              (job.options.minLikes > 0 &&
                (comment.likes === undefined || comment.likes < job.options.minLikes))
            )
              return;
            const record: CollectedRecord = {
              id: 'tiktok:comment:' + comment.id,
              platform: 'tiktok',
              kind: 'comment',
              videoId: video.id,
              commentId: comment.id,
              publicationId: 'tiktok:video:' + video.id,
              parentId: comment.parentId ? 'tiktok:comment:' + comment.parentId : undefined,
              sourceId: source.id,
              text: comment.text,
              url: video.url + '?comment_id=' + comment.id,
              publishedAt: comment.publishedAt,
              purpose: source.purpose,
              metrics: comment.likes === undefined ? undefined : { likes: comment.likes },
            };
            if (this.store.addRecord(run.id, record)) {
              run.counts.comments++;
              saved++;
            }
            this.update(run);
          },
          onProgress: (progress) => {
            run.sources![source.id] = {
              ...progress,
              url: source.url,
              expectedComments: source.kind === 'video' ? progress.expectedComments : undefined,
              comments: saved,
              platform: 'tiktok',
              updatedAt: new Date().toISOString(),
            };
            if (progress.status === 'limited') {
              run.failures ??= {};
              run.failures.tiktok = progress.reason ?? 'TikTok выдал часть комментариев.';
            }
            this.update(run);
          },
        });
        if (maxVideos < job.limits.publications) {
          run.failures ??= {};
          run.failures.tiktok = 'Достигнут общий предел публикаций запуска.';
          run.sources![source.id].status = 'limited';
          run.sources![source.id].stopCode = 'TIKTOK_TOTAL_VIDEO_LIMIT';
          run.sources![source.id].reason = run.failures.tiktok;
          this.update(run);
        }
        if (unknownDates) {
          run.failures ??= {};
          run.failures.tiktok =
            'У части комментариев TikTok нет проверяемой даты. Они исключены из выбранного периода.';
          run.sources![source.id].status = 'limited';
          run.sources![source.id].reason = run.failures.tiktok;
          this.update(run);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        const mapped =
          error instanceof AppError
            ? error
            : new AppError(502, 'TIKTOK_UNAVAILABLE', 'Не удалось прочитать TikTok.');
        run.failures ??= {};
        run.failures.tiktok = mapped.message;
        run.sources![source.id] = {
          ...run.sources![source.id],
          comments: saved,
          status:
            mapped.code === 'TIKTOK_AGE_REQUIRED'
              ? 'confirmation_required'
              : mapped.code === 'TIKTOK_LOGIN_REQUIRED'
                ? 'login_required'
                : mapped.code === 'TIKTOK_BLOCKED'
                  ? 'blocked'
                  : 'failed',
          reason: mapped.message,
          stopCode: mapped.code,
          updatedAt: new Date().toISOString(),
        };
        this.update(run, mapped.message);
        if (
          mapped.status === 429 ||
          ['TIKTOK_LOGIN_REQUIRED', 'TIKTOK_AGE_REQUIRED', 'TIKTOK_BLOCKED'].includes(mapped.code)
        )
          break;
      }
    }
  }
  private async collect(
    run: CollectionRun,
    config: SourceConfiguration,
    gateway: Gateway,
    signal: AbortSignal,
    budget: { publications: number; comments: number },
  ) {
    const selected = config.sources.filter(
      (source) => source.enabled && source.platform === 'telegram',
    );
    const peers = new Map<string, Peer>();
    for (const source of selected) {
      signal.throwIfAborted();
      peers.set(source.id, await gateway.resolve(source, signal));
    }
    const accountId = this.account.accounts()[0].id;
    const plan = buildCollectionPlan(
      { ...config, sources: selected },
      {
        at: run.startedAt,
        access: selected.map((source) => ({
          sourceId: source.id,
          platform: 'telegram',
          connectorId: 'teleproto:1.233.0',
          accountId,
          status: 'ready',
          capabilities: [
            'publicationText',
            'publicationDates',
            'comments',
            'commentDates',
            'replies',
            'publicMetrics',
            'forwardedMetadata',
          ],
          commentOrders: ['platform'],
        })),
      },
    );
    if (plan.status !== 'ready')
      throw new AppError(
        400,
        'PLAN_BLOCKED',
        plan.issues[0]?.message ?? 'Выбранные лимиты не позволяют собирать данные.',
      );
    const candidates: {
      source: AnalysisSource;
      peer: Peer;
      post: TelegramMessage;
      job: (typeof plan.jobs)[number];
    }[] = [];
    this.stage(run, 'telegram', 1);
    for (const job of plan.jobs) {
      const source = job.source;
      const target = peers.get(source.id)!;
      const since = Date.parse(job.window.since) / 1000,
        until = Date.parse(job.window.until) / 1000;
      let offset = 0,
        sourcePosts = 0;
      const single = source.kind === 'publication';
      while (
        sourcePosts < job.limits.publications &&
        budget.publications < config.runLimits.maxPublications
      ) {
        signal.throwIfAborted();
        const limit = Math.min(
          100,
          job.limits.publications - sourcePosts,
          config.runLimits.maxPublications - budget.publications,
        );
        const singlePost = single
          ? await gateway.post(
              target,
              Number(new URL(source.url).pathname.split('/').at(-1)),
              signal,
            )
          : null;
        const page = single
          ? { items: singlePost ? [singlePost] : [], count: 1, cursor: 0 }
          : await gateway.posts(target, offset, Math.floor(until) + 1, limit, signal);
        if (!page.count) break;
        sourcePosts += page.count;
        budget.publications += page.count;
        for (const post of page.items.slice(0, limit)) {
          const key = `${target.id}:${post.id}`;
          if (post.date > until || (post.forwarded && !job.options.includeForwarded)) continue;
          if (post.date < since && !single) continue;
          const publicationId = `telegram:${key}`;
          const url = `https://t.me/${target.username ?? `c/${target.channelId}`}/${post.id}`;
          if ((job.outputs.publications || job.outputs.metrics !== 'none') && post.date >= since) {
            const record: CollectedRecord = {
              id: publicationId,
              platform: 'telegram',
              kind: 'post',
              sourceId: source.id,
              peerId: target.id,
              messageId: post.id,
              publicationId,
              text: job.outputs.publications ? post.text : '',
              url,
              publishedAt: new Date(post.date * 1000).toISOString(),
              purpose: source.purpose,
              ...(job.outputs.metrics !== 'none' ? { metrics: post.metrics } : {}),
            };
            if (this.store.addRecord(run.id, record)) run.counts.posts++;
          }
          if (job.outputs.comments && post.commentCount > 0)
            candidates.push({ source, peer: target, post, job });
        }
        this.update(run, `${source.title}: сохранено публикаций ${run.counts.posts}`);
        if (single || (page.items.length > 0 && page.items.every((post) => post.date < since)))
          break;
        if (!page.cursor || page.cursor === offset)
          throw new AppError(
            502,
            'PAGINATION_STALLED',
            'Telegram не вернул следующую страницу публикаций. Сохранённые записи доступны.',
          );
        offset = page.cursor;
      }
    }
    this.done(run, 'telegram');
    this.stage(run, 'comments', 1);
    const sourceComments = new Map<string, number>();
    for (const candidate of candidates) {
      const { source, peer: target, post, job } = candidate;
      if (
        budget.comments >= config.runLimits.maxComments ||
        (sourceComments.get(source.id) ?? 0) >= job.limits.comments
      )
        continue;
      signal.throwIfAborted();
      const discussion = await gateway.discussion(target, post.id, signal);
      if (!discussion)
        throw new AppError(
          400,
          'DISCUSSION_UNAVAILABLE',
          `Не удалось открыть обсуждение публикации «${source.title}».`,
        );
      let offset = 0;
      const since = Date.parse(job.window.since) / 1000,
        until = Date.parse(job.window.until) / 1000;
      while (
        budget.comments < config.runLimits.maxComments &&
        (sourceComments.get(source.id) ?? 0) < job.limits.comments
      ) {
        const limit = Math.min(
          100,
          config.runLimits.maxComments - budget.comments,
          job.limits.comments - (sourceComments.get(source.id) ?? 0),
        );
        const page = await gateway.comments(
          discussion.peer,
          discussion.root,
          offset,
          Math.floor(until) + 1,
          limit,
          signal,
        );
        if (!page.count) break;
        sourceComments.set(source.id, (sourceComments.get(source.id) ?? 0) + page.count);
        budget.comments += page.count;
        for (const reply of page.items.slice(0, limit)) {
          const id = `telegram:${discussion.peer.id}:${reply.id}`;
          if (
            reply.id === discussion.root ||
            reply.date < since ||
            reply.date > until ||
            (!job.options.includeReplies && reply.replyTo !== discussion.root) ||
            reply.text.trim().length < job.options.minLength
          )
            continue;
          const publicationId = `telegram:${target.id}:${post.id}`;
          const record: CollectedRecord = {
            id,
            platform: 'telegram',
            kind: 'comment',
            sourceId: source.id,
            peerId: discussion.peer.id,
            messageId: reply.id,
            publicationId,
            parentId:
              reply.replyTo && reply.replyTo !== discussion.root
                ? `telegram:${discussion.peer.id}:${reply.replyTo}`
                : undefined,
            text: reply.text,
            url: `https://t.me/${target.username ?? `c/${target.channelId}`}/${post.id}?comment=${reply.id}`,
            publishedAt: new Date(reply.date * 1000).toISOString(),
            purpose: source.purpose,
          };
          if (this.store.addRecord(run.id, record)) run.counts.comments++;
        }
        this.update(run, `${source.title}: сохранено комментариев ${run.counts.comments}`);
        if (page.items.length > 0 && page.items.every((item) => item.date < since)) break;
        if (!page.cursor || page.cursor === offset)
          throw new AppError(
            502,
            'PAGINATION_STALLED',
            'Telegram не вернул следующую страницу комментариев. Сохранённые записи доступны.',
          );
        offset = page.cursor;
      }
    }
    this.done(run, 'comments');
  }
  private *analysisRecords(runId: string) {
    for (let offset = 0; ; offset += 200) {
      const records = this.store.records(runId, offset, 200);
      if (!records.length) break;
      yield* records;
    }
  }
  private analyze(run: CollectionRun) {
    run.ideas = analyzeIdeas(this.analysisRecords(run.id));
    run.counts.ideas = run.ideas.length;
    run.ideaAnalysisVersion = ideaAnalysisVersion;
  }

  reviewedIdeas() {
    return { version: ideaAnalysisVersion, ideas: analyzeIdeas(this.store.collectedRecords()) };
  }
}
