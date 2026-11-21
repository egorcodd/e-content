import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../errors.ts';

export type TikTokTransport = {
  maxCommentPageSize?: number;
  get(path: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

export class TikTokRequestError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly upstreamStatus?: number,
    retryAt?: string,
    readonly responseIssue?: 'empty' | 'overloaded' | 'limited' | 'access',
  ) {
    super(status, code, message, retryAt);
  }
}

function retryTime(response: Response, upstreamDelay: unknown) {
  const now = Date.now();
  const header = response.headers.get('Retry-After')?.trim();
  const headerTime = header
    ? /^\d+$/.test(header)
      ? now + Number(header) * 1000
      : Date.parse(header)
    : 0;
  const upstreamTime =
    typeof upstreamDelay === 'number' && upstreamDelay > 0 ? now + upstreamDelay : 0;
  const valid = [headerTime, upstreamTime].filter(
    (time) => time > now && Number.isFinite(new Date(time).valueOf()),
  );
  return valid.length ? new Date(Math.max(...valid)).toISOString() : undefined;
}

export class NativeTikTokHost implements TikTokTransport {
  readonly maxCommentPageSize = 50;
  private taskkill = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe');
  private child?: ChildProcess;
  private starting?: Promise<string>;
  private origin?: string;
  private exit = () => {
    if (this.child?.pid && process.platform === 'win32') {
      try {
        execFileSync(this.taskkill, ['/PID', String(this.child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {}
    } else this.child?.kill('SIGTERM');
  };

  constructor(private root = resolve('.')) {}

  private async start(): Promise<string> {
    if (this.origin && this.child?.exitCode === null) return this.origin;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async launch() {
    const config = JSON.parse(
      readFileSync(resolve(this.root, 'collectors/tiktok/upstream.json'), 'utf8'),
    ) as { directory: string; revision: string };
    const cwd = resolve(this.root, config.directory);
    const python = resolve(
      this.root,
      '.local/tiktok-native/venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    const marker = resolve(this.root, '.local/tiktok-native/installed.json');
    if (
      !existsSync(python) ||
      !existsSync(resolve(cwd, 'dist/main.js')) ||
      !existsSync(marker) ||
      JSON.parse(readFileSync(marker, 'utf8')).revision !== config.revision
    )
      throw new AppError(
        503,
        'TIKTOK_SETUP_REQUIRED',
        'Сначала установите сборщик TikTok: npm run setup:tiktok.',
      );
    const port = await new Promise<number>((done, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const number = typeof address === 'object' && address ? address.port : 0;
        probe.close((error) => (error ? reject(error) : done(number)));
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['dist/main.js'], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        TIKTOK_PYTHON: python,
        TIKTOK_ORIGIN: 'https://www.tiktok.com',
        TIKTOK_PROXY_URL: '',
        TIKTOK_MAX_RETRIES: '0',
        TIKTOK_RETRY_ON_THROTTLE: 'false',
        TIKTOK_MAX_CONCURRENT_REQUESTS: '1',
        TIKTOK_MIN_REQUEST_INTERVAL_MS: '2000',
      },
    });
    this.child = child;
    process.once('exit', this.exit);
    let spawnError = '',
      stderr = '';
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    child.once('error', (error) => {
      spawnError = error.message;
    });
    child.once('exit', () => {
      if (this.child === child) {
        this.origin = undefined;
        process.removeListener('exit', this.exit);
      }
    });
    for (let i = 0; i < 80; i++) {
      if (spawnError || child.exitCode !== null) break;
      try {
        // Upstream /internal/health contacts TikTok; readiness must stay local.
        const response = await fetch(origin + '/', { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.status === 404) {
          this.origin = origin;
          return origin;
        }
      } catch {}
      await delay(100);
    }
    writeFileSync(
      resolve(this.root, '.local/tiktok-native/startup-error.log'),
      JSON.stringify({ error: spawnError, exitCode: child.exitCode, stderr }),
    );
    await this.close();
    throw new AppError(503, 'TIKTOK_START_FAILED', 'Не удалось запустить сборщик TikTok.');
  }

  async get(path: string, signal: AbortSignal) {
    if (
      !/^\/tiktok\/(user\/detail\?|user\/posts\?|video\/\d+(?:\?|\/comments(?:\/\d+\/replies)?\?))/.test(
        path,
      )
    )
      throw new AppError(400, 'TIKTOK_PATH', 'Этот запрос TikTok не поддерживается.');
    signal.throwIfAborted();
    try {
      const origin = await this.start();
      signal.throwIfAborted();
      const response = await fetch(origin + path, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const error =
          body.error && typeof body.error === 'object'
            ? (body.error as {
                kind?: string;
                message?: unknown;
                details?: { upstreamStatus?: unknown; retryAfterMs?: unknown; ticketGuardResult?: unknown };
              })
            : undefined;
        const kind = error?.kind;
        const detail = typeof error?.message === 'string' ? error.message : '';
        const status = error?.details?.upstreamStatus;
        const upstreamStatus =
          typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
            ? status
            : undefined;
        if (
          response.status === 429 ||
          kind === 'UPSTREAM_THROTTLED' ||
          kind === 'UPSTREAM_RATE_LIMITED'
        )
          throw new TikTokRequestError(
            429,
            'TIKTOK_BLOCKED',
            'TikTok ограничил запросы. Собранные данные сохранены.',
            upstreamStatus,
            retryTime(response, error?.details?.retryAfterMs),
            upstreamStatus === 429 ? 'limited' :
              detail.includes('overload-protect') ? 'overloaded' :
              error?.details?.ticketGuardResult === 0 ? 'access' :
              /empty body/i.test(detail) && !/guard/i.test(detail) ? 'empty' : undefined,
          );
        if (kind === 'UPSTREAM_BLOCKED')
          throw new TikTokRequestError(
            403,
            'TIKTOK_BLOCKED',
            'TikTok ограничил доступ для сборщика. Собранные данные сохранены.',
            upstreamStatus,
          );
        if (kind === 'UPSTREAM_TIMEOUT')
          throw new AppError(
            504,
            'TIKTOK_TIMEOUT',
            'TikTok не ответил вовремя. Собранные данные сохранены.',
          );
        if (
          kind === 'UPSTREAM_HTTP_ERROR' &&
          (upstreamStatus === 404 || upstreamStatus === 410) &&
          path.includes('/comments')
        ) {
          throw new TikTokRequestError(
            upstreamStatus,
            'TIKTOK_DISCUSSION_UNAVAILABLE',
            'Обсуждение больше недоступно.',
            upstreamStatus,
          );
        }
        if (
          kind === 'UPSTREAM_UNREACHABLE' ||
          (kind === 'UPSTREAM_HTTP_ERROR' &&
            upstreamStatus !== undefined &&
            [500, 502, 503, 504].includes(upstreamStatus))
        )
          throw new TikTokRequestError(
            503,
            'TIKTOK_UNAVAILABLE',
            'TikTok временно недоступен.',
            upstreamStatus,
            retryTime(response, error?.details?.retryAfterMs),
          );
        const requested = path.includes('/replies?')
          ? 'продолжение ответов'
          : path.includes('/comments?')
            ? 'страницу комментариев'
            : path.includes('/user/posts?')
              ? 'список роликов'
              : 'профиль';
        throw new AppError(
          502,
          'TIKTOK_RESPONSE',
          `TikTok не выдал ${requested}. Собранный результат сохранён.`,
        );
      }
      if (
        (body.status_code !== undefined && body.status_code !== 0) ||
        (body.statusCode !== undefined && body.statusCode !== 0)
      )
        throw new AppError(502, 'TIKTOK_REFUSED', 'TikTok отказал в выдаче данных этого профиля.');
      return body;
    } catch (error) {
      if (signal.aborted) {
        await this.close();
        signal.throwIfAborted();
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'TIKTOK_UNAVAILABLE',
        'Сборщик TikTok не ответил вовремя. Повторите позже.',
      );
    }
  }

  async close() {
    const child = this.child;
    this.child = undefined;
    this.origin = undefined;
    process.removeListener('exit', this.exit);
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      await new Promise<void>((done) =>
        execFile(
          this.taskkill,
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 },
          () => done(),
        ),
      );
    } else child.kill('SIGTERM');
  }
}
