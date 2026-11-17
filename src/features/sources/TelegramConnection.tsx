import { useId, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { LabDialog } from '../../shared/ui';
import { validateConnectionIdentity } from './connection-validation';
import {
  refreshConnections,
  revokeTelegram,
  telegramAction,
  useConnections,
} from './connection-store';

export function TelegramConnection({ next }: { next: () => void }) {
  const state = useConnections();
  const [apiId, setApiId] = useState(''),
    [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [disconnect, setDisconnect] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const phase = state.auth?.phase;
  const account = state.accounts.find(
    (item) => item.platform === 'telegram' && item.status === 'connected',
  );
  async function submit() {
    setError('');
    try {
      if (phase === 'setup') {
        if (!/^\d+$/.test(apiId) || !Number(apiId) || !/^[a-f\d]{32}$/i.test(apiHash.trim()))
          throw new Error('Проверьте api_id и api_hash приложения.');
        await telegramAction('configure', { apiId: Number(apiId), apiHash: apiHash.trim() });
        setApiHash('');
      } else if (phase === 'phone') {
        const result = validateConnectionIdentity('telegram', phone);
        if (result.error) throw new Error(result.error);
        await telegramAction('code', { phone: result.value });
        setCode('');
      } else if (phase === 'code') {
        const length = state.auth?.codeLength;
        if (!code) throw new Error('Введите код подтверждения.');
        if (!new RegExp(`^\\d{${length}}$`).test(code))
          throw new Error(`Введите код из ${length} цифр.`);
        await telegramAction('confirm', { code });
        setCode('');
      } else if (phase === 'password') {
        if (!password) throw new Error('Введите пароль двухэтапной защиты.');
        try {
          await telegramAction('password', { password });
        } finally {
          setPassword('');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось подключить Telegram.');
      field.current?.focus();
    }
  }
  if (state.loading)
    return (
      <div className="pc-flow" role="status">
        Проверяем подключение…
      </div>
    );
  if (!state.auth)
    return (
      <div className="pc-flow">
        <p className="sp-error" role="alert">
          {state.error}
        </p>
        <button className="ec-button" onClick={() => void refreshConnections()}>
          Повторить
        </button>
      </div>
    );
  if (phase === 'connected' && account)
    return (
      <div className="pc-flow pc-connected">
        <h3>Telegram подключён</h3>
        <p>
          {account.displayName}
          {account.handle ? ` · ${account.handle}` : ''}
        </p>
        <div className="pc-actions">
          <button className="ec-button ec-white" onClick={next}>
            Выбрать источники
            <ArrowRightIcon size={15} />
          </button>
          <button className="ec-text" disabled={state.busy} onClick={() => setDisconnect(true)}>
            Отключить
          </button>
        </div>
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        {disconnect && (
          <LabDialog
            title="Отключить Telegram"
            close={() => {
              if (!state.busy) setDisconnect(false);
            }}
          >
            <p>Сессия e-content будет завершена в Telegram. Сохранённые данные останутся.</p>
            <div className="ec-dialog-actions">
              <button
                className="ec-button"
                disabled={state.busy}
                onClick={() => setDisconnect(false)}
              >
                Отмена
              </button>
              <button
                className="ec-button sp-delete"
                disabled={state.busy}
                onClick={async () => {
                  try {
                    await revokeTelegram(account.id);
                    setDisconnect(false);
                  } catch (error) {
                    setDisconnect(false);
                    setError(
                      error instanceof Error ? error.message : 'Не удалось завершить сессию.',
                    );
                  }
                }}
              >
                {state.busy ? 'Отключаем…' : 'Отключить'}
              </button>
            </div>
          </LabDialog>
        )}
      </div>
    );
  const titles = {
    setup: 'Приложение Telegram',
    phone: 'Вход в Telegram',
    code: 'Подтвердите вход',
    password: 'Двухэтапная защита',
    connected: 'Telegram',
  };
  return (
    <div className="pc-flow">
      <form
        className="pc-form"
        noValidate
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {(phase === 'code' || phase === 'password') && (
          <button
            type="button"
            className="ec-text pc-back"
            disabled={state.busy}
            onClick={async () => {
              try {
                await telegramAction('cancel');
                setCode('');
                setPassword('');
                setError('');
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Не удалось вернуться к номеру.');
              }
            }}
          >
            <ArrowLeftIcon size={13} />
            Изменить аккаунт
          </button>
        )}
        <div className="pc-title">
          <div>
            <h3>{titles[phase!]}</h3>
            {phase === 'code' && <p>{state.auth.phone}</p>}
          </div>
        </div>
        {phase === 'setup' ? (
          <>
            <a
              className="ec-text"
              href="https://my.telegram.org/apps"
              target="_blank"
              rel="noreferrer"
            >
              Создать приложение Telegram
              <ArrowRightIcon size={14} />
            </a>
            <label>
              api_id
              <input
                ref={field}
                aria-label="Telegram api_id"
                value={apiId}
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                onChange={(event) => {
                  setApiId(event.target.value);
                  setError('');
                }}
                disabled={state.busy}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
              />
            </label>
            <label>
              api_hash
              <input
                type="password"
                aria-label="Telegram api_hash"
                value={apiHash}
                autoComplete="off"
                maxLength={32}
                onChange={(event) => {
                  setApiHash(event.target.value);
                  setError('');
                }}
                disabled={state.busy}
              />
            </label>
          </>
        ) : (
          <div className="pc-field">
            <label>
              {phase === 'phone'
                ? 'Номер телефона'
                : phase === 'code'
                  ? 'Код подтверждения'
                  : 'Пароль 2FA'}
              <input
                key={phase}
                ref={field}
                autoFocus={phase === 'code' || phase === 'password'}
                aria-label={
                  phase === 'phone'
                    ? 'Номер Telegram'
                    : phase === 'code'
                      ? 'Код Telegram'
                      : 'Пароль Telegram 2FA'
                }
                className={phase === 'code' ? 'pc-code' : undefined}
                type={phase === 'password' ? 'password' : phase === 'phone' ? 'tel' : 'text'}
                inputMode={phase === 'code' ? 'numeric' : undefined}
                autoComplete="off"
                disabled={state.busy}
                value={phase === 'phone' ? phone : phase === 'code' ? code : password}
                maxLength={phase === 'password' ? 256 : 40}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                placeholder={
                  phase === 'phone'
                    ? '+7 900 000-00-00'
                    : phase === 'code'
                      ? '0'.repeat(state.auth.codeLength ?? 5)
                      : undefined
                }
                onChange={(event) => {
                  setError('');
                  if (phase === 'phone') setPhone(event.target.value);
                  else if (phase === 'code') setCode(event.target.value.replace(/\s/g, ''));
                  else setPassword(event.target.value);
                }}
              />
            </label>
          </div>
        )}
        {error && (
          <p id={errorId} className="pc-field-error" role="alert">
            {error}
          </p>
        )}
        <button className="ec-button ec-white" disabled={state.busy} type="submit">
          {state.busy
            ? 'Подождите…'
            : phase === 'setup'
              ? 'Продолжить'
              : phase === 'phone'
                ? 'Получить код'
                : phase === 'code'
                  ? 'Подтвердить вход'
                  : 'Войти'}
          {!state.busy && <ArrowRightIcon size={15} />}
        </button>
        {phase === 'phone' && (
          <button
            className="ec-text"
            type="button"
            disabled={state.busy}
            onClick={() =>
              void telegramAction('reset-app').catch((error) => setError(error.message))
            }
          >
            Изменить приложение
          </button>
        )}
      </form>
    </div>
  );
}
