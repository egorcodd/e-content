import { CheckCircleIcon, PlusIcon } from '@phosphor-icons/react';
import type { ConnectedAccount } from './connections';
import { platformNames, type Platform } from './model';

export function ConnectorStatus({
  platform,
  accounts,
  loading,
  unavailable,
}: {
  platform: Platform;
  accounts: ConnectedAccount[];
  loading: boolean;
  unavailable: boolean;
}) {
  const list = accounts.filter((account) => account.platform === platform);
  const connected = list.some((account) => account.status === 'connected');
  return (
    <span className="sp-connection-state" data-connected={connected}>
      {connected ? <CheckCircleIcon size={13} /> : <span className="sp-state-dot" />}
      {loading
        ? 'Проверяем подключение'
        : connected
          ? 'Подключён'
          : unavailable
            ? 'Не проверено'
            : list.length
              ? 'Нужно войти снова'
              : 'Не подключён'}
    </span>
  );
}
export function ConnectorAccount({
  platform,
  accounts,
  loading,
  unavailable,
  connect,
  disconnect,
}: {
  platform: Platform;
  accounts: ConnectedAccount[];
  loading: boolean;
  unavailable: boolean;
  connect: (platform: Platform) => void;
  disconnect: (account: ConnectedAccount) => void;
}) {
  const list = accounts.filter((account) => account.platform === platform);
  const connected = list.some((account) => account.status === 'connected');
  return (
    <div className="cv-account-block">
      <div className="cv-account-status">
        <ConnectorStatus
          platform={platform}
          accounts={accounts}
          loading={loading}
          unavailable={unavailable}
        />
        <button
          className="ec-button cv-connect"
          disabled={loading}
          onClick={() => connect(platform)}
          aria-label={`${connected ? 'Ещё аккаунт' : 'Подключить'} ${platformNames[platform]}`}
        >
          <PlusIcon size={14} />
          {connected ? 'Ещё аккаунт' : 'Подключить'}
        </button>
      </div>
      {!!list.length && (
        <div className="sp-account-list">
          {list.map((account) => (
            <div key={account.id}>
              <span className="sp-avatar">
                {account.displayName.slice(0, 1).toLocaleUpperCase('ru')}
              </span>
              <div>
                <strong>{account.displayName}</strong>
                <small>
                  {account.status === 'expired'
                    ? 'Сессия истекла'
                    : account.handle || 'Аккаунт подключён'}
                </small>
              </div>
              <button
                className="ec-text"
                onClick={() => disconnect(account)}
                aria-label={`Отключить ${account.displayName}`}
              >
                Отключить
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
