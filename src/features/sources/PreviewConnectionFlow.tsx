import { useId, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  LockSimpleIcon,
} from '@phosphor-icons/react';
import { connectorCatalog } from './connector-catalog';
import {
  finishPreviewConnection,
  resetPreviewConnection,
  updatePreviewFlow,
  usePreviewConnections,
} from './preview-connections';
import { platformNames, type Platform } from './model';
import {
  normalizeConnectionCode,
  validatePreviewCode,
  validateConnectionIdentity,
} from './connection-validation';

function FieldError({ id, error }: { id: string; error: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          id={id}
          className="pc-field-error"
          role="alert"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function PreviewConnectionFlow({
  platform,
  next,
}: {
  platform: Platform;
  next: () => void;
}) {
  const { flows } = usePreviewConnections();
  const flow = flows[platform];
  const reduced = useReducedMotion();
  const provider = connectorCatalog.find((item) => item.id === platform)!;
  const identityRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const identityError = useId();
  const codeError = useId();
  const update = (patch: Parameters<typeof updatePreviewFlow>[1]) =>
    updatePreviewFlow(platform, { error: '', ...patch });
  return (
    <div className="pc-flow" aria-label={`Пример подключения ${provider.title}`}>
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={flow.phase}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.15 }}
        >
          {flow.phase === 'account' ? (
            <form
              className="pc-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const result = validateConnectionIdentity(platform, flow.identity);
                if (result.error) {
                  update({ error: result.error });
                  identityRef.current?.focus();
                  return;
                }
                update({ phase: 'verify', identity: result.value, code: '' });
              }}
            >
              <div className="pc-title">
                <div>
                  <h3>Вход в {provider.title}</h3>
                  <p>
                    {platform === 'telegram'
                      ? 'Номер аккаунта, через который будем читать каналы.'
                      : 'Профиль, который подключаем к рабочему пространству.'}
                  </p>
                </div>
              </div>
              <div className="pc-field">
                <label>
                  {platform === 'telegram' ? 'Номер телефона' : 'Имя профиля'}
                  <input
                    ref={identityRef}
                    aria-label={
                      platform === 'telegram'
                        ? 'Номер для примера Telegram'
                        : 'Профиль для примера TikTok'
                    }
                    type={platform === 'telegram' ? 'tel' : 'text'}
                    value={flow.identity}
                    onChange={(event) =>
                      update({
                        identity: event.target.value,
                        error: flow.error
                          ? validateConnectionIdentity(platform, event.target.value).error
                          : '',
                      })
                    }
                    onBlur={(event) => {
                      if (
                        event.relatedTarget instanceof HTMLButtonElement &&
                        event.relatedTarget.form === event.currentTarget.form
                      )
                        return;
                      update({ error: validateConnectionIdentity(platform, flow.identity).error });
                    }}
                    aria-invalid={!!flow.error}
                    aria-describedby={flow.error ? identityError : undefined}
                    autoComplete="off"
                    maxLength={40}
                    required
                  />
                </label>
                <FieldError id={identityError} error={flow.error} />
              </div>
              <button className="ec-button ec-white" type="submit">
                {platform === 'telegram' ? 'Получить код' : 'Продолжить'}
                <ArrowRightIcon size={15} />
              </button>
            </form>
          ) : flow.phase === 'verify' ? (
            <form
              className="pc-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (platform === 'telegram') {
                  const error = validatePreviewCode(flow.code);
                  if (error) {
                    update({ error });
                    codeRef.current?.focus();
                    return;
                  }
                }
                update({ phase: 'permissions' });
              }}
            >
              <button
                className="ec-text pc-back"
                type="button"
                onClick={() => update({ phase: 'account', code: '' })}
              >
                <ArrowLeftIcon size={13} />
                Изменить аккаунт
              </button>
              {platform === 'telegram' ? (
                <>
                  <div className="pc-title">
                    <div>
                      <h3>Подтвердите вход</h3>
                      <p>{flow.identity}</p>
                    </div>
                  </div>
                  <div className="pc-field">
                    <label>
                      Код подтверждения
                      <input
                        ref={codeRef}
                        autoFocus
                        className="pc-code"
                        aria-label="Код подтверждения примера"
                        inputMode="numeric"
                        value={flow.code}
                        onChange={(event) => {
                          const code = normalizeConnectionCode(event.target.value);
                          update({ code, error: flow.error ? validatePreviewCode(code) : '' });
                        }}
                        onBlur={(event) => {
                          if (
                            event.relatedTarget instanceof HTMLButtonElement &&
                            event.relatedTarget.form === event.currentTarget.form
                          )
                            return;
                          update({ error: validatePreviewCode(flow.code) });
                        }}
                        aria-invalid={!!flow.error}
                        aria-describedby={flow.error ? codeError : undefined}
                        placeholder="000000"
                        autoComplete="off"
                        maxLength={12}
                        required
                      />
                    </label>
                    <FieldError id={codeError} error={flow.error} />
                  </div>
                  <small className="pc-code-hint">
                    Код для просмотра: <strong>123456</strong>
                  </small>
                </>
              ) : (
                <div className="pc-device">
                  <h3>Подтвердите вход в TikTok</h3>
                  <p>{flow.identity}</p>
                  <small>В примере подтверждение выполняется кнопкой ниже.</small>
                </div>
              )}
              <button className="ec-button ec-white" type="submit">
                Подтвердить вход
                <ArrowRightIcon size={15} />
              </button>
            </form>
          ) : flow.phase === 'permissions' ? (
            <div className="pc-permissions">
              <div className="pc-title">
                <LockSimpleIcon size={24} weight="regular" />
                <div>
                  <h3>Доступ для сбора</h3>
                  <p>Только выбранный контент и доступные обсуждения.</p>
                </div>
              </div>
              <ul>
                {[
                  'Чтение выбранных источников',
                  'Сбор комментариев и веток ответов',
                  'Сохранение идей с исходными ссылками',
                ].map((text) => (
                  <li key={text}>
                    <CheckIcon size={15} />
                    {text}
                  </li>
                ))}
              </ul>
              <div className="pc-actions">
                <button className="ec-button" onClick={() => update({ phase: 'verify' })}>
                  Назад
                </button>
                <button
                  className="ec-button ec-white"
                  onClick={() => finishPreviewConnection(platform)}
                >
                  Подключить аккаунт
                  <ArrowRightIcon size={15} />
                </button>
              </div>
            </div>
          ) : (
            <div className="pc-connected">
              <span className="pc-connected-icon">
                <CheckCircleIcon size={28} weight="regular" />
              </span>
              <h3>{platformNames[platform]} подключён</h3>
              <p>Егор · {platform === 'tiktok' ? flow.identity : '@egor_qa'}</p>
              <div className="pc-actions">
                <button className="ec-button ec-white" onClick={next}>
                  Выбрать источники
                  <ArrowRightIcon size={15} />
                </button>
                <button className="ec-text" onClick={() => resetPreviewConnection(platform)}>
                  Отключить пример
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
