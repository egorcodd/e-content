import { estimateAnalysisCost } from './analysis-cost.ts';
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
import type {
  CollectionRun,
  CollectedRecord,
  FoundIdea,
} from '../src/features/collection/contracts.ts';
import { LocalStore, unfinishedTikTokSource, type TikTokJob } from './store.ts';
import { TelegramAccount } from './telegram-account.ts';
import { AppError, telegramError } from './errors.ts';
import type { Gateway, Peer, TelegramMessage } from './telegram.ts';
import { PublicTikTokReader } from './tiktok/reader.ts';
import type { TikTokReaderFactory } from './tiktok/contracts.ts';
import { analyzeIdeas } from './idea-analysis.ts';
import type { AiIdeaAnalysis } from './ai-ideas.ts';

export const ideaAnalysisVersion = 8;

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

function tiktokPlan(config: SourceConfiguration, at: string) {
  const sources = config.sources.filter((source) => source.enabled && source.platform === 'tiktok');
  const plan = buildCollectionPlan(
    { ...config, sources },
    {
      at,
      access: sources.map((source) => ({
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
  if (plan.status === 'empty')
    throw new AppError(
      400,
      'PLAN_BLOCKED',
      !config.runLimits.maxPublications || !config.runLimits.maxRequests
        ? 'Разрешите публикации и запросы в общих лимитах запуска.'
        : 'Выберите данные для сбора TikTok и проверьте их лимиты.',
    );
  if (plan.status === 'blocked') throw new AppError(400, 'PLAN_BLOCKED', plan.issues[0].message);
  return plan;
}

export class CollectionEngine {
  private readonly shutdown = Symbol('server shutdown');
  private durableId?: string;
  private current: { id: string; control: AbortController; promise: Promise<void> } | null = null;
  constructor(
    private store: LocalStore,
    private account: TelegramAccount,
    private interval = 1000,
    private readerFactory: TikTokReaderFactory = () => new PublicTikTokReader(),
    private durableTikTok = false,
    private ai?: AiIdeaAnalysis,
    private services?: {
      analytics?: (run: CollectionRun, config: SourceConfiguration, signal: AbortSignal) => Promise<void>;
    },
  ) {
    for (const run of store.legacyIdeaRuns(ideaAnalysisVersion)) {
      this.analyze(run);
    }
  }
  get busy() {
    return !!this.current;
  }
  resumePending() {
    if (this.current) return;
    const results = this.store.db.prepare("SELECT run_id,mode,config FROM result_jobs JOIN runs ON runs.id=run_id WHERE json_extract(body,'$.status')='running' LIMIT 1").get();
    if (results) {
      this.launch(this.store.run(String(results.run_id),false)!,results.mode as RunMode,JSON.parse(String(results.config)),null,undefined,true);
      return;
    }
    const pending = this.store.pendingTikTokJob();
    if (!pending) return;
    const { run, plan } = pending;
    if (!this.durableTikTok) {
      run.status = 'interrupted';
      run.error = 'Подключение TikTok изменилось. Полученные данные сохранены.';
      run.active = null;
      this.update(run, run.error);
      this.store.finishTikTokJob(run.id);
      return;
    }
    this.durableId = run.id;
    this.analyze(run);
    this.launch(run, plan.mode, plan.config, null, plan);
  }
  async start(id: string, mode: RunMode, config: SourceConfiguration, threadsOnly = false) {
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
    if (!threadsOnly) {
      const job = this.store.db.prepare(`SELECT run_id FROM result_jobs JOIN runs ON runs.id=run_id
        WHERE mode=? AND config=? AND json_extract(body,'$.status')='partial'
        ORDER BY json_extract(body,'$.startedAt') LIMIT 1`).get(mode, JSON.stringify(config));
      if (job) {
        const saved = this.store.run(String(job.run_id),false)!;
        saved.status = 'running';
        delete saved.finishedAt;
        this.update(saved,'Продолжаем обработку сохранённой выборки');
        this.launch(saved,mode,config,null,undefined,true);
        return saved;
      }
    }
    if (!collect && (!previous || previous.counts.posts + previous.counts.comments === 0))
      throw new AppError(409, 'NO_RECORDS', 'Сначала соберите данные участка Telegram или TikTok.');
    const now = new Date().toISOString();
    if (
      mode === 'tiktok' ||
      (mode === 'cycle' &&
        !config.sources.some((source) => source.enabled && source.platform === 'telegram'))
    ) {
      const plan = tiktokPlan(config, now);
      if (threadsOnly) {
        if (
          mode !== 'tiktok' ||
          !this.durableTikTok ||
          !plan.jobs.some((job) => this.store.pendingThreadCount(job.source.id))
        )
          throw new AppError(409, 'NO_PENDING_THREADS', 'В очереди нет веток для дочитывания.');
        if (!plan.jobs.every((job) => job.outputs.comments && job.options.includeReplies))
          throw new AppError(
            409,
            'PLAN_BLOCKED',
            'Включите сбор комментариев и ответов в настройках TikTok.',
          );
      }
    }
    const run: CollectionRun = {
      id,
      ...(this.ai && this.store.secret('openai-api-key') && (
        collect ||
        (!collect && previous && Object.values(previous.sources ?? {}).some(s => s.platform === 'tiktok')) ||
        (!collect && previous?.ideaMode === 'ai')
      ) ? { ideaMode: threadsOnly ? 'collect' as const : 'ai' as const } : {}),
      ...(this.durableTikTok && (mode === 'tiktok' || mode === 'cycle')
        ? { tiktokCollectionVersion: 3 as const }
        : {}),
      ...(threadsOnly ? { threadsOnly: true } : {}),
      status: 'running',
      active: collect
        ? mode === 'cycle'
          ? (config.sources.find((source) => source.enabled)?.platform ?? null)
          : mode
        : mode,
      done: [],
      steps: {},
      skipped: [
        ...(mode === 'cycle' && this.services?.analytics ? [] : ['analytics']),
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
    // For a TikTok-only run, persist the manual request and its plan in one commit.
    const tikTokOnly = mode === 'tiktok' || (mode === 'cycle' && run.skipped.includes('telegram'));
    if (this.durableTikTok && tikTokOnly) {
      this.store.beginTikTokJob(run, { mode, config, budget: { publications: 0, comments: 0 } });
      this.durableId = id;
    } else this.store.saveRun(run);
    this.launch(run, mode, config, previous);
    return this.store.run(id)!;
  }
  private launch(
    run: CollectionRun,
    mode: RunMode,
    config: SourceConfiguration,
    previous: CollectionRun | null,
    resume?: TikTokJob,
    resultsOnly = false,
  ) {
    const control = new AbortController();
    const current = { id: run.id, control, promise: Promise.resolve() };
    this.current = current;
    current.promise = this.execute(run, mode, config, previous, control.signal, resume, resultsOnly).finally(
      () => {
        if (this.durableId === run.id) {
          if (run.status !== 'running' && run.followUp?.state !== 'manual' && !unfinishedTikTokSource(run))
            this.store.finishTikTokJob(run.id);
          this.durableId = undefined;
        }
        if (this.current === current) this.current = null;
      },
    );
  }
  resumeTikTok(run: CollectionRun, sourceId?: string) {
    if (this.current?.id === run.id || run.status === 'completed') return run;
    if (this.current || this.account.isBusy)
      throw new AppError(409, 'RUN_ACTIVE', 'Дождитесь завершения текущей операции.');
    if (!this.durableTikTok || !sourceId || !this.store.resumableTikTok(run, sourceId))
      throw new AppError(409, 'NO_CHECKPOINT', 'Для этого запуска нет сохранённой позиции.');
    const plan = this.store.reopenTikTokJob(run, sourceId);
    this.durableId = run.id;
    this.launch(run, plan.mode, plan.config, null, plan);
    return this.store.run(run.id, false)!;
  }
  async cancel(id: string) {
    const current = this.current;
    if (current?.id === id) {
      current.control.abort();
      await current.promise;
    }
    return this.store.run(id);
  }
  async close() {
    this.current?.control.abort(this.shutdown);
    await this.current?.promise;
  }
  private update(run: CollectionRun, event?: string) {
    if (event) run.events = [event, ...run.events].slice(0, 20);
    this.store.saveRun(run, false);
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
    resume?: TikTokJob,
    resultsOnly = false,
  ) {
    const budget = resume ? { ...resume.budget } : { publications: 0, comments: 0 };
    try {
      if (!resultsOnly && (mode === 'cycle' || mode === 'telegram' || mode === 'tiktok')) {
        const providers = (['telegram', 'tiktok'] as const).filter((platform) =>
          config.sources.some(
            (source) =>
              source.enabled &&
              source.platform === platform &&
              (mode === 'cycle' || mode === platform),
          ),
        );
        let nextRequest = 0;
        const consume = async (pace = true, requestSignal = signal) => {
          requestSignal.throwIfAborted();
          if (pace) {
            const at = Math.max(nextRequest, Date.now());
            nextRequest = at + this.interval;
            await delay(Math.max(0, at - Date.now()), undefined, { signal: requestSignal });
          }
          if (run.counts.requests >= config.runLimits.maxRequests)
            throw new AppError(
              429,
              'REQUEST_BUDGET',
              'Достигнут предел сетевых запросов запуска. Полученные данные сохранены.',
            );
          run.counts.requests++;
          this.update(run);
        };
        for (const provider of providers) {
          signal.throwIfAborted();
          if (resume && provider === 'telegram') continue;
          if (
            provider === 'tiktok' &&
            this.durableTikTok &&
            this.durableId !== run.id &&
            mode === 'cycle'
          ) {
            this.store.beginTikTokJob(run, { mode, config, budget });
            this.durableId = run.id;
          }
          this.stage(run, provider);
          let gateway: Gateway | undefined;
          try {
            if (provider === 'telegram') {
              gateway = await this.account.connected();
              gateway.beforeRequest = () => consume();
              await this.collect(run, config, gateway, signal, budget);
            } else {
              await this.collectTikTok(run, config, signal, budget, (kind, requestSignal) =>
                consume(kind === 'data', requestSignal),
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
        const reviewedThreads =
          run.threadsOnly &&
          Object.values(run.sources ?? {}).some(
            (source) => source.threads && source.status === 'limited',
          );
        if (problems.length && !run.counts.posts && !run.counts.comments && !reviewedThreads && mode !== 'cycle') {
          run.status = 'failed';
          run.finishedAt = new Date().toISOString();
          this.update(run);
          return;
        }
      } else if (!resultsOnly && previous) {
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
      this.store.db.prepare('INSERT OR IGNORE INTO result_jobs VALUES (?,?,?)').run(run.id, mode, JSON.stringify(config));
      await this.processResults(run,mode,config,signal);
      this.stage(run, 'orchestrator');
      this.done(run, 'orchestrator');
      run.active = null;
      const hasResult = run.counts.posts || run.counts.comments || run.done.includes('analytics') ||
        (run.threadsOnly && Object.values(run.sources ?? {}).some(s => s.threads && s.status === 'limited'));
      run.status = run.error ? (hasResult ? 'partial' : 'failed') : 'completed';
      run.finishedAt = new Date().toISOString();
      this.update(run);
      if (!run.failures?.ideas && !run.failures?.analytics) this.store.db.prepare('DELETE FROM result_jobs WHERE run_id=?').run(run.id);
    } catch (error) {
      if (signal.aborted && signal.reason === this.shutdown && (this.durableId === run.id ||
          this.store.db.prepare('SELECT 1 FROM result_jobs WHERE run_id=?').get(run.id))) return;
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
      if (signal.aborted && run.followUp) delete run.followUp;
      run.retryAt = mapped.retryAt;
      run.finishedAt = new Date().toISOString();
      for (const source of Object.values(run.sources ?? {}))
        if (source.status === 'reading') {
          source.status = signal.aborted ? 'cancelled' : 'failed';
          delete source.retry;
          source.reason = run.error;
          source.updatedAt = new Date().toISOString();
        }
      this.update(run, run.error);
    }
  }
  private async processResults(run:CollectionRun,mode:RunMode,config:SourceConfiguration,signal:AbortSignal) {
    const stages = run.ideaMode === 'collect' ? [] :
      ['cycle','tiktok','telegram','orchestrator'].includes(mode) ? ['collector','ideas','materials'] : [mode];
    run.failures ??= {};
    delete run.failures.ideas;
    delete run.failures.analytics;
    for (const stage of stages) {
      if (run.done.includes(stage) || run.skipped.includes(stage)) continue;
      signal.throwIfAborted();
      if (run.ideaMode === 'ai' && ['ideas','materials'].includes(stage)) {
        if (!run.aiUsage && !this.store.db.prepare(`SELECT 1 FROM run_records WHERE run_id=?
          AND trim(json_extract(body,'$.text'))<>'' AND (json_extract(body,'$.kind')='comment'
          OR json_extract(body,'$.platform')='telegram') LIMIT 1`).get(run.id)) {
          run.skipped.push(stage);
          if (stage === 'ideas') {
            run.aiCostUsd = 0;
            this.update(run,'Новых текстов для идей нет. Запрос в ИИ пропущен.');
          }
          continue;
        }
        if (!run.aiUsage) {
          this.stage(run,'ideas');
          try {
            const {report,usage} = await this.ai!.analyzeStage(run.id,signal);
            run.aiUsage = usage;
            run.aiCostUsd = estimateAnalysisCost(report.model, usage);
            run.counts.ideas = report.ideas.length;
          } catch (error) {
            signal.throwIfAborted();
            run.failures.ideas = error instanceof Error ? error.message : 'Разбор не завершён.';
            this.update(run,run.failures.ideas);
            break;
          }
        }
      } else if (stage === 'ideas' || stage === 'materials') this.analyze(run);
      signal.throwIfAborted();
      this.stage(run,stage);
      this.done(run,stage);
    }
    if (mode === 'cycle' && this.services?.analytics && !run.done.includes('analytics') && !run.skipped.includes('analytics')) {
      this.stage(run,'analytics');
      try {
        await this.services.analytics(run,config,signal);
        if (!run.skipped.includes('analytics')) this.done(run,'analytics');
      } catch (error) {
        signal.throwIfAborted();
        run.failures.analytics = error instanceof Error ? error.message : 'Не удалось обновить аналитику.';
      }
    }
    run.error = Object.values(run.failures).filter(Boolean).join(' ') || undefined;
  }

  private async collectTikTok(
    run: CollectionRun,
    config: SourceConfiguration,
    signal: AbortSignal,
    budget: { publications: number; comments: number },
    beforeRequest: (kind: 'data' | 'resource', signal?: AbortSignal) => Promise<void>,
  ) {
    const plan = tiktokPlan(config, run.startedAt);
    const deadline = run.ideaMode === 'ai' && !run.threadsOnly
      ? (run.tiktokCollectUntil ??= Date.now() + 300_000) : undefined;
    for (const job of plan.jobs) {
      signal.throwIfAborted();
      const source = job.source;
      const journal =
        this.durableId === run.id ? this.store.tikTokJournal(run.id, source.id) : undefined;
      const finished = journal?.get<{ budget: typeof budget; stop: boolean }>('finished');
      if (finished) {
        Object.assign(budget, finished.budget);
        if (finished.stop) break;
        continue;
      }
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
      const previousProgress = run.sources[source.id];
      run.sources[source.id] ??= {
        platform: 'tiktok',
        status: 'reading',
        url: source.url,
        comments: 0,
        updatedAt: new Date().toISOString(),
      };
      this.update(run);
      let saved = previousProgress ? this.store.savedSourceComments(run.id, source.id) : 0,
        unknownDates = false;
      let nextAnalysisAt = Date.now() + 2000;
      const useLibrary = run.ideaMode === 'ai' && job.outputs.comments && !run.threadsOnly;
      const selection = new Set<string>();
      let reused = previousProgress?.reusedComments ?? 0;
      const savedFor = (video: string, limit: number) =>
        this.store.savedDiscussion(run.id, source.id, video, job.window, job.options.includeReplies, job.options.minLikes, limit);
      const completeSample = () => {
        if (!useLibrary) return;
        const perVideo = config.platforms.tiktok.commentsPerVideo ?? job.limits.comments;
        for (const video of selection) {
          const available = Math.min(job.limits.comments - saved, config.runLimits.maxComments - run.counts.comments);
          if (available <= 0) break;
          const room = Math.min(available, perVideo - this.store.discussionSize(run.id, source.id, video));
          if (room <= 0) continue;
          const attached: string[] = [];
          for (const record of savedFor(video, room)) {
            if (!this.store.attachSavedRecord(run.id, { ...record, purpose: source.purpose })) continue;
            if (record.platform === 'tiktok' && record.commentId) attached.push(record.commentId);
            run.counts.comments++;
            saved++;
            reused++;
          }
          if (journal && attached.length) {
            const key = 'received:' + video;
            journal.put(key, [...new Set([...(journal.get<string[]>(key) ?? []), ...attached])]);
          }
        }
      };
      try {
        await this.readerFactory().read(source, {
          signal,
          tiktokCollectionVersion: run.tiktokCollectionVersion,
          continueSample: journal?.get<boolean>('continue-selection'),
          collectUntil: deadline,
          threadsOnly: run.threadsOnly,
          maxVideos,
          additionalBacklogVideos:
            run.tiktokCollectionVersion && !run.threadsOnly
              ? Math.max(0, config.runLimits.maxPublications - budget.publications - maxVideos)
              : 0,
          maxComments,
          commentsPerVideo: config.platforms.tiktok.commentsPerVideo,
          replies: job.options.includeReplies,
          comments: job.outputs.comments,
          since: job.window.since,
          beforeRequest,
          journal,
          savedRetry: previousProgress?.retry,
          requestsRemaining: () => config.runLimits.maxRequests - run.counts.requests,
          onVideo: (video, backlog) => {
            run.steps.tiktok = 1;
            budget.publications++;
            if (run.threadsOnly || backlog) return;
            selection.add(video.id);
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
            if (this.store.addRecord(run.id, record)) {
              run.counts.posts++;
              this.update(run);
            }
          },
          onComment: (comment, video) => {
            run.steps.tiktok = 1;
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
            if (useLibrary && (!record.text.trim() || this.store.analyzedComment(record.id))) return;
            if (this.store.addRecord(run.id, record)) {
              run.counts.comments++;
              saved++;
              if (Date.now() >= nextAnalysisAt) {
                this.analyze(run);
                nextAnalysisAt = Date.now() + 2000;
              }
              this.update(run);
            }
          },
          onProgress: (progress) => {
            if (progress.status !== 'reading') completeSample();
            if (run.counts.comments) this.analyze(run);
            // Replaying saved pages can reach a real waiting point before it
            // catches up to totals already published by the earlier pass.
            if (
              previousProgress &&
              progress.status === 'reading' &&
              ((progress.videos?.processed ?? 0) < (previousProgress.videos?.processed ?? 0) ||
                (progress.receivedComments ?? 0) < (previousProgress.receivedComments ?? 0))
            ) {
              const visible = run.sources![source.id];
              const retry =
                progress.retry ??
                (visible.retry && Date.parse(visible.retry.at) > Date.now()
                  ? visible.retry
                  : undefined);
              if (
                visible.status !== 'reading' ||
                retry !== visible.retry ||
                saved !== visible.comments
              ) {
                run.sources![source.id] = {
                  ...visible,
                  status: 'reading',
                  comments: saved,
                  retry,
                  failedRequest: progress.retry
                    ? progress.failedRequest
                    : retry
                      ? visible.failedRequest
                      : undefined,
                  reason: undefined,
                  stopCode: undefined,
                  updatedAt: new Date().toISOString(),
                };
                this.update(run);
              }
              return;
            }
            run.sources![source.id] = {
              ...progress,
              url: source.url,
              expectedComments: source.kind === 'video' ? progress.expectedComments : undefined,
              comments: saved,
              reusedComments: reused,
              ...(useLibrary && progress.status !== 'reading' && {
                sampleVideos: this.store.videosWithComments(run.id, source.id),
              }),
              platform: 'tiktok',
              updatedAt: new Date().toISOString(),
            };
            const checkpoint = useLibrary && ['TIKTOK_SAMPLE_TIME', 'TIKTOK_SAMPLE_PAUSED',
              'TIKTOK_REPLIES_INCOMPLETE', 'TIKTOK_DEFERRED_REPLIES', 'TIKTOK_TOTAL_COMMENT_LIMIT',
              'REQUEST_BUDGET'].includes(progress.stopCode ?? '');
            if (checkpoint && journal) {
              run.followUp = {state: 'manual', attempts: 0, sample: run.counts.comments, at: new Date().toISOString()};
            }
            if (progress.status === 'limited' && !checkpoint) {
              run.failures ??= {};
              run.failures.tiktok = progress.reason ?? 'TikTok выдал часть комментариев.';
            }
            this.update(run);
          },
        });
        if (!run.threadsOnly && maxVideos < job.limits.publications) {
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
        journal?.put('finished', { budget, stop: false });
      } catch (error) {
        if (signal.aborted) throw error;
        const mapped =
          error instanceof AppError
            ? error
            : new AppError(502, 'TIKTOK_UNAVAILABLE', 'Не удалось прочитать TikTok.');
        if (['TIKTOK_TIMEOUT', 'TIKTOK_UNAVAILABLE', 'REQUEST_BUDGET'].includes(mapped.code)) completeSample();
        run.failures ??= {};
        run.failures.tiktok = mapped.message;
        if (mapped.retryAt) run.retryAt = mapped.retryAt;
        run.sources![source.id] = {
          ...run.sources![source.id],
          retry: undefined,
          comments: saved,
          reusedComments: reused,
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
        const stop =
          mapped.status === 429 ||
          ['TIKTOK_LOGIN_REQUIRED', 'TIKTOK_AGE_REQUIRED', 'TIKTOK_BLOCKED'].includes(mapped.code);
        journal?.put('finished', { budget, stop });
        if (stop) break;
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
    if (run.ideaMode) return;
    const inputs = run.counts.posts + run.counts.comments;
    if (run.ideaAnalysisVersion === ideaAnalysisVersion && run.ideaInputCount === inputs) return;
    let ideas: FoundIdea[];
    if (run.threadsOnly) {
      const newIds = new Set(Array.from(this.analysisRecords(run.id), (record) => record.id));
      ideas = newIds.size
        ? analyzeIdeas(this.store.collectedRecords()).filter((idea) =>
            idea.evidence.some((item) => newIds.has(item.id)),
          )
        : [];
    } else {
      ideas = analyzeIdeas(this.analysisRecords(run.id));
    }
    if (JSON.stringify(run.ideas) !== JSON.stringify(ideas) || !run.ideaRevision) {
      run.ideaRevision = (run.ideaRevision ?? 0) + 1;
    }
    run.ideas = ideas;
    run.counts.ideas = ideas.length;
    run.ideaAnalysisVersion = ideaAnalysisVersion;
    run.ideaInputCount = inputs;
    this.store.replaceRunIdeas(run);
  }

  reviewedIdeas() {
    const records = this.store.collectedRecords();
    return { version: ideaAnalysisVersion, ideas: analyzeIdeas(this.store.secret('openai-api-key')
      ? Array.from(records).filter(r => r.platform !== 'tiktok') : records) };
  }
}
