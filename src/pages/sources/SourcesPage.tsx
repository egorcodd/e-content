import { useLayoutEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { PlusIcon } from '@phosphor-icons/react';
import { LabDialog } from '../../shared/ui';
import { ModuleSetup } from '../../features/sources/ModuleSetup';
import { SourceDialog } from '../../features/sources/SourceDialog';
import { useSources, removeSource } from '../../features/sources/repository';
import { useConnections } from '../../features/sources/connection-store';
import type { AnalysisSource, Platform } from '../../features/sources/model';
import './sources.css';

const readPlatform = (): Platform =>
  new URLSearchParams(location.search).get('platform') === 'tiktok' ? 'tiktok' : 'telegram';

export default function SourcesPage({ notify }: { notify: (text: string) => void }) {
  const configuration = useSources();
  const [platform, setPlatform] = useState(readPlatform);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<{ source?: AnalysisSource; platform?: Platform } | null>(null);
  const [remove, setRemove] = useState<AnalysisSource | null>(null);
  const [error, setError] = useState('');
  const { accounts } = useConnections();

  useLayoutEffect(() => {
    function normalizeUrl() {
      const url = new URL(location.href);
      if (url.searchParams.has('layout')) {
        url.searchParams.delete('layout');
        history.replaceState(null, '', url);
      }
    }
    normalizeUrl();
    try {
      localStorage.removeItem('e-content-sources-layout');
    } catch {}
    const onBack = () => {
      normalizeUrl();
      setPlatform(readPlatform());
      setStep(0);
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  function changePlatform(value: Platform) {
    setPlatform(value);
    const url = new URL(location.href);
    url.searchParams.set('platform', value);
    history.replaceState(null, '', url);
  }

  return (
    <div className="sources-page">
      <header className="sp-page-heading">
        <div>
          <h1>Источники</h1>
          <span>Аккаунты и контент для анализа</span>
        </div>
        <button className="ec-button ec-white" onClick={() => setForm({ platform })}>
          <PlusIcon size={18} />
          Добавить источник
        </button>
      </header>
      <ModuleSetup
        platform={platform}
        filter={changePlatform}
        sources={configuration.sources}
        settings={configuration.settings}
        runLimits={configuration.runLimits}
        platforms={configuration.platforms}
        step={step}
        setStep={setStep}
        edit={(source) => setForm({ source })}
        remove={(source) => {
          setError('');
          setRemove(source);
        }}
        notify={notify}
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
            {error && (
              <p className="sp-error" role="alert">
                {error}
              </p>
            )}
            <div className="ec-dialog-actions">
              <button className="ec-button" onClick={() => setRemove(null)}>
                Отмена
              </button>
              <button
                className="ec-button sp-delete"
                onClick={() => {
                  try {
                    removeSource(remove.id);
                    setRemove(null);
                    notify('Источник удалён');
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : 'Не удалось удалить источник.',
                    );
                  }
                }}
              >
                Удалить источник
              </button>
            </div>
          </LabDialog>
        )}
      </AnimatePresence>
    </div>
  );
}
