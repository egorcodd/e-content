import { CheckCircleIcon } from '@phosphor-icons/react';
import type { ConnectedAccount } from './connections';
import type { TikTokConnectionState } from './tiktok-contracts';
import type { Platform } from './model';

export function ConnectorStatus({
  platform,
  accounts,
  loading = false,
  unavailable = false,
  connectedLabel = 'Подключён',
  connection,
}: {
  platform: Platform;
  accounts: ConnectedAccount[];
  loading?: boolean;
  unavailable?: boolean;
  connectedLabel?: string;
  connection?: TikTokConnectionState;
}) {
  if (platform === 'tiktok' && connection) {
    const labels = {
      disconnected: 'Не подключён',
      waiting_login: 'Ожидаем вход',
      checking: 'Проверяем аккаунт',
      connected: 'Подключён',
      expired: 'Нужно войти снова',
      verification_required: 'Нужна проверка в TikTok',
      unavailable: 'Временно недоступен',
    };
    const state =
      connection.phase === 'connected'
        ? 'connected'
        : connection.phase === 'disconnected' || connection.phase === 'expired'
          ? 'disconnected'
          : ['waiting_login', 'checking'].includes(connection.phase)
            ? 'checking'
            : 'unknown';
    return (
      <span
        className="sp-connection-state"
        data-state={state}
        data-connected={state === 'connected'}
      >
        {state === 'connected' ? <CheckCircleIcon size={13} /> : <span className="sp-state-dot" />}
        {connection.transport === 'native' && connection.phase === 'checking'
          ? 'Проверяем профиль'
          : labels[connection.phase]}
      </span>
    );
  }
  const list = accounts.filter((account) => account.platform === platform);
  const connected = list.some((account) => account.status === 'connected');
  const state = loading
    ? 'checking'
    : unavailable
      ? 'unknown'
      : connected
        ? 'connected'
        : list.length
          ? 'expired'
          : 'disconnected';
  return (
    <span className="sp-connection-state" data-state={state} data-connected={state === 'connected'}>
      {state === 'connected' ? <CheckCircleIcon size={13} /> : <span className="sp-state-dot" />}
      {state === 'checking'
        ? 'Проверяем подключение'
        : state === 'connected'
          ? connectedLabel
          : state === 'unknown'
            ? 'Не проверено'
            : state === 'expired'
              ? 'Нужно войти снова'
              : 'Не подключён'}
    </span>
  );
}
