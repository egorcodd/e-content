import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalStore } from './store.ts';
import { AiIdeaAnalysis } from './ai-ideas.ts';
import { TikTokAnalytics } from './analytics.ts';
import { publicVideoCover } from './tiktok/video-cover.ts';
import { WorkshopAnalytics } from './workshop-analytics.ts';
import { TelegramAccount, type GatewayFactory } from './telegram-account.ts';
import {
  CollectionEngine,
  ideaAnalysisVersion,
  readConfiguration,
  runModes,
  type RunMode,
} from './collection.ts';
import { AppError } from './errors.ts';
import type { TikTokReaderFactory } from './tiktok/contracts.ts';
import { TikTokAccount, type TikTokContextFactory } from './tiktok/account.ts';
import { PublicTikTokReader } from './tiktok/reader.ts';
import { ZenBridge, extensionOrigin } from './tiktok/zen-bridge.ts';
import { ZenTikTokAccount } from './tiktok/zen-account.ts';
import { NativeTikTokSource } from './tiktok/native-source.ts';
import type { TikTokTransport } from './tiktok/native-host.ts';
import { zenExtensionArchive } from './extension-package.ts';

export function createApplication(
  options: {
    directory?: string;
    origins?: string[];
    gatewayFactory?: GatewayFactory;
    requestInterval?: number;
    tiktokReaderFactory?: TikTokReaderFactory;
    tiktokContextFactory?: TikTokContextFactory;
    tiktokTransport?: 'native' | 'zen';
    tiktokNativeTransport?: TikTokTransport;
    tiktokRetryDelaysMs?: readonly number[];
  } = {},
) {
  const store = new LocalStore(options.directory ?? resolve('.local'));
  const ai = new AiIdeaAnalysis(store);
  const account = new TelegramAccount(store, options.gatewayFactory);
  const zen = new ZenBridge(store);
  const tiktok = options.tiktokContextFactory
    ? new TikTokAccount(store, options.tiktokContextFactory)
    : options.tiktokTransport === 'zen'
      ? new ZenTikTokAccount(store, zen)
      : new NativeTikTokSource(store, options.tiktokNativeTransport, options.tiktokRetryDelaysMs);
  const native = tiktok instanceof NativeTikTokSource ? tiktok : undefined;
  const analytics = new TikTokAnalytics(store, native);
  const measurements = new WorkshopAnalytics(store, account, analytics, native);
  const engine = new CollectionEngine(
    store,
    account,
    options.requestInterval,
    options.tiktokReaderFactory ??
      (() =>
        tiktok instanceof ZenTikTokAccount || tiktok instanceof NativeTikTokSource
          ? tiktok
          : new PublicTikTokReader(undefined, undefined, tiktok)),
    tiktok instanceof NativeTikTokSource && !options.tiktokReaderFactory,
    ai,
    {
      analytics: (run, config, signal) => measurements.refresh(config,signal,run),
    },
  );
  const origins = new Set(options.origins ?? ['http://127.0.0.1:5186', 'http://localhost:5186']);
  const sessions = new Map<string, { csrf: string }>();
  const runView = (run: ReturnType<LocalStore['latest']>) => {
    if (!run) return null;
    const profile = tiktok instanceof NativeTikTokSource ? tiktok.source() : null;
    const explain = (message?: string) =>
      message === 'Получена часть данных: достигнут лимит или TikTok не выдал продолжение.'
        ? 'Предыдущий запуск завершился частично. Точная причина ограничения в этой версии результата не записана.'
        : message;
    return {
      ...run,
      ...(profile?.enabled && store.resumableTikTok(run, profile.id) && {
          canResumeTikTok: true,
        }),
      ...(run.threadsOnly && {
        previousTikTokRun: store.previousTikTokRun(
          Object.keys(run.sources ?? {})[0] ?? '',
          run.startedAt,
        ),
      }),
      ideas: [],
      error: explain(run.error),
      failures: Object.fromEntries(
        Object.entries(run.failures ?? {}).map(([key, value]) => [key, explain(value)!]),
      ),
      sources: Object.fromEntries(
        Object.entries(run.sources ?? {}).map(([key, value]) => [
          key,
          { ...value, reason: explain(value.reason) },
        ]),
      ),
    };
  };
  const tiktokStatus = (owner: string) => {
    const run = store.latestForPlatform('tiktok');
    const progress = Object.values(run?.sources ?? {})
      .filter((source) => source.platform === 'tiktok')
      .sort((a, b) => {
        const priority = (status: string) =>
          status === 'reading' ? 3 : status === 'completed' ? 0 : status === 'limited' ? 1 : 2;
        return priority(b.status) - priority(a.status) || b.updatedAt.localeCompare(a.updatedAt);
      })[0];
    return {
      mode: 'account',
      status: progress?.status ?? 'unverified',
      message: progress?.reason,
      lastCheckedAt: progress?.updatedAt,
      sourceUrl: progress?.url,
    };
  };
  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = request.headers.host ?? '';
      const own = [
        `127.0.0.1:${request.socket.localPort}`,
        `localhost:${request.socket.localPort}`,
      ];
      if (!own.includes(host) && ![...origins].some((origin) => new URL(origin).host === host))
        throw new AppError(403, 'HOST', 'Этот адрес сервера не разрешён.');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/zen-bridge/')) {
        const origin = request.headers.origin;
        if (origin && !extensionOrigin(origin))
          throw new AppError(403, 'ORIGIN', 'Подключение разрешено только расширению Zen.');
        if (origin) {
          response.setHeader('Access-Control-Allow-Origin', origin);
          response.setHeader('Vary', 'Origin');
        }
        if (request.method === 'OPTIONS') {
          if (!origin) throw new AppError(403, 'ORIGIN', 'Не указан источник расширения.');
          response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
          response.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type, X-EContent-Extension, X-EContent-Version',
          );
          response.writeHead(204);
          return response.end();
        }
        const claimed = request.headers['x-econtent-extension'];
        if (
          typeof claimed !== 'string' ||
          !extensionOrigin(claimed) ||
          (origin && origin !== claimed)
        )
          throw new AppError(403, 'ZEN_ORIGIN', 'Не удалось проверить расширение.');
        if (request.method === 'POST' && url.pathname === '/api/zen-bridge/pair') {
          const body = await readBody(request);
          const result = zen.pair(body.code, claimed);
          if (tiktok instanceof ZenTikTokAccount) await tiktok.connect();
          return json(response, 200, result);
        }
        zen.authorize(
          request.headers.authorization,
          claimed,
          typeof request.headers['x-econtent-version'] === 'string'
            ? request.headers['x-econtent-version']
            : undefined,
        );
        if (request.method === 'GET' && url.pathname === '/api/zen-bridge/poll')
          return json(response, 200, zen.poll());
        if (request.method === 'POST' && url.pathname === '/api/zen-bridge/event')
          return json(response, 200, await zen.message(await readBody(request)));
        throw new AppError(404, 'NOT_FOUND', 'Метод расширения не найден.');
      }
      if (
        request.headers.origin &&
        !origins.has(request.headers.origin) &&
        !own.some((host) => request.headers.origin === `http://${host}`)
      )
        throw new AppError(403, 'ORIGIN', 'Запрос с другого сайта запрещён.');
      if (request.headers['sec-fetch-site'] === 'cross-site')
        throw new AppError(403, 'ORIGIN', 'Запрос с другого сайта запрещён.');
      let token = /(?:^|;\s*)ec_local=([A-Za-z\d_-]+)/.exec(request.headers.cookie ?? '')?.[1];
      if (!token || !sessions.has(token)) {
        if (request.method !== 'GET')
          throw new AppError(403, 'SESSION', 'Обновите страницу подключения.');
        token = randomBytes(32).toString('base64url');
        if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
        sessions.set(token, { csrf: randomBytes(32).toString('base64url') });
        response.setHeader('Set-Cookie', `ec_local=${token}; HttpOnly; SameSite=Strict; Path=/api`);
      }
      const session = sessions.get(token)!;
      let body: Record<string, unknown> = {};
      if (request.method !== 'GET') {
        const csrf = request.headers['x-csrf-token'];
        if (
          typeof csrf !== 'string' ||
          !/^[A-Za-z\d_-]{43}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))
        )
          throw new AppError(403, 'CSRF', 'Обновите страницу и повторите действие.');
        if (request.method !== 'DELETE') body = await readBody(request);
      }
      const authState = () => account.state(token!);
      if (request.method === 'POST' && url.pathname === '/api/ai/key') {
        if (typeof body.key !== 'string' || !/^sk-[\w-]{16,}$/.test(body.key.trim()))
          throw new AppError(400, 'AI_KEY_FORMAT', 'Вставьте секретный ключ OpenAI целиком.');
        store.setSecret('openai-api-key', body.key.trim());
        return json(response, 200, { configured: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/zen/extension.zip') {
        const archive = await zenExtensionArchive();
        response.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="e-content-zen.zip"',
        });
        return response.end(archive);
      }
      if (request.method === 'POST' && url.pathname === '/api/zen/pairing') {
        zen.startPairing();
        return json(response, 200, tiktok.state());
      }
      if (request.method === 'GET' && url.pathname === '/api/connections')
        return json(response, 200, {
          version: 1,
          available: ['telegram', 'tiktok'],
          publicReaders: { tiktok: tiktokStatus(token) },
          tiktok: tiktok.state(),
          managedSources: tiktok.source() ? [tiktok.source()] : [],
          csrfToken: session.csrf,
          accounts: [...account.accounts(), ...tiktok.accounts()],
        });
      if (request.method === 'GET' && url.pathname === '/api/telegram/auth')
        return json(response, 200, authState());
      if (request.method === 'GET' && url.pathname === '/api/tiktok/status')
        return json(response, 200, tiktok.state());
      if (request.method === 'POST' && url.pathname.startsWith('/api/tiktok/')) {
        if (url.pathname === '/api/tiktok/connect') {
          if (engine.busy)
            throw new AppError(409, 'RUN_ACTIVE', 'Сначала завершите или остановите сбор.');
          if (tiktok instanceof NativeTikTokSource) await tiktok.connect(token, body);
          else await tiktok.connect(token);
        } else if (url.pathname === '/api/tiktok/cancel') await tiktok.cancel(token);
        else if (url.pathname === '/api/tiktok/selection') tiktok.select(body);
        else if (url.pathname === '/api/tiktok/videos') await tiktok.refresh();
        else if (url.pathname === '/api/tiktok/disconnect') {
          if (engine.busy)
            throw new AppError(409, 'RUN_ACTIVE', 'Сначала завершите или остановите сбор.');
          await tiktok.disconnect();
        } else throw new AppError(404, 'NOT_FOUND', 'Метод не найден.');
        return json(response, 200, tiktok.state());
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/telegram/')) {
        if (engine.busy)
          throw new AppError(
            409,
            'RUN_ACTIVE',
            'Дождитесь окончания сбора или остановите его в цехе.',
          );
        switch (url.pathname) {
          case '/api/telegram/configure':
            account.configure(body.apiId, body.apiHash);
            break;
          case '/api/telegram/code':
            await account.sendCode(token, body.phone);
            break;
          case '/api/telegram/confirm':
            await account.code(token, body.code);
            break;
          case '/api/telegram/password':
            await account.password(token, body.password);
            break;
          case '/api/telegram/cancel':
            await account.cancel(token);
            break;
          case '/api/telegram/reset-app':
            await account.resetApp(token);
            break;
          default:
            throw new AppError(404, 'NOT_FOUND', 'Метод не найден.');
        }
        return json(response, 200, authState());
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/connections/accounts/')) {
        if (engine.busy) throw new AppError(409, 'RUN_ACTIVE', 'Сначала остановите сбор в цехе.');
        const id = decodeURIComponent(url.pathname.slice('/api/connections/accounts/'.length));
        if (id.startsWith('tiktok:')) await tiktok.disconnect();
        else await account.disconnect(id);
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'GET' && url.pathname === '/api/analytics/history')
        return json(response, 200, {...analytics.history(), telegram: measurements.history()});
      if (request.method === 'GET' && url.pathname === '/api/analytics/tiktok/catalog')
        return json(response, 200, { videos: analytics.catalog(url.searchParams.get('id') ?? '') });
      if (request.method === 'GET' && url.pathname === '/api/analytics/tiktok/growth')
        return json(response, 200, { videos: analytics.videoGrowth(
          url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '',
        ) });
      if (request.method === 'GET' && url.pathname === '/api/analytics/tiktok/cover') {
        const id = url.searchParams.get('id') ?? '';
        const video = analytics.videoUrl(id);
        const cover = video && await publicVideoCover(video, id);
        if (!cover) {
          response.writeHead(404, { 'Cache-Control': 'private, max-age=60' }).end();
          return;
        }
        response.writeHead(302, { Location: cover, 'Cache-Control': 'private, max-age=300' }).end();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/analytics/tiktok/scans') {
        if (engine.busy || measurements.busy)
          throw new AppError(409, 'RUN_ACTIVE', 'Дождитесь завершения сбора в цеху.');
        return json(response, 202, { scan: analytics.start() });
      }
      if (request.method === 'GET' && url.pathname === '/api/collection/latest') {
        const profile = tiktok instanceof NativeTikTokSource ? tiktok.source() : null;
        return json(response, 200, {
          run: runView(store.latest(false)),
          libraryReset: store.secret<string>('library-reset'),
          aiMaterialsVersion: ai.materialsVersion(),
          ideaAnalysisVersion,
          pendingTikTokThreads: profile?.enabled ? store.pendingThreadCount(profile.id) : 0,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/collection/reviewed-ideas')
        return json(response, 200, engine.reviewedIdeas());
      if (request.method === 'GET' && url.pathname === '/api/collection/ai-materials')
        return json(response, 200, { version: ai.materialsVersion(), ideas: ai.materials() });
      if (request.method === 'POST' && url.pathname === '/api/collection/runs') {
        if (
          typeof body.id !== 'string' ||
          !/^[a-zA-Z\d-]{12,100}$/.test(body.id) ||
          !runModes.includes(body.mode as RunMode) ||
          (body.threadsOnly !== undefined && typeof body.threadsOnly !== 'boolean') ||
          (body.threadsOnly === true && body.mode !== 'tiktok')
        )
          throw new AppError(400, 'RUN_INPUT', 'Некорректный запуск.');
        if ((analytics.busy || measurements.busy) && ['cycle', 'tiktok','telegram'].includes(String(body.mode)))
          throw new AppError(
            409,
            'TIKTOK_BUSY',
            'Дождитесь завершения обновления статистики TikTok.',
          );
        let configuration;
        try {
          configuration = tiktok.configuration(readConfiguration(body.configuration));
          if (body.threadsOnly === true) {
            const profile = tiktok instanceof NativeTikTokSource ? tiktok.source() : null;
            configuration.sources = profile?.enabled ? [profile] : [];
          }
        } catch (error) {
          throw error instanceof AppError
            ? error
            : new AppError(400, 'CONFIGURATION', 'Проверьте настройки источников и лимиты.');
        }
        const started = await engine.start(body.id, body.mode as RunMode, configuration, body.threadsOnly === true);
        if (!body.threadsOnly && ['cycle','telegram','tiktok'].includes(String(body.mode)))
          measurements.remember(configuration);
        return json(response, 202, {run: runView(started)});
      }
      const runPath =
        /^\/api\/collection\/runs\/([a-zA-Z\d-]{12,100})(?:\/(resume|cancel|records|ideas|ai-ideas|export.md))?$/.exec(
          url.pathname,
        );
      if (runPath) {
        const run = store.run(runPath[1], false);
        if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Запуск не найден.');
        if (runPath[2] === 'ai-ideas' && request.method === 'GET') {
          return json(response, 200, { configured: Boolean(store.secret('openai-api-key')), report: ai.saved(run.id)?.report ?? null });
        }
        if (runPath[2] === 'ai-ideas' && request.method === 'POST')
          return json(response, 200, await ai.analyze(run.id));
        if (request.method === 'POST' && runPath[2] === 'resume') {
          if (analytics.busy || tiktok.busy && !engine.busy)
            throw new AppError(409, 'TIKTOK_BUSY', 'Дождитесь завершения текущей операции TikTok.');
          const source = tiktok instanceof NativeTikTokSource ? tiktok.source() : null;
          return json(response, 202, { run: runView(engine.resumeTikTok(run, source?.enabled ? source.id : undefined)) });
        }
        if (request.method === 'POST' && runPath[2] === 'cancel')
          return json(response, 200, { run: runView(await engine.cancel(run.id)) });
        if (request.method === 'GET' && !runPath[2])
          return json(response, 200, { run: runView(run) });
        if (request.method === 'GET' && (runPath[2] === 'records' || runPath[2] === 'ideas')) {
          const offset = Number(url.searchParams.get('offset') ?? 0),
            limit = Number(url.searchParams.get('limit') ?? 200);
          if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 1000
          )
            throw new AppError(400, 'PAGINATION', 'Некорректная страница записей.');
          return json(response, 200, {
            items:
              runPath[2] === 'ideas'
                ? store.ideas(run.id, offset, Math.min(limit, 25))
                : store.records(run.id, offset, limit),
          });
        }
        if (request.method === 'GET' && runPath[2] === 'export.md') {
          response.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${Object.values(run.sources ?? {}).some((source) => source.platform === 'tiktok') ? 'e-content' : 'telegram'}-${run.id}.md"`,
          });
          response.write(
            `# e-content\n\nЗапуск: ${run.id}\nСостояние: ${run.status}\nПубликации: ${run.counts.posts}\nКомментарии: ${run.counts.comments}\n${run.error ? '\nОграничение: ' + run.error + '\n' : ''}\n`,
          );
          const tiktokDiagnostics = Object.values(run.sources ?? {}).filter(
            (source) => source.platform === 'tiktok' && (source.failedRequest || source.stopCode),
          );
          if (tiktokDiagnostics.length) response.write('## Сведения о сборе TikTok\n\n');
          for (const source of tiktokDiagnostics) {
            response.write(`Источник: ${source.url}\n\n`);
            if (source.videos)
              response.write(
                `Обработано роликов: ${source.videos.processed} из ${source.videos.selected}\n\n`,
              );
            if (source.receivedComments !== undefined)
              response.write(
                `Получено комментариев: ${source.receivedComments}. Сохранено: ${source.comments}.\n\n`,
              );
            const failure = source.failedRequest;
            const details = [
              source.stopCode,
              failure?.stage,
              failure?.videoNumber && `ролик ${failure.videoNumber}`,
              failure?.upstreamStatus && `HTTP ${failure.upstreamStatus}`,
            ].filter(Boolean);
            if (details.length) response.write(`${details.join(' · ')}\n\n`);
          }
          for (let offset = 0; !response.destroyed; offset += 200) {
            const items = store.records(run.id, offset, 200);
            if (!items.length) break;
            for (const record of items) {
              if (response.destroyed) break;
              const metrics = Object.entries(record.metrics ?? {})
                .filter(([, value]) => value !== undefined)
                .map(
                  ([key, value]) =>
                    `${({ views: 'Просмотры', forwards: 'Репосты', reactions: 'Реакции', likes: 'Лайки', comments: 'Комментарии' } as Record<string, string>)[key]}: ${value}`,
                )
                .join(' · ');
              if (
                !response.write(
                  `## ${record.platform === 'telegram' ? 'Telegram' : 'TikTok'} · ${record.kind === 'post' ? 'Публикация' : 'Комментарий'}${record.publishedAt ? ' · ' + record.publishedAt : ''}\n\n${record.text}\n\nИсточник: ${record.url}\n${metrics ? '\n' + metrics + '\n' : ''}\n---\n\n`,
                )
              )
                await once(response, 'drain', { signal: AbortSignal.timeout(15000) });
            }
          }
          return response.end();
        }
      }
      throw new AppError(404, 'NOT_FOUND', 'Метод не найден.');
    } catch (error) {
      const item =
        error instanceof AppError
          ? error
          : new AppError(500, 'INTERNAL', 'Не удалось выполнить действие. Попробуйте ещё раз.');
      if (!response.headersSent)
        json(response, item.status, {
          error: { code: item.code, message: item.message, retryAt: item.retryAt },
        });
      else response.end();
    }
  });
  server.once('listening', () => engine.resumePending());
  const refreshTimer = setInterval(() => {
    if (!engine.busy && !analytics.busy && !tiktok.busy && !account.isBusy) measurements.periodic();
  }, 60_000);
  refreshTimer.unref();
  return {
    server,
    store,
    engine,
    account,
    tiktok,
    zen,
    async close() {
      clearInterval(refreshTimer);
      await engine.close();
      await measurements.close();
      await analytics.close();
      await tiktok.close();
      zen.close();
      await account.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new AppError(415, 'CONTENT_TYPE', 'Нужен JSON-запрос.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 1048576) throw new AppError(413, 'BODY_SIZE', 'Слишком большой запрос.');
    chunks.push(part);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new AppError(400, 'JSON', 'Некорректный JSON-запрос.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApplication();
  app.server.listen(5187, '127.0.0.1', () => console.log('e-content API: http://127.0.0.1:5187'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void app.close().then(() => process.exit()));
}
