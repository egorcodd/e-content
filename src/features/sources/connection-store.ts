import { useEffect, useSyncExternalStore } from 'react';
import { api, refreshLocalSession } from '../collection/api';
import type { TelegramAuthState } from '../collection/contracts';
import type { ConnectedAccount, PublicReaderStatus } from './connections';
import type { TikTokConnectionState } from './tiktok-contracts';

let snapshot: {
  loading: boolean;
  busy: boolean;
  accounts: ConnectedAccount[];
  auth: TelegramAuthState | null;
  error: string;
  tiktok?: PublicReaderStatus;
  tiktokAccount?: TikTokConnectionState;
} = { loading: true, busy: false, accounts: [], auth: null, error: '' };
const listeners = new Set<() => void>();
const update = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
let refreshPromise: Promise<void> | undefined;
let checkingTimer: ReturnType<typeof setTimeout> | undefined;
export function refreshConnections() {
  return (refreshPromise ??= (async () => {
    try {
      const connection = await refreshLocalSession();
      const auth = await api<TelegramAuthState>('/telegram/auth');
      update({
        accounts: connection.accounts,
        auth,
        tiktok: connection.publicReaders?.tiktok,
        tiktokAccount: connection.tiktok,
        error: '',
        loading: false,
      });
    } catch (error) {
      update({
        loading: false,
        error: error instanceof Error ? error.message : 'Сервер подключения недоступен.',
      });
    }
  })().finally(() => {
    refreshPromise = undefined;
    clearTimeout(checkingTimer);
    if (snapshot.tiktokAccount?.phase === 'checking' && listeners.size)
      checkingTimer = setTimeout(() => {
        if (listeners.size) void refreshConnections();
      }, 1000);
  }));
}
export async function telegramAction(
  action: 'configure' | 'code' | 'confirm' | 'password' | 'cancel' | 'reset-app',
  body: unknown = {},
) {
  if (snapshot.busy) throw new Error('Предыдущий запрос ещё выполняется.');
  update({ busy: true });
  try {
    const auth = await api<TelegramAuthState>(`/telegram/${action}`, 'POST', body);
    update({ auth });
    await refreshConnections();
  } catch (error) {
    await refreshConnections();
    throw error;
  } finally {
    update({ busy: false });
  }
}
export async function revokeTelegram(id: string) {
  update({ busy: true });
  try {
    await api(`/connections/accounts/${encodeURIComponent(id)}`, 'DELETE');
    await refreshConnections();
  } finally {
    update({ busy: false });
  }
}
export function useConnections() {
  useEffect(() => {
    void refreshConnections();
    const refresh = () => void refreshConnections();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
