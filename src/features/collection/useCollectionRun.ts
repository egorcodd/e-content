import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CollectionRun } from './contracts';
import { useSources } from '../sources/repository';
import { importIdeas } from './import-ideas';

export function useCollectionRun(enabled: boolean) {
  const configuration = useSources();
  const [run, setRun] = useState<CollectionRun | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const lock = useRef(false);
  const uncertain = useRef<{
    id: string;
    mode: string;
    configuration: typeof configuration;
  } | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const revision = epoch.current;
      try {
        const result = await api<{ run: CollectionRun | null }>('/collection/latest');
        if (disposed || revision !== epoch.current) return;
        setRun((previous) =>
          previous?.id === result.run?.id && previous?.updatedAt === result.run?.updatedAt
            ? previous
            : result.run,
        );
        setError('');
      } catch (error) {
        if (!disposed)
          setError(error instanceof Error ? error.message : 'Не удалось прочитать запуск.');
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(refresh, 800);
        }
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !run || run.status === 'running') return;
    void importIdeas(run)
      .then(() => setSyncError(''))
      .catch((error) =>
        setSyncError(
          error instanceof Error ? error.message : 'Не удалось сохранить идеи в библиотеке.',
        ),
      );
  }, [enabled, run]);
  async function start(mode: string) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    epoch.current++;
    // A lost response must reuse the same request ID rather than launch another collection.
    uncertain.current ??= {
      id: crypto.randomUUID(),
      mode,
      configuration: structuredClone(configuration),
    };
    try {
      const result = await api<{ run: CollectionRun }>(
        '/collection/runs',
        'POST',
        uncertain.current,
      );
      setRun(result.run);
      uncertain.current = null;
      setError('');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        !['UNAVAILABLE', 'REQUEST_FAILED'].includes(String(error.code))
      )
        uncertain.current = null;
      throw error;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function cancel() {
    if (!run || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      await api(`/collection/runs/${run.id}/cancel`, 'POST', {});
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { run, loading, pending, error: error || syncError, start, cancel };
}
