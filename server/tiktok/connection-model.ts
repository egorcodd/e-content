import { LocalStore } from '../store.ts';
import { AppError } from '../errors.ts';
import type { AnalysisSource, SourceConfiguration } from '../../src/features/sources/model.ts';
import type {
  TikTokConnectionState,
  TikTokSelection,
} from '../../src/features/sources/tiktok-contracts.ts';

export class TikTokConnectionModel {
  protected value: Omit<TikTokConnectionState, 'windowOpen'>;
  constructor(
    protected store: LocalStore,
    private key = 'tiktok-account-v1',
  ) {
    this.value = store.secret<Omit<TikTokConnectionState, 'windowOpen'>>(key) ?? {
      phase: 'disconnected',
      selection: { latest: 20, enabled: true },
      videos: [],
      coverage: 'unknown',
    };
    if (['waiting_login', 'checking'].includes(this.value.phase))
      this.value.phase = this.value.account ? 'unavailable' : 'disconnected';
  }
  protected update(patch: Partial<typeof this.value>) {
    this.value = { ...this.value, ...patch };
    this.store.setSecret(this.key, this.value);
  }
  state(): TikTokConnectionState {
    return { ...this.value, windowOpen: false };
  }
  accounts() {
    const account = this.value.account;
    return account
      ? [
          {
            id: 'tiktok:' + account.id,
            platform: 'tiktok' as const,
            displayName: account.displayName,
            handle: '@' + account.handle,
            status: this.value.phase === 'expired' ? ('expired' as const) : ('connected' as const),
          },
        ]
      : [];
  }
  source(): AnalysisSource | null {
    const account = this.value.account;
    return account
      ? {
          id: 'tiktok-own-' + account.id,
          platform: 'tiktok',
          kind: 'profile',
          title: '@' + account.handle,
          url: 'https://www.tiktok.com/@' + account.handle,
          accountId: 'tiktok:' + account.id,
          purpose: 'own',
          enabled: this.value.selection.enabled,
          createdAt: this.value.checkedAt ?? new Date().toISOString(),
        }
      : null;
  }
  configuration(config: SourceConfiguration): SourceConfiguration {
    const own = this.source();
    if (!own) return config;
    return {
      ...config,
      sources: [
        ...config.sources.filter(
          (source) => source.platform !== 'tiktok' || source.purpose !== 'own',
        ),
        own,
      ],
      platforms: {
        ...config.platforms,
        tiktok: {
          ...config.platforms.tiktok,
          custom: {
            ...config.platforms.tiktok.custom,
            maxPublications: this.value.selection.latest,
          },
        },
      },
    };
  }
  select(input: unknown) {
    const selection = input as Partial<TikTokSelection> | null;
    if (
      !selection ||
      ![10, 20].includes(selection.latest as number) ||
      typeof selection.enabled !== 'boolean'
    )
      throw new AppError(400, 'TIKTOK_SELECTION', 'Выберите последние 10 или 20 роликов.');
    this.update({ selection: { latest: selection.latest as 10 | 20, enabled: selection.enabled } });
    return this.state();
  }
}
