import { useEffect, useState } from 'react';
import { LabDialog } from '../../shared/ui';
import { safeSourceUrl } from '../materials/idea-model';
import { api } from './api';
import type { AiIdeaReport } from './contracts';

export function AiIdeas({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ec-button ec-glass" onClick={() => setOpen(true)}>
        Разбор комментариев с ИИ
      </button>
      {open && <AnalysisDialog runId={runId} close={() => setOpen(false)} />}
    </>
  );
}

function AnalysisDialog({ runId, close }: { runId: string; close: () => void }) {
  const path = '/collection/runs/' + runId + '/ai-ideas';
  const [configured, setConfigured] = useState(false);
  const [secret, setSecret] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [report, setReport] = useState<AiIdeaReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api<{ configured: boolean; report: AiIdeaReport | null }>(path)
      .then((state) => {
        if (current) {
          setConfigured(state.configured);
          setReport(state.report);
        }
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [path]);
  async function analyze() {
    setBusy(true);
    setError('');
    try {
      if (!configured || editKey) {
        await api('/ai/key', 'POST', { key: secret.trim() });
        setSecret('');
        setEditKey(false);
        setConfigured(true);
      }
      setReport(await api<AiIdeaReport>(path, 'POST', {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить результат.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <LabDialog title="Разбор комментариев с ИИ" close={close}>
      {report ? (
        <div className="ai-idea-report">
          <p>
            {report.ideas.length} тем · {report.comments} комментариев
          </p>
          <p>Токены за разбор · вход {report.usage.input.toLocaleString('ru-RU')} · выход {report.usage.output.toLocaleString('ru-RU')}</p>
          {report.ideas.length > 0 && <a href="/materials?folder=video-ideas">Открыть идеи видео</a>}
          {report.ideas.map((idea) => (
            <article key={idea.title}>
              <h3>{idea.title}</h3>
              <p>{idea.angle}</p>
              <details>
                <summary>Основания · {idea.evidence.length}</summary>
                {idea.evidence.map((item) => (
                  <p key={item.id}>
                    <a href={safeSourceUrl(item.url) ?? undefined} target="_blank" rel="noreferrer">
                      {item.quote ?? item.text}
                    </a>
                  </p>
                ))}
              </details>
            </article>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void analyze();
          }}
        >
          <p>OpenAI получит тексты веток из этого сохранённого сбора.</p>
          {(!configured || editKey) && !busy && (
            <label className="sp-field">
              Ключ OpenAI
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="sk-…"
              />
            </label>
          )}
          {error && (
            <p className="sp-error" role="alert">
              {error}
            </p>
          )}
          <div className="ec-dialog-actions">
            {configured && !editKey && (
              <button
                type="button"
                className="ec-button"
                disabled={busy}
                onClick={() => setEditKey(true)}
              >
                Сменить ключ
              </button>
            )}
            <button
              className="ec-button ec-white"
              disabled={busy || ((!configured || editKey) && !secret.trim())}
            >
              {busy ? 'Загрузка…' : 'Разобрать сохранённые комментарии'}
            </button>
          </div>
        </form>
      )}
    </LabDialog>
  );
}
