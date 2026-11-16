import { CheckCircleIcon } from '@phosphor-icons/react';
import type { ConnectedAccount } from './connections';
import type { Platform } from './model';

export function ConnectorStatus({
  platform,
  accounts,
  loading = false,
  unavailable = false,
  connectedLabel = 'Подключён',
}: {
  platform: Platform;
  accounts: ConnectedAccount[];
  loading?: boolean;
  unavailable?: boolean;
  connectedLabel?: string;
}) {
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
