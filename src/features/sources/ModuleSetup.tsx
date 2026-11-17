import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react';
import { CommonCollectionSettings } from './CommonCollectionSettings';
import { PlatformCollectionSettings } from './PlatformCollectionSettings';
import { ConnectorObject } from './ConnectorObject';
import { ConnectorStatus } from './ConnectorStatus';
import { PlatformSteps } from './PlatformSteps';
import { TelegramConnection } from './TelegramConnection';
import { TikTokConnection } from './TikTokConnection';
import { useConnections } from './connection-store';
import { connectorCatalog } from './connector-catalog';
import {
  plural,
  type AnalysisSource,
  type CollectionSettings,
  type Platform,
  type PlatformSettings,
  type RunLimits,
} from './model';
import './module-cards.css';
import './module-setup.css';
import './collection-settings.css';

export function ModuleSetup({
  sources,
  settings,
  runLimits,
  platforms,
  platform,
  filter,
  step,
  setStep,
  edit,
  remove,
  notify,
}: {
  sources: AnalysisSource[];
  settings: CollectionSettings;
  runLimits: RunLimits;
  platforms: PlatformSettings;
  platform: Platform;
  filter: (platform: Platform) => void;
  step: number;
  setStep: (step: number) => void;
  edit: (source: AnalysisSource) => void;
  remove: (source: AnalysisSource) => void;
  notify: (text: string) => void;
}) {
  const { accounts, tiktokAccount } = useConnections();
  const [expanded, setExpanded] = useState(true);
  const current = platform === 'tiktok' ? 'tiktok' : 'telegram';
  const provider = connectorCatalog.find((item) => item.id === current)!;
  const reduced = useReducedMotion();
  function choose(id: Platform, nextStep = 0) {
    filter(id);
    setStep(nextStep);
    setExpanded(true);
  }
  return (
    <div className="cm-modules-view">
      <div className="cv-module-grid">
        {connectorCatalog.map((item) => {
          const count = sources.filter((source) => source.platform === item.id).length;
          const account = accounts.find((account) => account.platform === item.id);
          return (
            <article key={item.id} className="cv-module ec-glow" data-active={current === item.id}>
              <button
                className="cv-module-picker"
                aria-label={`Выбрать ${item.title}`}
                aria-pressed={current === item.id}
                onClick={() => choose(item.id)}
              >
                <ConnectorObject platform={item.id} />
                <span className="cv-module-selected">
                  {current === item.id && <CheckIcon size={14} />}
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
                    <small>{plural(count, 'источник', 'источника', 'источников')}</small>
                  </span>
                </div>
                <div className="cm-module-account">
                  <div>
                    <ConnectorStatus
                      platform={item.id}
                      accounts={accounts}
                      connection={item.id === 'tiktok' ? tiktokAccount : undefined}
                    />
                    {account && (
                      <small>
                        {account.displayName} · {account.handle}
                      </small>
                    )}
                  </div>
                  <button
                    className="ec-button"
                    aria-label={`${item.id === 'tiktok' || account ? 'Настроить' : 'Подключить'} ${item.title}`}
                    onClick={() => choose(item.id)}
                  >
                    {item.id === 'tiktok' || account ? 'Настроить' : 'Подключить'}
                    <PlusIcon size={14} />
                  </button>
                </div>
                <div className="cv-module-footer">
                  <button className="ec-text" onClick={() => choose(item.id, 1)}>
                    <PlusIcon size={14} />
                    {item.id === 'tiktok'
                      ? tiktokAccount?.transport === 'native'
                        ? 'Ролики для цеха'
                        : 'Выбрать ролики'
                      : 'Добавить источник'}
                  </button>
                  <span>
                    {
                      sources.filter((source) => source.platform === item.id && source.enabled)
                        .length
                    }{' '}
                    в сборе
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <button
        className="cm-disclosure"
        aria-expanded={expanded}
        aria-controls="module-setup-content"
        onClick={() => setExpanded(!expanded)}
      >
        <span>Настройка {provider.title}</span>
        <CaretDownIcon size={16} />
      </button>
      <motion.div
        id="module-setup-content"
        className="cm-content-wrap"
        initial={false}
        animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : 0.3 }}
        inert={!expanded}
      >
        <div className="cm-setup-grid">
          <section
            className="cm-platform-setup"
            aria-label={`Пошаговое подключение ${provider.title}`}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={current}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.15 }}
              >
                <PlatformSteps
                  platform={current}
                  step={step}
                  setStep={setStep}
                  accounts={accounts}
                  connection={current === 'tiktok' ? tiktokAccount : undefined}
                  tiktokComments={{
                    enabled: platforms.tiktok.custom?.comments ?? settings.comments,
                    replies: platforms.tiktok.replies,
                    runLimit: runLimits.maxComments,
                  }}
                  sources={sources}
                  edit={edit}
                  remove={remove}
                  notify={notify}
                  accountPanel={
                    current === 'telegram' ? (
                      <TelegramConnection next={() => setStep(1)} />
                    ) : (
                      <TikTokConnection next={() => setStep(1)} />
                    )
                  }
                />
              </motion.div>
            </AnimatePresence>
          </section>
          <div className="cm-platform-parameters">
            <PlatformCollectionSettings
              key={current}
              platform={current}
              settings={settings}
              platforms={platforms}
              runLimits={runLimits}
            />
          </div>
        </div>
        <CommonCollectionSettings settings={settings} runLimits={runLimits} notify={notify} />
      </motion.div>
    </div>
  );
}
