import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalStore } from '../store.ts';
import { AppError } from '../errors.ts';
import { accessGate, discoverVideos, probeIdentity, type VideoDiscovery } from './profile.ts';
import type { AnalysisSource } from '../../src/features/sources/model.ts';
import { TikTokConnectionModel } from './connection-model.ts';

export type TikTokContextFactory = (directory: string, visible: boolean) => Promise<BrowserContext>;
const qrLoginUrl = 'https://www.tiktok.com/login/qrcode';
function isGoogleRejection(page: Page) {
  const url = new URL(page.url());
  return (
    url.origin === 'https://accounts.google.com' &&
    /\/(?:signin\/rejected|deniedsigninrejected)(?:\/|$)/.test(url.pathname)
  );
}
const launchContext: TikTokContextFactory = (directory, visible) =>
  chromium.launchPersistentContext(directory, {
    channel: process.env.TIKTOK_BROWSER_CHANNEL || 'msedge',
    headless: !visible,
    chromiumSandbox: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: false,
    serviceWorkers: 'block',
  });
export class TikTokAccount extends TikTokConnectionModel {
  private current: {
    context: BrowserContext;
    owner: string | null;
    timer?: ReturnType<typeof setTimeout>;
    lastProbe?: string;
    googleRejected?: boolean;
  } | null = null;
  private operation: Promise<void> | null = null;
  private starting = false;
  private shutdown = false;
  readonly profileDirectory: string;
  constructor(
    store: LocalStore,
    private launch: TikTokContextFactory = launchContext,
  ) {
    super(store);
    this.profileDirectory = resolve(store.directory, 'tiktok', 'profile');
  }
  get busy() {
    return this.starting || !!this.current || !!this.operation;
  }
  override state() {
    return { ...super.state(), windowOpen: this.current?.owner != null };
  }
  private async context(visible: boolean, owner: string | null) {
    if (this.busy)
      throw new AppError(409, 'TIKTOK_ACCOUNT_BUSY', 'Подключение TikTok уже используется.');
    this.starting = true;
    try {
      await mkdir(this.profileDirectory, { recursive: true, mode: 0o700 });
      const context = await this.launch(this.profileDirectory, visible);
      const current = { context, owner } as NonNullable<typeof this.current>;
      this.current = current;
      context.on('close', () => {
        if (this.current !== current) return;
        clearTimeout(current.timer);
        this.current = null;
        if (['waiting_login', 'checking'].includes(this.value.phase))
          this.update({
            phase: this.value.account ? 'unavailable' : 'disconnected',
            message: 'Окно входа закрыто. Сохранённые данные остались на месте.',
          });
      });
      return context;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'TIKTOK_BROWSER', 'Не удалось открыть браузер подключения TikTok.');
    } finally {
      this.starting = false;
    }
  }
  async connect(owner: string) {
    if (this.current?.owner === owner) {
      const current = this.current;
      current.lastProbe = undefined;
      const context = current.context;
      const page =
        context
          .pages()
          .find((candidate) => candidate.url().startsWith('https://www.tiktok.com/')) ??
        context.pages()[0] ??
        (await context.newPage());
      const rejected = context.pages().filter(isGoogleRejection);
      if (rejected.length) {
        await page.goto(qrLoginUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        for (const popup of rejected) if (popup !== page) await popup.close();
        if (this.current !== current) return this.state();
        current.googleRejected = false;
        this.update({ phase: 'waiting_login', message: undefined });
      }
      if (!page.isClosed()) await page.bringToFront();
      return this.state();
    }
    const context = await this.context(true, owner);
    this.update({ phase: 'waiting_login', message: undefined });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(qrLoginUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      this.schedule(context, page, Date.now() + 600000);
      return this.state();
    } catch (error) {
      await this.release(context);
      this.update({ phase: 'unavailable', message: 'Не удалось открыть страницу входа TikTok.' });
      throw error;
    }
  }
  private schedule(context: BrowserContext, page: Page, deadline: number) {
    if (this.current?.context !== context || this.shutdown) return;
    this.current.timer = setTimeout(() => {
      const operation = this.inspectLogin(context, page, deadline).finally(() => {
        if (this.operation === operation) this.operation = null;
      });
      this.operation = operation;
    }, 1500);
    this.current.timer.unref();
  }
  private async inspectLogin(context: BrowserContext, page: Page, deadline: number) {
    if (Date.now() >= deadline) {
      await this.release(context);
      this.update({
        phase: this.value.account ? 'unavailable' : 'disconnected',
        message: 'Время ожидания входа истекло. Можно открыть окно ещё раз.',
      });
      return;
    }
    try {
      const googleRejected = context.pages().some(isGoogleRejection);
      if (this.current?.context !== context) return;
      if (googleRejected && !this.current.googleRejected) {
        this.current.googleRejected = true;
        this.update({
          phase: 'waiting_login',
          message:
            'Google отклонил вход. Нажмите «Показать окно TikTok», чтобы открыть QR-код TikTok, и подтвердите вход в приложении TikTok на телефоне.',
        });
      } else if (!googleRejected && this.current.googleRejected) {
        this.current.googleRejected = false;
        this.update({ message: undefined });
      }
      await accessGate(page, { login: true });
      const cookies = (await context.cookies('https://www.tiktok.com')).filter(
        (cookie) => /^(sessionid(?:_ss)?|sid_tt|sid_guard)$/i.test(cookie.name) && cookie.value,
      );
      const signature = cookies.length
        ? createHash('sha256')
            .update(JSON.stringify(cookies.map((cookie) => [cookie.name, cookie.value])))
            .digest('hex')
        : undefined;
      if (!signature || this.current?.lastProbe === signature) {
        this.schedule(context, page, deadline);
        return;
      }
      if (this.current?.context !== context) return;
      this.current.lastProbe = signature;
      const identity = await probeIdentity(context, page);
      if (!identity) {
        this.schedule(context, page, deadline);
        return;
      }
      this.update({ phase: 'checking', message: undefined });
      let discovery: VideoDiscovery | undefined;
      let message: string | undefined;
      try {
        discovery = await discoverVideos(
          page,
          'https://www.tiktok.com/@' + identity.handle,
          20,
          AbortSignal.timeout(45000),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : 'Не удалось получить список роликов.';
      }
      if (this.current?.context !== context || this.shutdown) return;
      await this.release(context);
      this.update({
        phase: 'connected',
        account: identity,
        checkedAt: new Date().toISOString(),
        message,
        videos: discovery?.videos ?? [],
        coverage: discovery ? (discovery.complete ? 'complete' : 'partial') : 'unknown',
      });
    } catch (error) {
      if (this.current?.context !== context || this.shutdown) return;
      const manual =
        error instanceof AppError &&
        ['TIKTOK_VERIFICATION', 'TIKTOK_RATE_LIMIT'].includes(error.code);
      if (manual) this.current.lastProbe = undefined;
      this.update({
        phase: manual ? 'verification_required' : 'waiting_login',
        message: error instanceof Error ? error.message : undefined,
      });
      this.schedule(context, page, deadline);
    }
  }
  async cancel(owner: string) {
    if (this.current?.owner && this.current.owner !== owner)
      throw new AppError(403, 'TIKTOK_ACCOUNT_OWNER', 'Окно подключения открыто в другом сеансе.');
    if (this.current?.owner) {
      const context = this.current.context;
      await this.release(context);
      await this.operation;
      if (['waiting_login', 'checking', 'verification_required'].includes(this.value.phase))
        this.update({
          phase: this.value.account ? 'unavailable' : 'disconnected',
          message: undefined,
        });
    }
    return this.state();
  }
  async acquire(source: AnalysisSource) {
    if (!this.value.account)
      throw new AppError(409, 'TIKTOK_ACCOUNT_REQUIRED', 'Подключите аккаунт TikTok в источниках.');
    if (source.accountId && source.accountId !== 'tiktok:' + this.value.account.id)
      throw new AppError(
        409,
        'TIKTOK_ACCOUNT_CHANGED',
        'Источник относится к другому аккаунту TikTok.',
      );
    if (this.value.phase === 'expired')
      throw new AppError(401, 'TIKTOK_LOGIN_REQUIRED', 'Войдите в TikTok снова.');
    return this.context(false, null);
  }
  async verify(context: BrowserContext, page: Page) {
    try {
      const identity = await probeIdentity(context, page);
      if (!identity) {
        this.update({ phase: 'expired', message: 'Сессия TikTok завершилась. Войдите снова.' });
        throw new AppError(
          401,
          'TIKTOK_LOGIN_REQUIRED',
          'Сессия TikTok завершилась. Войдите снова.',
        );
      }
      if (identity.id !== this.value.account?.id)
        throw new AppError(
          409,
          'TIKTOK_ACCOUNT_CHANGED',
          'В браузере открыт другой аккаунт TikTok. Проверьте подключение.',
        );
      this.update({
        phase: 'connected',
        account: identity,
        checkedAt: new Date().toISOString(),
        message: undefined,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ['TIKTOK_VERIFICATION', 'TIKTOK_RATE_LIMIT'].includes(error.code)
      )
        this.update({ phase: 'verification_required', message: error.message });
      throw error;
    }
  }
  async release(context: BrowserContext) {
    const current = this.current;
    if (current?.context !== context) return;
    clearTimeout(current.timer);
    this.current = null;
    await context.close().catch(() => {});
  }
  async refresh() {
    const source = this.source();
    if (!source)
      throw new AppError(409, 'TIKTOK_ACCOUNT_REQUIRED', 'Сначала подключите аккаунт TikTok.');
    const context = await this.acquire(source);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await this.verify(context, page);
      const discovery = await discoverVideos(page, source.url, 20, AbortSignal.timeout(45000));
      this.update({
        videos: discovery.videos,
        coverage: discovery.complete ? 'complete' : 'partial',
        message: undefined,
      });
      return this.state();
    } finally {
      await this.release(context);
    }
  }
  remember(source: AnalysisSource, discovery: VideoDiscovery) {
    if (source.url !== this.source()?.url) return;
    this.update({
      videos: discovery.videos,
      coverage: discovery.complete ? 'complete' : 'partial',
    });
  }
  reportError(error: unknown) {
    if (!(error instanceof AppError)) return;
    if (
      [
        'TIKTOK_AGE_REQUIRED',
        'TIKTOK_VERIFICATION',
        'TIKTOK_BLOCKED',
        'TIKTOK_RATE_LIMIT',
      ].includes(error.code)
    )
      this.update({ phase: 'verification_required', message: error.message });
    else if (error.code === 'TIKTOK_LOGIN_REQUIRED')
      this.update({ phase: 'expired', message: error.message });
    else if (error.code === 'TIKTOK_ACCOUNT_CHANGED')
      this.update({ phase: 'unavailable', message: error.message });
  }
  async disconnect() {
    if (this.busy)
      throw new AppError(409, 'TIKTOK_ACCOUNT_BUSY', 'Сначала завершите вход или сбор TikTok.');
    const root = resolve(this.store.directory);
    if (!this.profileDirectory.startsWith(root + sep))
      throw new Error('Invalid TikTok profile path');
    await rm(this.profileDirectory, { recursive: true, force: true });
    this.value = {
      phase: 'disconnected',
      selection: this.value.selection,
      videos: [],
      coverage: 'unknown',
    };
    this.store.deleteSecret('tiktok-account-v1');
    return this.state();
  }
  async close() {
    this.shutdown = true;
    if (this.current) await this.release(this.current.context);
    await this.operation;
  }
}
