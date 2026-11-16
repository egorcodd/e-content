import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { LabDialog, Segment } from '../../shared/ui';
import { ConnectorAccount, ConnectorStatus } from './ConnectorAccount';
import { ConnectorObject } from './ConnectorObject';
import { DockStage } from './DockStage';
import { PlatformSteps } from './PlatformSteps';
import { connectorCatalog, type SourceLayout } from './connector-catalog';
import type { ConnectedAccount } from './connections';
import {
  platformNames,
  type AnalysisSource,
  type CollectionSettings,
  type Platform,
  type PlatformSettings,
} from './model';
import './source-layouts.css';
import './dock.css';

type Props = {
  layout: SourceLayout;
  accounts: ConnectedAccount[];
  sources: AnalysisSource[];
  settings: CollectionSettings;
  platforms: PlatformSettings;
  platform: string;
  filter: (platform: string) => void;
  loading: boolean;
  unavailable: boolean;
  connect: (platform: Platform) => void;
  disconnect: (account: ConnectedAccount) => void;
  refresh: () => void;
  add: (platform: Platform) => void;
  edit: (source: AnalysisSource) => void;
  remove: (source: AnalysisSource) => void;
  notify: (text: string) => void;
  browser: ReactNode;
  settingsForm: ReactNode;
  classicConnections: ReactNode;
  step: number;
  setStep: (step: number) => void;
};

