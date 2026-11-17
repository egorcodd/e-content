import type { Platform, AnalysisSource } from './model';
import type { TikTokConnectionState } from './tiktok-contracts';

export type ConnectedAccount = {
  id: string;
  platform: Platform;
  displayName: string;
  handle?: string;
  status: 'connected' | 'expired';
};
export type ConnectionState = {
  accounts: ConnectedAccount[];
  available: Platform[];
  csrfToken: string;
  publicReaders?: { tiktok?: PublicReaderStatus };
  tiktok?: TikTokConnectionState;
  managedSources?: AnalysisSource[];
};
export type PublicReaderStatus = {
  mode: 'account';
  status:
    | 'unverified'
    | 'reading'
    | 'completed'
    | 'limited'
    | 'login_required'
    | 'confirmation_required'
    | 'blocked'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  message?: string;
  lastCheckedAt?: string;
  sourceUrl?: string;
};
export class ConnectionUnavailable extends Error {
  constructor() {
    super('Сервис подключения пока недоступен. Источники и параметры можно настроить заранее.');
  }
}
async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/connections${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', ...options?.headers },
  }).catch(() => {
    throw new ConnectionUnavailable();
  });
  if (response.status === 204) return null;
  if (
    response.status === 404 ||
    response.status === 503 ||
    !response.headers.get('content-type')?.includes('application/json')
  )
    throw new ConnectionUnavailable();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Войдите в e-content, чтобы управлять подключениями.'
        : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
    );
  return response.json();
}
export async function readConnections(): Promise<ConnectionState> {
  const result = (await request('')) as Partial<ConnectionState> & { version?: number };
  if (
    !result ||
    result.version !== 1 ||
    !Array.isArray(result.accounts) ||
    !Array.isArray(result.available) ||
    typeof result.csrfToken !== 'string' ||
    result.csrfToken.length < 16
  )
    throw new Error('Сервис подключения вернул некорректный ответ.');
  if (
    !result.accounts.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.displayName === 'string' &&
        (item.handle === undefined || typeof item.handle === 'string') &&
        ['telegram', 'tiktok'].includes(item.platform) &&
        ['connected', 'expired'].includes(item.status),
    )
  )
    throw new Error('Не удалось прочитать аккаунты.');
  return {
    accounts: result.accounts,
    available: result.available.filter((item) => ['telegram', 'tiktok'].includes(item)),
    csrfToken: result.csrfToken,
    publicReaders: result.publicReaders,
    tiktok: result.tiktok,
    managedSources: result.managedSources,
  };
}
