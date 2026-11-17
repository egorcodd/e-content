import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.ts';
import { LocalStore } from '../store.ts';

export type ZenTask = {
  id: string;
  kind: 'probe' | 'collect';
  handle?: string;
  accountId?: string;
  maxVideos: number;
  maxComments: number;
  comments: boolean;
  replies: boolean;
};
type Pending = {
  task: ZenTask;
  claimed: boolean;
  seen: number;
  timer: ReturnType<typeof setInterval>;
  event: (type: string, data: unknown) => void;
  permit: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const extensionOrigin = (value: string) => /^moz-extension:\/\/[a-f\d-]{36}$/i.test(value);

export class ZenBridge {
  private credential: { token: string; origin: string } | null;
  private pairing?: { code: string; expiresAt: number; attempts: number };
  private pending: Pending | null = null;
  private seen = 0;
  private clientVersion?: string;
  private lastFailure?: { code: string; stage?: string };
  constructor(private store: LocalStore) {
    this.credential = store.secret('zen-bridge-v1');
  }
  get online() {
    return !!this.credential && Date.now() - this.seen < 15000;
  }
  get paired() {
    return !!this.credential;
  }
  get busy() {
    return !!this.pending;
  }
  state() {
    return {
      paired: this.paired,
      online: this.online,
      version: this.clientVersion,
      lastFailure: this.lastFailure,
      pairing:
        this.pairing && this.pairing.expiresAt > Date.now()
          ? { code: this.pairing.code, expiresAt: new Date(this.pairing.expiresAt).toISOString() }
          : undefined,
    };
  }
  startPairing() {
    if (this.busy) throw new AppError(409, 'ZEN_BUSY', 'Сначала завершите сбор.');
    this.pairing = {
      code: randomBytes(6).toString('hex').toUpperCase(),
      expiresAt: Date.now() + 300000,
      attempts: 0,
    };
    return this.state();
  }
  pair(code: unknown, origin: string) {
    const pending = this.pairing;
    if (
      !extensionOrigin(origin) ||
      !pending ||
      pending.expiresAt <= Date.now() ||
      pending.attempts++ >= 5 ||
      typeof code !== 'string' ||
      !equal(code.toUpperCase().replaceAll('-', ''), pending.code)
    )
      throw new AppError(
        403,
        'ZEN_PAIRING',
        'Код подключения неверен или истёк. Получите новый в e-content.',
      );
    this.close();
    this.credential = { token: randomBytes(32).toString('base64url'), origin };
    this.store.setSecret('zen-bridge-v1', this.credential);
    this.pairing = undefined;
    this.seen = Date.now();
    return { token: this.credential.token };
  }
  authorize(authorization: string | undefined, origin: string, version?: string) {
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    if (
      !this.credential ||
      origin !== this.credential.origin ||
      !equal(token, this.credential.token)
    )
      throw new AppError(403, 'ZEN_AUTH', 'Подключите расширение к e-content заново.');
    this.seen = Date.now();
    if (version && /^\d+\.\d+\.\d+$/.test(version) && version.length < 20)
      this.clientVersion = version;
    if (this.pending) this.pending.seen = this.seen;
  }
  poll() {
    const pending = this.pending;
    if (!pending) return { task: null, activeId: null };
    const task = pending.claimed ? null : pending.task;
    pending.claimed = true;
    return { task, activeId: pending.task.id };
  }
  async run(
    input: Omit<ZenTask, 'id'>,
    event: Pending['event'],
    permit: Pending['permit'] = async () => {},
    signal?: AbortSignal,
  ) {
    if (this.pending) throw new AppError(409, 'ZEN_BUSY', 'Расширение уже выполняет задачу.');
    if (!this.online)
      throw new AppError(503, 'ZEN_OFFLINE', 'Откройте Zen с подключённым расширением.');
    signal?.throwIfAborted();
    let abort: () => void = () => {};
    const deadline = Date.now() + 900000;
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          const p = this.pending;
          if (!p || p.task.id !== task.id) return;
          clearInterval(p.timer);
          this.pending = null;
          error ? reject(error) : resolve();
        };
        const task: ZenTask = { ...input, id: randomBytes(16).toString('hex') };
        const timer = setInterval(() => {
          if (Date.now() - (this.pending?.seen ?? 0) > 20000 || Date.now() >= deadline)
            finish(
              new AppError(
                503,
                'ZEN_OFFLINE',
                'Связь с Zen прервана. Полученные данные сохранены.',
              ),
            );
        }, 1000);
        timer.unref();
        this.pending = {
          task,
          claimed: false,
          seen: Date.now(),
          timer,
          event,
          permit,
          resolve: () => finish(),
          reject: finish,
        };
        abort = () =>
          finish(signal?.reason ?? new AppError(409, 'ZEN_CANCELLED', 'Сбор остановлен.'));
        signal?.addEventListener('abort', abort, { once: true });
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  async message(input: Record<string, unknown>) {
    const p = this.pending;
    if (!p || !p.claimed || input.id !== p.task.id)
      throw new AppError(409, 'ZEN_STALE', 'Задача уже завершена.');
    p.seen = Date.now();
    try {
      if (input.type === 'permit') {
        await p.permit();
        return { allowed: this.pending === p };
      }
      if (input.type === 'done') {
        this.lastFailure = undefined;
        p.resolve();
        return {};
      }
      if (input.type === 'error') {
        const codes: Record<string, number> = {
          TIKTOK_LOGIN_REQUIRED: 401,
          TIKTOK_BLOCKED: 403,
          TIKTOK_RATE_LIMIT: 429,
          TIKTOK_SCHEMA: 502,
          TIKTOK_ACCOUNT_CHANGED: 409,
        };
        const raw = input.data as { code?: string; message?: string; stage?: string } | undefined;
        this.lastFailure = {
          code: String(raw?.code ?? 'ZEN_READ').slice(0, 40),
          stage:
            typeof raw?.stage === 'string'
              ? raw.stage.replace(/[^a-z:]/gi, '').slice(0, 40)
              : undefined,
        };
        const detail = String(raw?.message ?? 'Не удалось прочитать TikTok через Zen.').slice(
          0,
          300,
        );
        const message = /Missing host permission/i.test(detail)
          ? 'Нет доступа к вкладке TikTok. Обновите расширение в Zen и проверьте разрешение на tiktok.com.'
          : /Receiving end does not exist|Could not establish connection/i.test(detail)
            ? 'Не удалось связаться со вкладкой TikTok. Обновите расширение в Zen и повторите проверку аккаунта.'
            : detail;
        p.reject(new AppError(codes[raw?.code ?? ''] ?? 502, raw?.code ?? 'ZEN_READ', message));
      } else if (
        ['identity', 'profile', 'video', 'comments', 'progress'].includes(String(input.type))
      ) {
        p.event(String(input.type), input.data);
      } else throw new AppError(400, 'ZEN_EVENT', 'Неизвестное сообщение расширения.');
      return {};
    } catch (error) {
      p.reject(error);
      throw error;
    }
  }
  revoke() {
    this.close();
    this.credential = null;
    this.pairing = undefined;
    this.seen = 0;
    this.store.deleteSecret('zen-bridge-v1');
  }
  close() {
    this.pending?.reject(
      new AppError(409, 'ZEN_CANCELLED', 'Подключение закрыто. Полученные данные сохранены.'),
    );
  }
}