function SettingsSummary({ settings, open }: { settings: CollectionSettings; open: () => void }) {
  return (
    <button className="cv-settings-summary" onClick={open} aria-label="Настроить параметры сбора">
      <span className="cv-settings-glyph">
        <SlidersHorizontalIcon size={20} />
      </span>
      <span>
        <strong>Параметры сбора</strong>
        <small>
          {settings.period} дней ·{' '}
          {[
            settings.comments && 'Комментарии',
            settings.publications && 'Публикации',
            settings.metrics && 'Статистика',
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <ArrowRightIcon size={17} />
    </button>
  );
}

export function SourceLayouts(props: Props) {
  const {
    layout,
    accounts,
    sources,
    settings,
    platform,
    filter,
    loading,
    unavailable,
    connect,
    disconnect,
    refresh,
    add,
    browser,
    settingsForm,
    classicConnections,
    step,
    setStep,
  } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const reduced = useReducedMotion();
  const current = platform === 'tiktok' ? 'tiktok' : 'telegram';
  const provider = connectorCatalog.find((item) => item.id === current)!;
  const selected = sources.filter((source) => source.enabled);
  const account = (id: Platform) => (
    <ConnectorAccount
      platform={id}
      accounts={accounts}
      loading={loading}
      unavailable={unavailable}
      connect={connect}
      disconnect={disconnect}
    />
  );
  const refreshButton = (
    <button
      className="ec-text sp-refresh"
      disabled={loading}
      onClick={refresh}
      aria-label="Проверить подключения"
    >
      <ArrowClockwiseIcon size={15} className={loading && !reduced ? 'sp-spinning' : ''} />
      {loading ? 'Проверяем' : 'Проверить'}
    </button>
  );
  const settingsModal = (
    <AnimatePresence>
      {settingsOpen && (
        <LabDialog
          title="Параметры сбора"
          close={() => setSettingsOpen(false)}
          className="sources-dialog cv-settings-dialog"
        >
          {settingsForm}
        </LabDialog>
      )}
    </AnimatePresence>
  );

  if (layout === 'dock')
    return (
      <div className="dk-view">
        <div className="cv-section-line">
          <h2>Стенд подключения</h2>
          {refreshButton}
        </div>
        <DockStage
          platform={platform}
          select={(id) => {
            filter(id);
            setStep(0);
          }}
          sources={sources}
          accounts={accounts}
          loading={loading}
          unavailable={unavailable}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={platform}
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {platform === 'telegram' || platform === 'tiktok' ? (
              <PlatformSteps
                platform={platform}
                step={step}
                setStep={setStep}
                accounts={accounts}
                loading={loading}
                unavailable={unavailable}
                connect={connect}
                disconnect={disconnect}
                sources={sources}
                settings={settings}
                platforms={props.platforms}
                edit={props.edit}
                remove={props.remove}
                notify={props.notify}
              />
            ) : (
              <div className="cv-browser-slot">{browser}</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    );

  if (layout === 'classic')
    return (
      <>
        {classicConnections}
        <div className="sp-workspace">
          {browser}
          {settingsForm}
        </div>
      </>
    );

  if (layout === 'modules')
    return (
      <div className="cv-modules-view">
        <div className="cv-section-line">
          <h2>Подключения</h2>
          {refreshButton}
        </div>
        <div className="cv-module-grid">
          {connectorCatalog.map((item) => {
            const count = sources.filter((source) => source.platform === item.id).length;
            const enabled = selected.filter((source) => source.platform === item.id).length;
            return (
              <article
                key={item.id}
                className="cv-module ec-glow"
                data-active={platform === item.id}
              >
                <button
                  className="cv-module-picker"
                  aria-label={`Выбрать ${item.title}`}
                  aria-pressed={platform === item.id}
                  onClick={() => filter(platform === item.id ? 'all' : item.id)}
                >
                  <ConnectorObject platform={item.id} />
                  <span className="cv-module-selected">
                    {platform === item.id ? <CheckIcon size={14} /> : <ArrowRightIcon size={14} />}
                  </span>
                </button>
                <div className="cv-module-body">
                  <div className="cv-module-title">
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.content}</p>
                    </div>
                    <span className="cv-source-total">
                      {count}
                      <small>
                        {count % 10 === 1 && count % 100 !== 11
                          ? 'источник'
                          : count % 10 >= 2 &&
                              count % 10 <= 4 &&
                              (count % 100 < 12 || count % 100 > 14)
                            ? 'источника'
                            : 'источников'}
                      </small>
                    </span>
                  </div>
                  {account(item.id)}
                  <div className="cv-module-footer">
                    <button className="ec-text" onClick={() => add(item.id)}>
                      <PlusIcon size={14} />
                      Добавить источник
                    </button>
                    <span>{enabled} в сборе</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <SettingsSummary settings={settings} open={() => setSettingsOpen(true)} />
        <div className="cv-browser-slot">{browser}</div>
        {settingsModal}
      </div>
    );

  if (layout === 'explorer')
    return (
      <div className="cv-explorer-view">
        <div className="cv-section-line">
          <h2>Подключения</h2>
          {refreshButton}
        </div>
        <div className="cv-explorer-frame">
          <nav className="cv-provider-nav" aria-label="Площадки обозревателя">
            <span className="cv-overline">Площадки</span>
            <Segment
              label="Площадка обозревателя"
              value={platform}
              onChange={filter}
              values={[
                { id: 'all', label: 'Все источники' },
                ...connectorCatalog.map((item) => ({
                  id: item.id,
                  label: item.title,
                  icon: <item.Icon size={19} />,
                })),
              ]}
            />
            <button className="ec-text cv-new-source" onClick={() => add(current)}>
              <PlusIcon size={15} />
              Добавить источник
            </button>
          </nav>
          <div className="cv-explorer-browser">{browser}</div>
          <aside
            className="cv-inspector"
            data-all={platform === 'all'}
            aria-label="Инспектор подключений"
          >
            <span className="cv-overline">
              {platform === 'all' ? 'Аккаунты для доступа' : 'Аккаунт для доступа'}
            </span>
            {connectorCatalog
              .filter((item) => platform === 'all' || item.id === platform)
              .map((item) => (
                <section key={item.id} className="cv-inspector-provider">
                  <span className="cv-inspector-logo">
                    <item.Icon size={29} />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  {account(item.id)}
                  <dl>
                    <div>
                      <dt>Источники</dt>
                      <dd>{sources.filter((source) => source.platform === item.id).length}</dd>
                    </div>
                    <div>
                      <dt>Типы</dt>
                      <dd>{item.types.join(', ')}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            <SettingsSummary settings={settings} open={() => setSettingsOpen(true)} />
          </aside>
        </div>
        {settingsModal}
      </div>
    );

  return (
    <div className="cv-steps-view">
      <div className="cv-wizard-top">
        <div className="cv-steps" role="group" aria-label="Этапы настройки источников">
          {['Площадка', 'Источники', 'Сбор'].map((title, index) => (
            <button
              key={title}
              aria-label={`Этап ${index + 1}: ${title}`}
              aria-pressed={step === index}
              onClick={() => {
                if (platform === 'all') filter(current);
                setStep(index);
              }}
            >
              <span>{index + 1}</span>
              {title}
            </button>
          ))}
        </div>
        {refreshButton}
      </div>
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          className="cv-wizard-content"
          key={step}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
        >
          {step === 0 ? (
            <div className="cv-wizard-choose">
              <div className="cv-wizard-art">
                <ConnectorObject platform={current} />
              </div>
              <div className="cv-wizard-choice">
                <span className="cv-overline">Площадка и аккаунт</span>
                <h2>Выберите площадку</h2>
                <p>Подключите аккаунт для доступа. Каналы и видео выберете следующим шагом.</p>
                <Segment
                  label="Площадка пошаговой настройки"
                  value={current}
                  onChange={filter}
                  values={connectorCatalog.map((item) => ({
                    id: item.id,
                    label: item.title,
                    icon: <item.Icon size={20} />,
                  }))}
                />
                <div className="cv-wizard-account">
                  <div>
                    <provider.Icon size={21} />
                    <strong>{provider.content}</strong>
                  </div>
                  {account(current)}
                </div>
                <button
                  className="ec-button ec-white"
                  onClick={() => {
                    filter(current);
                    setStep(1);
                  }}
                >
                  Выбрать источники
                  <ArrowRightIcon size={16} />
                </button>
              </div>
            </div>
          ) : step === 1 ? (
            <div className="cv-wizard-browser">{browser}</div>
          ) : (
            <div className="cv-wizard-settings">
              {settingsForm}
              <aside className="cv-wizard-review">
                <span className="cv-overline">Выбранный контент</span>
                <h3>{platformNames[current]}</h3>
                <ConnectorStatus
                  platform={current}
                  accounts={accounts}
                  loading={loading}
                  unavailable={unavailable}
                />
                <dl>
                  <div>
                    <dt>Источников</dt>
                    <dd>{sources.filter((source) => source.platform === current).length}</dd>
                  </div>
                  <div>
                    <dt>Включено</dt>
                    <dd>{selected.filter((source) => source.platform === current).length}</dd>
                  </div>
                </dl>
                {sources
                  .filter((source) => source.platform === current)
                  .slice(0, 4)
                  .map((source) => (
                    <span key={source.id} className="cv-review-source">
                      {source.title}
                    </span>
                  ))}
                <button className="ec-text" onClick={() => setStep(1)}>
                  Изменить выбор
                  <ArrowRightIcon size={14} />
                </button>
              </aside>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {step > 0 && (
        <footer className="cv-wizard-footer">
          <button className="ec-text" onClick={() => setStep(step - 1)}>
            <ArrowLeftIcon size={16} />
            Назад
          </button>
          <button className="ec-button" onClick={() => setStep(step === 1 ? 2 : 1)}>
            {step === 1 ? 'Параметры сбора' : 'К списку источников'}
            <ArrowRightIcon size={16} />
          </button>
        </footer>
      )}
    </div>
  );
}
