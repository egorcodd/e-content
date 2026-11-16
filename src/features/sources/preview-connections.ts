import { useSyncExternalStore } from 'react';
import type { ConnectedAccount } from './connections';
import type { Platform } from './model';

export type PreviewPhase = 'account' | 'verify' | 'permissions' | 'connected';
export type PreviewFlow = { phase: PreviewPhase; identity: string; code: string; error: string };
const initial = (platform: Platform): PreviewFlow => ({
  phase: 'account',
  identity: platform === 'telegram' ? '+7 900 000-00-00' : '@egor_qa',
  code: '',
  error: '',
});
let snapshot: { flows: Record<Platform, PreviewFlow>; accounts: ConnectedAccount[] } = {
  flows: { telegram: initial('telegram'), tiktok: initial('tiktok') },
  accounts: [],
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export function updatePreviewFlow(platform: Platform, patch: Partial<PreviewFlow>) {
  snapshot = {
    ...snapshot,
    flows: { ...snapshot.flows, [platform]: { ...snapshot.flows[platform], ...patch } },
  };
  emit();
}
export function finishPreviewConnection(platform: Platform) {
  const identity = snapshot.flows[platform].identity;
  const account: ConnectedAccount = {
    id: `preview:${platform}`,
    platform,
    displayName: 'Егор',
    handle: platform === 'tiktok' ? identity : '@egor_qa',
    status: 'connected',
  };
  snapshot = {
    accounts: [...snapshot.accounts.filter((item) => item.platform !== platform), account],
    flows: {
      ...snapshot.flows,
      [platform]: { ...snapshot.flows[platform], phase: 'connected', code: '', error: '' },
    },
  };
  emit();
}
export function resetPreviewConnection(platform: Platform) {
  snapshot = {
    accounts: snapshot.accounts.filter((item) => item.platform !== platform),
    flows: { ...snapshot.flows, [platform]: initial(platform) },
  };
  emit();
}
export function usePreviewConnections() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
