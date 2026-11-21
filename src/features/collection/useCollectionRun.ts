import { useEffect, useRef, useState } from 'react';
import { api, LocalApiError } from './api';
import type { CollectionRun } from './contracts';
import { useSources } from '../sources/repository';
import { importIdeas } from './import-ideas';
import { applyLibraryReset } from '../materials/repository';

export function useCollectionRun(enabled: boolean) {
  const configuration = useSources();
  const [run, setRun] = useState<CollectionRun | null>(null);
  const [pendingTikTokThreads, setPendingTikTokThreads] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const lock = useRef(false);
  const uncertain = useRef<{
    id: string;
    mode: string;
    threadsOnly: boolean;
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
        const result = await api<{ run: CollectionRun | null; libraryReset?: string; pendingTikTokThreads?: number }>('/collection/latest');
        await applyLibraryReset(result.libraryReset);
        if (disposed || revision !== epoch.current) return;
        setPendingTikTokThreads(result.pendingTikTokThreads ?? null);
        setRun((previous) =>
          previous?.id === result.run?.id &&
          previous?.updatedAt === result.run?.updatedAt &&
          previous?.canResumeTikTok === result.run?.canResumeTikTok
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
    if (!enabled || !run) return;
    void importIdeas(run)
      .then(() => setSyncError(''))
      .catch((error) =>
        setSyncError(
          error instanceof Error ? error.message : 'Не удалось сохранить идеи в библиотеке.',
        ),
      );
  }, [enabled, run]);
  async function start(mode: string, threadsOnly = false) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    epoch.current++;
    try {
      const prior = uncertain.current;
      if (prior && (prior.mode !== mode || prior.threadsOnly !== threadsOnly)) {
        const recovered = await api<{ run: CollectionRun }>(`/collection/runs/${prior.id}`).catch(
          (error) => {
            if (error instanceof LocalApiError && error.code === 'RUN_NOT_FOUND') return null;
            throw error;
          },
        );
        uncertain.current = null;
        if (recovered?.run.status === 'running') {
          setRun(recovered.run);
          throw new LocalApiError('Предыдущий запуск ещё выполняется.', 'RUN_ACTIVE');
        }
      }
      // Retrying the same action after a lost response must reuse its request ID.
      uncertain.current ??= {
        id: crypto.randomUUID(),
        mode,
        threadsOnly,
        configuration: structuredClone(configuration),
      };
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
  async function resumeTikTok() {
    if (!run?.canResumeTikTok || lock.current) return;
    lock.current = true;
    setPending(true);
    epoch.current++;
    try {
      const result = await api<{ run: CollectionRun }>(
        `/collection/runs/${run.id}/resume`,
        'POST',
        {},
      );
      setRun(result.run);
      uncertain.current = null;
      setError('');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const hasEnabledTelegram = configuration.sources.some(
    (source) => source.platform === 'telegram' && source.enabled,
  );
  return {
    run,
    pendingTikTokThreads,
    loading,
    pending,
    hasEnabledTelegram,
    error: error || syncError,
    start,
    resumeTikTok,
    cancel,
  };
}
