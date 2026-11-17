import { useEffect, useRef, useState } from 'react';
import { ArrowClockwiseIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { LabDialog, Segment } from '../../shared/ui';
import { api } from '../collection/api';
import { useConnections, refreshConnections } from './connection-store';
import { SourceSwitch } from './SourceSwitch';
import type { TikTokSelection as Selection } from './tiktok-contracts';
import { ZenExtensionSetup } from './ZenExtensionSetup';
import { parseSource, plural } from './model';
import { tiktokCollectionLimits, type TikTokConnectionState } from './tiktok-contracts';
import { TikTokCollectionLimits } from './TikTokCollectionLimits';

function useTikTokActions() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function action(
    name: 'connect' | 'cancel' | 'videos' | 'selection' | 'disconnect' | 'pairing',
    body: unknown = {},
  ) {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await api(name === 'pairing' ? '/zen/pairing' : '/tiktok/' + name, 'POST', body);
      await refreshConnections();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось обновить подключение TikTok.');
      await refreshConnections();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, action };
}
export function TikTokConnection({ next }: { next: () => void }) {
  const { tiktokAccount: state, loading, error: connectionError } = useConnections();
  const { busy, error, action } = useTikTokActions();
  const [disconnect, setDisconnect] = useState(false);
  const previous = useRef(state?.phase);
  useEffect(() => {
    if (
      state?.phase === 'connected' &&
      previous.current !== undefined &&
      previous.current !== 'connected'
    )
      next();
    previous.current = state?.phase;
  }, [state?.phase, next]);
  useEffect(() => {
    if (state?.transport !== 'zen' && !state?.windowOpen && state?.phase !== 'checking') return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await refreshConnections();
      if (active) timer = setTimeout(refresh, 1500);
    };
    timer = setTimeout(refresh, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state?.windowOpen, state?.phase, state?.transport]);
  if (loading)
    return (
      <div className="pc-flow">
        <p>Проверяем подключение…</p>
      </div>
    );
  if (state?.transport === 'native') return <TikTokProfileConnection state={state} next={next} />;
  const connected = state?.phase === 'connected';
  const zen = state?.transport === 'zen';
  return (
    <div className="pc-flow">
      <div className="pc-title">
        <div>
          <h3>{connected ? state.account?.displayName : 'Вход в TikTok'}</h3>
          <p>
            {connected
              ? '@' + state.account?.handle
              : zen
                ? 'Используем аккаунт, в который вы уже вошли в Zen.'
                : state?.windowOpen
                  ? 'Выберите вход по QR-коду в окне TikTok и подтвердите его в приложении на телефоне. Подключение определится автоматически.'
                  : 'Войдите по QR-коду через приложение TikTok на телефоне. Аккаунт и выбор роликов сохранятся.'}
          </p>
        </div>
      </div>
      {zen && (
        <ZenExtensionSetup state={state} busy={busy} generate={() => void action('pairing')} />
      )}
      {(error || connectionError || state?.message) && (
        <p className="pc-field-error" role="alert">
          {error || connectionError || state?.message}
        </p>
      )}
      <div className="pc-actions">
        {connected ? (
          <>
            <button className="ec-button ec-white" onClick={next}>
              Выбрать ролики
              <ArrowRightIcon size={15} />
            </button>
            <button className="ec-text" disabled={busy} onClick={() => setDisconnect(true)}>
              Отключить
            </button>
          </>
        ) : (
          <>
            {(!zen || state.extension?.paired || state.phase === 'checking') && (
              <button
                className="ec-button ec-white"
                disabled={busy || state?.phase === 'checking'}
                onClick={() => void action('connect')}
              >
                {busy
                  ? 'Открываем…'
                  : state?.phase === 'checking'
                    ? 'Проверяем аккаунт…'
                    : zen
                      ? state.extension?.online
                        ? 'Проверить аккаунт'
                        : state.extension?.pairing
                          ? 'Обновить код'
                          : 'Переподключить Zen'
                      : state?.windowOpen
                        ? 'Показать окно TikTok'
                        : state?.account
                          ? 'Войти снова'
                          : 'Подключить TikTok'}
              </button>
            )}
            {(state?.windowOpen || (zen && state.phase === 'checking')) && (
              <button className="ec-text" disabled={busy} onClick={() => void action('cancel')}>
                Отменить вход
              </button>
            )}
          </>
        )}
      </div>
      {disconnect && (
        <LabDialog
          title="Отключить TikTok"
          close={() => {
            if (!busy) setDisconnect(false);
          }}
        >
          <p>Подключение будет удалено из e-content. Собранные комментарии и идеи останутся.</p>
          <div className="ec-dialog-actions">
            <button className="ec-button" disabled={busy} onClick={() => setDisconnect(false)}>
              Отмена
            </button>
            <button
              className="ec-button ec-white"
              disabled={busy}
              onClick={async () => {
                if (await action('disconnect')) setDisconnect(false);
              }}
            >
              Отключить аккаунт
            </button>
          </div>
        </LabDialog>
      )}
    </div>
  );
}
function TikTokProfileConnection({
  state,
  next,
}: {
  state: TikTokConnectionState;
  next: () => void;
}) {
  const { busy, error, action } = useTikTokActions();
  const [handle, setHandle] = useState(state.account ? '@' + state.account.handle : '');
  const [fieldError, setFieldError] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  const pending = busy || state.phase === 'checking';
  const connected = state.phase === 'connected';
  const account = state.account;
  const username = account && `@${account.handle}`;
  const displayName = account?.displayName.trim();
  const distinctName =
    displayName && displayName.replace(/^@/, '').toLowerCase() !== account?.handle.toLowerCase();
  return (
    <div className="pc-flow">
      <div className="pc-title">
        <div className={connected ? 'tt-profile-identity' : undefined}>
          <h3>{connected ? (distinctName ? displayName : username) : 'Профиль TikTok'}</h3>
          {connected && distinctName && <p>{username}</p>}
        </div>
      </div>
      {!connected && (
        <form
          className="pc-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            try {
              const parsed = parseSource(handle.trim(), 'tiktok');
              if (parsed.kind !== 'profile')
                throw new Error('Укажите профиль, чтобы собирать последние ролики.');
              setFieldError('');
              void action('connect', { handle: parsed.url });
            } catch (error) {
              setFieldError(error instanceof Error ? error.message : 'Проверьте имя профиля.');
            }
          }}
        >
          <label className="pc-field">
            <span>Имя или ссылка на профиль</span>
            <input
              name="tiktok-profile"
              value={handle}
              maxLength={250}
              placeholder="@egorcod"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-invalid={!!fieldError}
              onChange={(event) => {
                setHandle(event.target.value);
                setFieldError('');
              }}
            />
          </label>
          {fieldError && (
            <p className="pc-field-error" role="alert">
              {fieldError}
            </p>
          )}
          <div className="pc-actions">
            <button className="ec-button ec-white" disabled={pending}>
              {pending ? 'Проверяем профиль…' : 'Подключить профиль'}
              <ArrowRightIcon size={15} />
            </button>
            {state.phase === 'checking' && (
              <button type="button" className="ec-text" onClick={() => void action('cancel')}>
                Отменить
              </button>
            )}
          </div>
        </form>
      )}
      {(error || state.message) && (
        <p className="pc-field-error" role="alert">
          {error || state.message}
        </p>
      )}
      {connected && (
        <div className="pc-actions">
          <button className="ec-button ec-white" onClick={next}>
            Ролики для цеха
          </button>
          <button className="ec-text" onClick={() => setDisconnect(true)}>
            Сменить профиль
          </button>
        </div>
      )}
      {disconnect && (
        <LabDialog
          title="Отключить профиль TikTok"
          close={() => {
            if (!busy) setDisconnect(false);
          }}
        >
          <p>Собранные комментарии и идеи останутся в библиотеке.</p>
          <div className="ec-dialog-actions">
            <button className="ec-button" disabled={busy} onClick={() => setDisconnect(false)}>
              Отмена
            </button>
            <button
              className="ec-button ec-white"
              disabled={busy}
              onClick={async () => {
                if (await action('disconnect')) {
                  setHandle('');
                  setDisconnect(false);
                }
              }}
            >
              Отключить
            </button>
          </div>
        </LabDialog>
      )}
    </div>
  );
}
const videoPageSize = 5;
const number = new Intl.NumberFormat('ru');

