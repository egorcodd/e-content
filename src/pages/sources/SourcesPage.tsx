import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowSquareOutIcon,
  ArrowRightIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  PlugsConnectedIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { LabDialog, Segment } from '../../shared/ui';
import { SiteLink } from '../../app/navigation';
import { CollectionForm, SourceSwitch } from '../../features/sources/CollectionForm';
import { SourceDialog } from '../../features/sources/SourceDialog';
import { useSources, saveSource, removeSource } from '../../features/sources/repository';
import {
  beginConnection,
  disconnectAccount,
  readConnections,
  type ConnectedAccount,
  type ConnectionState,
} from '../../features/sources/connections';
import {
  kindNames,
  platformNames,
  type AnalysisSource,
  type Platform,
} from '../../features/sources/model';
import { SourceLayouts } from '../../features/sources/SourceLayouts';
import {
  readSourceLayout,
  sourceLayouts,
  type SourceLayout,
} from '../../features/sources/connector-catalog';
import './sources.css';

const platforms: Platform[] = ['telegram', 'tiktok'];
const platformIcons = { telegram: TelegramLogoIcon, tiktok: TiktokLogoIcon };
export default function SourcesPage({ notify }: { notify: (text: string) => void }) {
  const configuration = useSources();
  const readPlatform = () => {
    const value = new URLSearchParams(location.search).get('platform');
    return value === 'telegram' || value === 'tiktok' ? value : 'all';
  };
  const [platform, setPlatform] = useState(readPlatform);
  const [layout, setLayout] = useState(readSourceLayout);
  const [step, setStep] = useState(0);
  function changeLayout(value: string) {
    setLayout(value as SourceLayout);
    const url = new URL(location.href);
    url.searchParams.set('layout', value);
    history.replaceState(null, '', url);
    try {
      localStorage.setItem('e-content-sources-layout', value);
    } catch {}
  }
  function changePlatform(value: string) {
    setPlatform(value);
    const url = new URL(location.href);
    if (value === 'all') url.searchParams.delete('platform');
    else url.searchParams.set('platform', value);
    history.replaceState(null, '', url);
  }
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ source?: AnalysisSource; platform?: Platform } | null>(null);
  const [remove, setRemove] = useState<AnalysisSource | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [error, setError] = useState('');
  const [connect, setConnect] = useState<Platform | null>(null);
  const [disconnect, setDisconnect] = useState<ConnectedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const reduced = useReducedMotion();
  const refresh = useCallback(async () => {
    const sequence = ++generation.current;
    setLoading(true);
    try {
      const state = await readConnections();
      if (generation.current !== sequence) return;
      setConnection(state);
      setConnectionError('');
    } catch (error) {
      if (generation.current !== sequence) return;
      setConnection(null);
      setConnectionError(
        error instanceof Error ? error.message : 'Не удалось проверить подключение.',
      );
    } finally {
      if (generation.current === sequence) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', focus);
    const onBack = () => {
      setPlatform(readPlatform());
      setLayout(readSourceLayout());
    };
    window.addEventListener('popstate', onBack);
    return () => {
      generation.current++;
      window.removeEventListener('focus', focus);
      window.removeEventListener('popstate', onBack);
    };
  }, [refresh]);
  const sources = configuration.sources
    .filter(
      (source) =>
        (platform === 'all' || platform === source.platform) &&
        `${source.title} ${source.url}`
          .toLocaleLowerCase('ru')
          .includes(query.toLocaleLowerCase('ru')),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const accounts = connection?.accounts ?? [];
  const selected = configuration.sources.filter((source) => source.enabled).length;
  function action(callback: () => void) {
    try {
      callback();
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить изменения.');
    }
  }
  async function authorize() {
    if (!connection || !connect) return;
    setBusy(true);
    setError('');
    try {
      location.assign(await beginConnection(connect, connection.csrfToken));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось начать подключение.');
      setBusy(false);
    }
  }
  const classicConnections = (
    <section className="sp-connections" aria-labelledby="sp-accounts-title">
      <div className="sp-section-heading">
        <h2 id="sp-accounts-title">Подключения</h2>
        <button
          className="ec-text sp-refresh"
          disabled={loading}
          onClick={() => void refresh()}
          aria-label="Проверить подключения"
        >
          <ArrowClockwiseIcon size={15} className={loading && !reduced ? 'sp-spinning' : ''} />
          {loading ? 'Проверяем' : 'Проверить'}
        </button>
      </div>
      <div className="sp-account-grid">
        {platforms.map((id) => {
          const Icon = platformIcons[id];
          const list = accounts.filter((account) => account.platform === id);
          const connected = list.some((account) => account.status === 'connected');
          return (
            <article className="sp-account ec-glow" key={id}>
              <div className="sp-account-top">
                <span className="sp-platform-icon">
                  <Icon size={26} />
                </span>
                <div>
                  <h3>{platformNames[id]}</h3>
                  <span className="sp-connection-state" data-connected={connected}>
                    {connected ? <CheckCircleIcon size={13} /> : <span className="sp-state-dot" />}
                    {loading
                      ? 'Проверка подключения'
                      : connected
                        ? 'Подключён'
                        : connectionError
                          ? 'Не проверено'
                          : list.length
                            ? 'Нужно войти снова'
                            : 'Не подключён'}
                  </span>
                </div>
                <button
                  className="ec-button"
                  disabled={loading}
                  onClick={() => {
                    setConnect(id);
                    setError('');
                  }}
                >
                  {connected ? 'Ещё аккаунт' : 'Подключить'}
                  <PlusIcon size={15} />
                </button>
              </div>
              {list.length > 0 ? (
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
                        onClick={() => {
                          setDisconnect(account);
                          setError('');
                        }}
                        aria-label={`Отключить ${account.displayName}`}
                      >
                        Отключить
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p>
                  {id === 'telegram'
                    ? 'Каналы, публикации и обсуждения'
                    : 'Видео и комментарии аудитории'}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
  const sourceBrowser = (
    <section className="sp-source-browser ec-glow" aria-labelledby="sp-source-title">
      <div className="sp-section-heading">
        <div>
          <h2 id="sp-source-title">Что анализируем</h2>
          <span className="sp-caption">
            {selected} из {configuration.sources.length} включено в сбор
          </span>
        </div>
        <span className="sp-caption">{configuration.sources.length} / 200</span>
      </div>
      <div className="sp-browser-toolbar">
        <Segment
          label="Площадка списка источников"
          value={platform}
          onChange={changePlatform}
          values={[
            { id: 'all', label: 'Все' },
            { id: 'telegram', label: 'Telegram', icon: <TelegramLogoIcon size={16} /> },
            { id: 'tiktok', label: 'TikTok', icon: <TiktokLogoIcon size={16} /> },
          ]}
        />
        <label className="sp-search">
          <MagnifyingGlassIcon size={17} />
          <input
            aria-label="Найти источник"
            placeholder="Найти источник…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="ec-icon"
              aria-label="Очистить поиск источников"
              onClick={() => setQuery('')}
            >
              <XIcon size={15} />
            </button>
          )}
        </label>
      </div>
      {error && !connect && !disconnect && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
      <div className="sp-source-list">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={platform + query}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.12 }}
          >
            {sources.length ? (
              sources.map((source) => {
                const Icon = platformIcons[source.platform];
                const account = accounts.find((account) => account.id === source.accountId);
                const accountLabel = !source.accountId
                  ? 'Аккаунт не выбран'
                  : connectionError
                    ? 'Подключение не проверено'
                    : account?.status === 'expired'
                      ? 'Нужно войти снова'
                      : (account?.displayName ?? 'Аккаунт недоступен');
                return (
                  <article
                    className="sp-source-row"
                    data-enabled={source.enabled}
                    key={source.id}
                    aria-label={`Источник ${source.title}`}
                  >
                    <span className="sp-source-icon">
                      <Icon size={22} />
                    </span>
                    <div className="sp-source-copy">
                      <div>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.title}
                          <ArrowSquareOutIcon size={14} />
                        </a>
                        <span className="sp-kind">{kindNames[source.kind]}</span>
                      </div>
                      <span className="sp-source-url">{source.url.replace('https://', '')}</span>
                      <div className="sp-source-meta">
                        <span>{source.purpose === 'own' ? 'Мой контент' : 'Поиск идей'}</span>
                        <i />
                        <span>{accountLabel}</span>
                      </div>
                    </div>
                    <div className="sp-source-actions">
                      <SourceSwitch
                        checked={source.enabled}
                        label={`Анализировать ${source.title}`}
                        onChange={() =>
                          action(() => saveSource({ ...source, enabled: !source.enabled }))
                        }
                      />
                      <button
                        className="ec-icon"
                        aria-label={`Настроить ${source.title}`}
                        onClick={() => setForm({ source })}
                      >
                        <PencilSimpleIcon size={17} />
                      </button>
                      <button
                        className="ec-icon sp-delete"
                        aria-label={`Удалить источник ${source.title}`}
                        onClick={() => setRemove(source)}
                      >
                        <TrashIcon size={17} />
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="sp-empty">
                <div className="sp-empty-art" aria-hidden="true">
                  <span>
                    <TelegramLogoIcon size={25} />
                  </span>
                  <LinkSimpleIcon size={24} />
                  <span>
                    <TiktokLogoIcon size={25} />
                  </span>
                </div>
                <h3>
                  {query
                    ? 'Источник не найден'
                    : configuration.sources.length
                      ? 'Здесь пока нет источников'
                      : 'Выберите, откуда брать идеи'}
                </h3>
                <p>
                  {query
                    ? 'Попробуйте другое название или ссылку.'
                    : 'Добавьте свой контент или каналы, которые хотите изучить. В сбор попадут только включённые источники.'}
                </p>
                {!query && (
                  <button
                    className="ec-button"
                    onClick={() =>
                      setForm({ platform: platform === 'tiktok' ? 'tiktok' : 'telegram' })
                    }
                  >
                    <PlusIcon size={16} />
                    Добавить по ссылке
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="sp-browser-footer">
        <span>
          <PlugsConnectedIcon size={16} />
          Выбранные источники сохраняются автоматически
        </span>
        <SiteLink href="/">
          К цеху
          <ArrowRightIcon size={16} />
        </SiteLink>
      </footer>
    </section>
  );
  const settingsPanel = (
    <CollectionForm
      key={JSON.stringify(configuration.settings)}
      settings={configuration.settings}
      notify={notify}
    />
  );
  return (
    <div className={`sources-page sources-layout-${layout}`}>
      <header className="sp-page-heading">
        <div>
          <h1>Источники</h1>
          <span>Аккаунты и контент для анализа</span>
        </div>
        <button
          className="ec-button ec-white"
          onClick={() => setForm({ platform: platform === 'tiktok' ? 'tiktok' : 'telegram' })}
        >
          <PlusIcon size={18} />
          Добавить источник
        </button>
      </header>
      <div className="cv-layout-selector">
        <Segment
          label="Вариант подключения источников"
          value={layout}
          onChange={changeLayout}
          values={sourceLayouts}
        />
      </div>
      <SourceLayouts
        layout={layout}
        platform={platform}
        filter={changePlatform}
        accounts={accounts}
        sources={configuration.sources}
        settings={configuration.settings}
        platforms={configuration.platforms}
        loading={loading}
        unavailable={!!connectionError}
        connect={(id) => {
          setConnect(id);
          setError('');
        }}
        disconnect={(account) => {
          setDisconnect(account);
          setError('');
        }}
        refresh={() => void refresh()}
        add={(platform) => setForm({ platform })}
        edit={(source) => setForm({ source })}
        remove={setRemove}
        notify={notify}
        browser={sourceBrowser}
        settingsForm={settingsPanel}
        classicConnections={classicConnections}
        step={step}
        setStep={setStep}
      />
      <AnimatePresence>
        {form && (
          <SourceDialog
            {...form}
            accounts={accounts}
            close={() => setForm(null)}
            saved={() => notify(form.source ? 'Источник сохранён' : 'Источник добавлен')}
          />
        )}
        {remove && (
          <LabDialog title="Удалить источник" close={() => setRemove(null)}>
            <p>
              «{remove.title}» больше не будет участвовать в сборе. Найденные идеи останутся в
              материалах.
            </p>
            <div className="ec-dialog-actions">
              <button className="ec-button" onClick={() => setRemove(null)}>
                Отмена
              </button>
              <button
                className="ec-button sp-delete"
                onClick={() =>
                  action(() => {
                    removeSource(remove.id);
                    setRemove(null);
                    notify('Источник удалён');
                  })
                }
              >
                Удалить источник
              </button>
            </div>
            {error && (
              <p className="sp-error" role="alert">
                {error}
              </p>
            )}
          </LabDialog>
        )}
        {connect && (
          <LabDialog
            title={`Подключить ${platformNames[connect]}`}
            close={() => {
              if (!busy) setConnect(null);
            }}
            className="sources-dialog"
          >
            <div className="sp-connect-explanation">
              <PlugsConnectedIcon size={28} />
              <p>
                Подключение даёт доступ к выбранным каналам и публикациям. Список для анализа вы
                задаёте отдельно.
              </p>
            </div>
            {connectionError ? (
              <div className="sp-service-notice" role="status">
                <WarningCircleIcon size={19} />
                <div>
                  <strong>Подключение недоступно</strong>
                  <p>{connectionError}</p>
                </div>
              </div>
            ) : connection && !connection.available.includes(connect) ? (
              <p className="sp-service-notice">
                Подключение {platformNames[connect]} ещё не настроено на сервере.
              </p>
            ) : (
              <p className="sp-caption">
                Авторизация откроется отдельным шагом. Данные сессии не сохраняются в браузере.
              </p>
            )}
            {error && (
              <p className="sp-error" role="alert">
                {error}
              </p>
            )}
            <div className="ec-dialog-actions">
              <button className="ec-button" disabled={busy} onClick={() => setConnect(null)}>
                Закрыть
              </button>
              {!connection || !connection.available.includes(connect) ? (
                <button className="ec-button" disabled={loading} onClick={() => void refresh()}>
                  <ArrowClockwiseIcon size={16} />
                  {loading ? 'Проверяем…' : 'Проверить снова'}
                </button>
              ) : (
                <button
                  className="ec-button ec-white"
                  disabled={busy}
                  onClick={() => void authorize()}
                >
                  {busy ? 'Открываем…' : 'Продолжить'}
                  <ArrowRightIcon size={16} />
                </button>
              )}
            </div>
          </LabDialog>
        )}
        {disconnect && (
          <LabDialog
            title="Отключить аккаунт"
            close={() => {
              if (!busy) setDisconnect(null);
            }}
          >
            <p>Отключить «{disconnect.displayName}»? Источники и найденные идеи сохранятся.</p>
            {error && (
              <p className="sp-error" role="alert">
                {error}
              </p>
            )}
            <div className="ec-dialog-actions">
              <button className="ec-button" disabled={busy} onClick={() => setDisconnect(null)}>
                Отмена
              </button>
              <button
                className="ec-button sp-delete"
                disabled={busy || !connection}
                onClick={() => {
                  if (!connection) return;
                  setBusy(true);
                  void disconnectAccount(disconnect.id, connection.csrfToken)
                    .then(async () => {
                      setDisconnect(null);
                      await refresh();
                      notify('Аккаунт отключён');
                    })
                    .catch((error) =>
                      setError(
                        error instanceof Error ? error.message : 'Не удалось отключить аккаунт.',
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? 'Отключаем…' : 'Отключить'}
              </button>
            </div>
          </LabDialog>
        )}
      </AnimatePresence>
    </div>
  );
}
