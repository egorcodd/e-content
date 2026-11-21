import type { SourceConfiguration } from '../src/features/sources/model.ts';
import { resolveCollectionSettings } from '../src/features/sources/collection-policy.ts';
import type { TelegramMeasurement } from '../src/features/analytics/contracts.ts';
import type { CollectionRun } from '../src/features/collection/contracts.ts';
import type { TelegramAccount } from './telegram-account.ts';
import type { LocalStore } from './store.ts';
import type { TikTokAnalytics } from './analytics.ts';
import type { NativeTikTokSource } from './tiktok/native-source.ts';
import { TikTokReadBacklog } from './tiktok/read-backlog.ts';

export class WorkshopAnalytics {
  private active?: Promise<void>;
  private periodicControl = new AbortController();
  constructor(
    private store: LocalStore,
    private account: TelegramAccount,
    private catalog: TikTokAnalytics,
    private tiktok?: NativeTikTokSource,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS telegram_measurements (
      account TEXT NOT NULL, source TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(account,source,date))`);
  }
  get busy() {
    return !!this.active;
  }
  history() {
    const account = this.account.accounts()[0]?.id;
    return account
      ? this.store.db
          .prepare('SELECT body FROM telegram_measurements WHERE account=? ORDER BY date')
          .all(account)
          .map((row) => JSON.parse(String(row.body)) as TelegramMeasurement)
      : [];
  }
  remember(config: SourceConfiguration) {
    this.store.setSecret('analytics-sources', config);
    if (!this.store.secret<number>('analytics-next'))
      this.store.setSecret('analytics-next', Date.now() + 24 * 3600_000);
  }
  async refresh(config: SourceConfiguration, signal: AbortSignal, run?: CollectionRun) {
    if (this.active) return this.active;
    this.active = this.measure(config, signal, run).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  periodic() {
    const config = this.store.secret<SourceConfiguration>('analytics-sources');
    if (!config || this.busy || this.periodicControl.signal.aborted) return;
    const due = this.store.secret<number>('analytics-next') ?? 0;
    if (Date.now() >= due) {
      this.store.setSecret('analytics-next', Date.now() + 3600_000);
      void this.refresh(config, this.periodicControl.signal).catch(() => {});
    }
  }
  async close() {
    this.periodicControl.abort();
    await this.active?.catch(() => {});
  }
  private async measure(config: SourceConfiguration, signal: AbortSignal, run?: CollectionRun) {
    const errors: string[] = [];
    let measured = false;
    let due = Date.now() + 24 * 3600_000;
    const tt = this.tiktok?.source();
    if (tt?.enabled && config.sources.some((s) => s.id === tt.id && s.enabled)) {
      const until = new TikTokReadBacklog(this.store.db).cooldown(tt.id, '*');
      if (until > Date.now()) {
        due = Math.min(due, until);
        run?.events.unshift('Статистика TikTok отложена до окончания паузы площадки');
      } else {
        try {
          await this.catalog.refresh(signal);
          measured = true;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'Не удалось обновить TikTok.');
        }
      }
    }
    const own = config.sources.filter(
      (s) => s.enabled && s.platform === 'telegram' && s.purpose === 'own' && s.kind === 'channel',
    );
    const account = this.account.accounts()[0];
    if (account?.status === 'connected' && own.length) {
      const gateway = await this.account.connected();
      const settings = resolveCollectionSettings(
        config.settings,
        config.platforms.telegram.custom,
      ).values;
      let remaining = config.runLimits.maxPublications,
        requests = config.runLimits.maxRequests;
      gateway.beforeRequest = async () => {
        signal.throwIfAborted();
        if (--requests < 0) throw Error('Достигнут предел запросов к Telegram.');
      };
      try {
        for (const src of own) {
          try {
            signal.throwIfAborted();
            const peer = await gateway.resolve(src, signal);
            const now = Date.now(),
              date = new Date(now).toISOString();
            const since =
              settings.period === 'all' ? 0 : now / 1000 - Number(settings.period) * 86400;
            const item: TelegramMeasurement = {
              date,
              sourceId: src.id,
              url: src.url,
              title: src.title,
              posts: 0,
              subscribers: await gateway.subscribers?.(peer, signal),
            };
            let cursor = 0,
              limit = Math.min(remaining, settings.maxPublications);
            while (limit > 0) {
              const page = await gateway.posts(
                peer,
                cursor,
                Math.floor(now / 1000) + 1,
                Math.min(limit, 100),
                signal,
              );
              limit -= page.count;
              remaining -= page.count;
              for (const post of page.items.filter((p) => p.date >= since)) {
                item.posts++;
                for (const k of ['views', 'reactions', 'forwards'] as const) {
                  const n = post.metrics[k];
                  if (n !== undefined) item[k] = (item[k] ?? 0) + n;
                }
                item.comments = (item.comments ?? 0) + post.commentCount;
              }
              if (!page.count || !page.cursor || page.items.some((p) => p.date < since)) break;
              if (page.cursor === cursor) throw Error('Telegram повторил страницу статистики.');
              cursor = page.cursor;
            }
            this.store.db
              .prepare('INSERT OR REPLACE INTO telegram_measurements VALUES (?,?,?,?)')
              .run(account.id, src.id, date, JSON.stringify(item));
            measured = true;
          } catch (error) {
            signal.throwIfAborted();
            errors.push(error instanceof Error ? error.message : 'Telegram недоступен.');
          }
        }
      } finally {
        gateway.beforeRequest = undefined;
      }
    }
    signal.throwIfAborted();
    this.store.setSecret(
      'analytics-next',
      errors.length ? Math.min(due, Date.now() + 3600_000) : due,
    );
    if (errors.length) throw Error(errors.join(' '));
    if (run && !measured && !run.skipped.includes('analytics')) run.skipped.push('analytics');
  }
}