export function TikTokSelection({
  commentsEnabled,
  includeReplies,
  runCommentLimit,
}: {
  commentsEnabled: boolean;
  includeReplies: boolean;
  runCommentLimit: number;
}) {
  const { tiktokAccount: state } = useConnections();
  const { busy, error, action } = useTikTokActions();
  const [visibleCount, setVisibleCount] = useState(videoPageSize);
  if (!state?.account)
    return (
      <div className="pc-flow">
        <p>Подключите профиль TikTok, чтобы настроить сбор роликов.</p>
      </div>
    );
  const select = (patch: Partial<Selection>) =>
    void action(
      'selection',
      state.transport === 'native' ? patch : { ...state.selection, ...patch },
    );
  const videos = state.videos.slice(0, state.selection.latest);
  const native = state.transport === 'native';
  const checking = state.phase === 'checking';
  const pending = busy || checking;
  const visibleVideos = native ? videos.slice(0, visibleCount) : videos;
  const nextCount = Math.min(videoPageSize, videos.length - visibleCount);
  const savedComments =
    state.selection.commentsPerVideo ?? tiktokCollectionLimits.defaultCommentsPerVideo;
  const videoLimit = state.selection.latest;
  const videoLabel = `${videoLimit} ${plural(videoLimit, 'ролик', 'ролика', 'роликов')}`;
  return (
    <div className="tt-selection">
      <div className="tt-selection-heading">
        <div>
          <h3>{state.authentication === 'public' ? 'Ролики профиля' : 'Ваши ролики'}</h3>
          <p>@{state.account.handle}</p>
        </div>
        <button
          type="button"
          className={native ? 'tt-list-refresh' : 'ec-text'}
          aria-label={checking ? 'Обновляем список роликов' : 'Обновить список роликов'}
          title={native ? 'Обновить список роликов' : undefined}
          aria-busy={checking}
          disabled={pending || state.windowOpen}
          onClick={() => void action('videos')}
        >
          {native ? (
            <ArrowClockwiseIcon size={17} aria-hidden="true" />
          ) : checking ? (
            'Обновляем…'
          ) : (
            'Обновить список'
          )}
        </button>
      </div>
      {native ? (
        <TikTokCollectionLimits
          key={state.account.id}
          selection={state.selection}
          busy={pending}
          commentsEnabled={commentsEnabled}
          includeReplies={includeReplies}
          runCommentLimit={runCommentLimit}
          save={async (patch) => {
            const saved = await action('selection', patch);
            if (saved && patch.latest !== videoLimit) setVisibleCount(videoPageSize);
            return saved;
          }}
        />
      ) : (
        <Segment
          label="Ролики для анализа TikTok"
          value={String(state.selection.latest)}
          onChange={(value) => {
            if (!busy) select({ latest: Number(value) as 10 | 20 });
          }}
          values={[
            { id: '10', label: 'Последние 10' },
            { id: '20', label: 'Последние 20' },
          ]}
        />
      )}
      <div className="tt-selection-toggle">
        <span>{native ? 'Собирать ролики этого профиля в цехе' : 'Включить в цех'}</span>
        <SourceSwitch
          label="Анализировать свои ролики TikTok"
          checked={state.selection.enabled}
          disabled={pending}
          onChange={() => select({ enabled: !state.selection.enabled })}
        />
      </div>
      {native && (
        <p className="tt-applied-selection" role="status">
          {state.selection.enabled
            ? `При запуске цех возьмёт до ${videoLimit} из самых свежих роликов${commentsEnabled ? ` и до ${number.format(savedComments)} комментариев на каждый` : ''}.`
            : 'Цех пропустит этот профиль.'}
        </p>
      )}
      {(error || state.message) && (
        <p className="pc-field-error" role="alert">
          {error || state.message}
        </p>
      )}
      <div className="tt-video-summary" role="status">
        <span>
          {native
            ? checking
              ? `Обновляем выборку · до ${videoLimit} роликов`
              : `Найдено ${videos.length} из ${videoLabel}`
            : `${videos.length} ${plural(videos.length, 'ролик', 'ролика', 'роликов')} в выборке`}
        </span>
        {!checking && state.coverage === 'partial' && <span>Список получен частично</span>}
      </div>
      <ol className="tt-video-list" data-paged={native || undefined} aria-busy={checking}>
        {visibleVideos.map((video) => (
          <li key={video.id}>
            <a href={video.url} target="_blank" rel="noreferrer">
              <span>{video.text || 'Видео без описания'}</span>
              <small>
                {video.publishedAt
                  ? new Intl.DateTimeFormat('ru', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }).format(new Date(video.publishedAt))
                  : 'Дата не получена'}
                {video.metrics.views !== undefined
                  ? ` · ${video.metrics.views.toLocaleString('ru')} просмотров`
                  : ''}
                {native &&
                  video.metrics.comments !== undefined &&
                  ` · ${number.format(video.metrics.comments)} ${plural(video.metrics.comments, 'комментарий', 'комментария', 'комментариев')}`}
              </small>
            </a>
          </li>
        ))}
      </ol>
      {native && nextCount > 0 && (
        <button
          className="ec-button tt-show-more"
          type="button"
          onClick={() => setVisibleCount(visibleCount + videoPageSize)}
        >
          Показать ещё {nextCount}
        </button>
      )}
      {!checking && !videos.length && (
        <p className="dk-list-empty">
          {state.coverage === 'complete'
            ? 'В профиле пока нет доступных роликов.'
            : 'Обновите список, чтобы получить ролики профиля.'}
        </p>
      )}
    </div>
  );
}
