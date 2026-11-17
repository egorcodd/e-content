import { LocalStore } from './store.ts';
import { AppError, telegramError } from './errors.ts';
import { TelegramGateway, type Gateway, type TelegramCredentials } from './telegram.ts';
import type { ConnectedAccount } from '../src/features/sources/connections.ts';
import type { TelegramAuthState } from '../src/features/collection/contracts.ts';
import { validateConnectionIdentity } from '../src/features/sources/connection-validation.ts';

export type GatewayFactory = (credentials: TelegramCredentials, session?: string) => Gateway;
type SavedAccount = { account: ConnectedAccount; session: string };
export class TelegramAccount {
  private gateway: Gateway | null = null;
  private pending: {
    owner: string;
    phone: string;
    hash: string;
    length: number;
    delivery: string;
    phase: 'code' | 'password';
    until: number;
    attempts: number;
    hint?: string;
  } | null = null;
  private busy = false;
  private nextCodeAt = 0;
  private cooldownUntil = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private store: LocalStore,
    private factory: GatewayFactory = (credentials, session) =>
      new TelegramGateway(credentials, session),
  ) {}
  accounts(): ConnectedAccount[] {
    const saved = this.store.secret<SavedAccount>('telegram-session');
    return saved ? [saved.account] : [];
  }
  get isBusy() {
    return this.busy;
  }
  checkCooldown() {
    const until = this.store.secret<number>('telegram-cooldown') ?? 0;
    if (until > Date.now())
      throw new AppError(
        429,
        'FLOOD_WAIT',
        'Telegram просит подождать перед следующим запросом.',
        new Date(until).toISOString(),
      );
  }
  recordError(error: unknown) {
    const mapped = telegramError(error);
    if (mapped.retryAt) this.store.setSecret('telegram-cooldown', Date.parse(mapped.retryAt));
    this.markExpired(error);
  }
  state(owner: string): TelegramAuthState {
    if (this.accounts().some((account) => account.status === 'connected'))
      return { phase: 'connected' };
    const credentials = this.store.secret<TelegramCredentials>('telegram-app');
    if (!credentials) return { phase: 'setup' };
    const pending = this.pending;
    if (pending && pending.owner === owner && pending.until > Date.now())
      return {
        phase: pending.phase,
        phone: pending.phone,
        codeLength: pending.length,
        delivery: pending.delivery,
        expiresAt: new Date(pending.until).toISOString(),
        passwordHint: pending.hint,
      };
    return { phase: 'phone' };
  }
  configure(apiId: unknown, apiHash: unknown) {
    if (this.accounts().length || this.pending || this.busy)
      throw new AppError(409, 'ACCOUNT_BUSY', 'Сначала завершите текущее подключение.');
    if (
      !Number.isInteger(apiId) ||
      (apiId as number) <= 0 ||
      (apiId as number) > 2147483647 ||
      typeof apiHash !== 'string' ||
      !/^[a-f\d]{32}$/i.test(apiHash)
    )
      throw new AppError(
        400,
        'INVALID_APP',
        'Проверьте api_id и api_hash из API development tools.',
      );
    this.store.setSecret('telegram-app', { apiId, apiHash });
  }
  private async exclusive<T>(callback: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError(409, 'AUTH_BUSY', 'Предыдущий запрос ещё выполняется.');
    this.checkCooldown();
    if (this.cooldownUntil > Date.now())
      throw new AppError(
        429,
        'FLOOD_WAIT',
        'Telegram просит подождать перед следующей попыткой.',
        new Date(this.cooldownUntil).toISOString(),
      );
    this.busy = true;
    try {
      return await callback();
    } catch (error) {
      const mapped = telegramError(error);
      this.recordError(error);
      if (mapped.retryAt) this.cooldownUntil = Date.parse(mapped.retryAt);
      if (mapped.code === 'PHONE_CODE_EXPIRED') {
        this.pending = null;
        await this.gateway?.disconnect();
        this.gateway = null;
      }
      throw mapped;
    } finally {
      this.busy = false;
    }
  }
  private credentials() {
    const result = this.store.secret<TelegramCredentials>('telegram-app');
    if (!result)
      throw new AppError(409, 'APP_REQUIRED', 'Сначала укажите api_id и api_hash приложения.');
    return result;
  }
  private async complete() {
    const gateway = this.gateway!;
    const account: ConnectedAccount = {
      ...(await gateway.account()),
      platform: 'telegram',
      status: 'connected',
    };
    this.store.setSecret('telegram-session', { account, session: gateway.session() });
    this.pending = null;
    clearTimeout(this.expiryTimer);
  }
  private armExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.pending) return;
    this.expiryTimer = setTimeout(
      () => {
        if (this.busy || (this.pending && this.pending.until > Date.now())) {
          this.armExpiry();
          return;
        }
        this.pending = null;
        const gateway = this.gateway;
        this.gateway = null;
        void gateway?.disconnect().catch(() => {});
      },
      Math.max(1000, this.pending.until - Date.now()),
    );
    this.expiryTimer.unref();
  }
  async sendCode(owner: string, phone: unknown) {
    return this.exclusive(async () => {
      if (this.pending && this.pending.until > Date.now() && this.pending.owner !== owner)
        throw new AppError(409, 'AUTH_OWNER', 'Подключение уже начато в другом сеансе браузера.');
      if (this.accounts().some((account) => account.status === 'connected'))
        throw new AppError(409, 'ALREADY_CONNECTED', 'Аккаунт уже подключён.');
      const result = validateConnectionIdentity('telegram', typeof phone === 'string' ? phone : '');
      if (result.error) throw new AppError(400, 'PHONE_INVALID', result.error);
      if (this.nextCodeAt > Date.now())
        throw new AppError(
          429,
          'CODE_COOLDOWN',
          'Код уже запрошен. Подождите перед новым запросом.',
          new Date(this.nextCodeAt).toISOString(),
        );
      await this.gateway?.disconnect();
      this.pending = null;
      this.gateway = this.factory(this.credentials());
      await this.gateway.connect();
      this.nextCodeAt = Date.now() + 30000;
      try {
        const code = await this.gateway.sendCode(result.value);
        if (code.authorized) {
          await this.complete();
          return;
        }
        this.pending = {
          owner,
          phone: result.value,
          hash: code.hash,
          length: code.length,
          delivery: code.delivery,
          phase: 'code',
          until: Date.now() + 600000,
          attempts: 0,
        };
      } catch (error) {
        if ((error as { errorMessage?: string }).errorMessage !== 'SESSION_PASSWORD_NEEDED')
          throw error;
        this.pending = {
          owner,
          phone: result.value,
          hash: '',
          length: 0,
          delivery: '',
          phase: 'password',
          until: Date.now() + 600000,
          attempts: 0,
          hint: await this.gateway.passwordHint(),
        };
      }
      this.armExpiry();
    });
  }
  private current(owner: string) {
    if (
      !this.pending ||
      this.pending.owner !== owner ||
      this.pending.until < Date.now() ||
      !this.gateway
    )
      throw new AppError(409, 'AUTH_EXPIRED', 'Сеанс входа истёк. Запросите новый код.');
    if (this.pending.attempts >= 5)
      throw new AppError(
        429,
        'ATTEMPTS_EXHAUSTED',
        'Слишком много попыток. Начните вход заново позже.',
      );
    return this.pending;
  }
  async code(owner: string, value: unknown) {
    return this.exclusive(async () => {
      const pending = this.current(owner);
      if (pending.phase !== 'code')
        throw new AppError(409, 'PASSWORD_REQUIRED', 'Введите пароль двухэтапной защиты.');
      if (typeof value !== 'string' || !new RegExp(`^\\d{${pending.length}}$`).test(value))
        throw new AppError(400, 'CODE_INVALID', `Введите код из ${pending.length} цифр.`);
      pending.attempts++;
      try {
        await this.gateway!.signIn(pending.phone, pending.hash, value);
        await this.complete();
      } catch (error) {
        if ((error as { errorMessage?: string }).errorMessage !== 'SESSION_PASSWORD_NEEDED')
          throw error;
        pending.phase = 'password';
        pending.attempts = 0;
        pending.hint = await this.gateway!.passwordHint();
      }
    });
  }
  async password(owner: string, value: unknown) {
    return this.exclusive(async () => {
      const pending = this.current(owner);
      if (pending.phase !== 'password')
        throw new AppError(409, 'CODE_REQUIRED', 'Сначала подтвердите код.');
      if (typeof value !== 'string' || !value || value.length > 256)
        throw new AppError(400, 'PASSWORD_INVALID', 'Введите пароль двухэтапной защиты.');
      pending.attempts++;
      await this.gateway!.checkPassword(value);
      await this.complete();
    });
  }
  async cancel(owner: string) {
    if (this.busy) throw new AppError(409, 'AUTH_BUSY', 'Дождитесь завершения запроса.');
    if (this.pending && this.pending.owner !== owner)
      throw new AppError(403, 'AUTH_OWNER', 'Подключение начато в другом сеансе браузера.');
    if (!this.accounts().some((account) => account.status === 'connected')) {
      await this.gateway?.disconnect();
      this.gateway = null;
    }
    this.pending = null;
    clearTimeout(this.expiryTimer);
  }
  async connected(): Promise<Gateway> {
    this.checkCooldown();
    const saved = this.store.secret<SavedAccount>('telegram-session');
    if (!saved || saved.account.status !== 'connected')
      throw new AppError(409, 'TELEGRAM_REQUIRED', 'Подключите аккаунт Telegram в источниках.');
    if (!this.gateway) {
      this.gateway = this.factory(this.credentials(), saved.session);
      try {
        await this.gateway.connect();
        await this.gateway.account();
      } catch (error) {
        await this.gateway.disconnect();
        this.gateway = null;
        this.markExpired(error);
        throw telegramError(error);
      }
    }
    return this.gateway;
  }
  markExpired(error: unknown) {
    const code =
      (error as { errorMessage?: string } | null)?.errorMessage ??
      (error as { code?: string } | null)?.code;
    if (
      !['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'USER_DEACTIVATED'].includes(
        code ?? '',
      )
    )
      return;
    const saved = this.store.secret<SavedAccount>('telegram-session');
    if (saved)
      this.store.setSecret('telegram-session', {
        ...saved,
        account: { ...saved.account, status: 'expired' },
      });
  }
  async disconnect(id: string) {
    return this.exclusive(async () => {
      const saved = this.store.secret<SavedAccount>('telegram-session');
      if (!saved || saved.account.id !== id)
        throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Аккаунт не найден.');
      if (saved.account.status === 'connected') await (await this.connected()).revoke();
      await this.gateway?.disconnect();
      this.gateway = null;
      this.store.deleteSecret('telegram-session');
      this.pending = null;
    });
  }
  async resetApp(owner: string) {
    if (this.accounts().some((account) => account.status === 'connected'))
      throw new AppError(409, 'ALREADY_CONNECTED', 'Сначала отключите аккаунт Telegram.');
    await this.cancel(owner);
    this.store.deleteSecret('telegram-app');
    this.store.deleteSecret('telegram-session');
  }
  async close() {
    clearTimeout(this.expiryTimer);
    await this.gateway?.disconnect();
    this.gateway = null;
    this.pending = null;
  }
}
