import { useSyncExternalStore } from 'react';
import {
  defaultPlatformSettings,
  defaultSettings,
  defaultRunLimits,
  parseSource,
  validatePlatformSettings,
  validateSettings,
  type AnalysisSource,
  type CollectionSettings,
  type PlatformSettings,
  type SourceConfiguration,
  type RunLimits,
} from './model';
import { migrateConfiguration, validateConfiguration } from './collection-policy';

const key = 'e-content-sources-v1';
let managedSources: AnalysisSource[] = [];
function withManaged(config: SourceConfiguration): SourceConfiguration {
  return managedSources.length
    ? {
        ...config,
        sources: [
          ...config.sources.filter(
            (source) => source.platform !== 'tiktok' || source.purpose !== 'own',
          ),
          ...managedSources,
        ],
      }
    : config;
}
const empty: SourceConfiguration = {
  schemaVersion: 2,
  runLimits: { ...defaultRunLimits },
  sources: [],
  settings: { ...defaultSettings },
  platforms: defaultPlatformSettings,
};
let snapshot = empty;
const listeners = new Set<() => void>();
function read(): SourceConfiguration {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!stored) return withManaged(empty);
    if (!Array.isArray(stored.sources) || stored.sources.length > 200) return withManaged(empty);
    const sources = stored.sources.filter((item: AnalysisSource) => {
      try {
        return (
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          item.title.length <= 100 &&
          ['telegram', 'tiktok'].includes(item.platform) &&
          parseSource(item.url, item.platform).url === item.url &&
          parseSource(item.url, item.platform).kind === item.kind &&
          ['own', 'inspiration'].includes(item.purpose) &&
          typeof item.enabled === 'boolean' &&
          (item.accountId === null || typeof item.accountId === 'string') &&
          Number.isFinite(Date.parse(item.createdAt))
        );
      } catch {
        return false;
      }
    });
    try {
      return withManaged(migrateConfiguration({ ...stored, sources }));
    } catch {
      return withManaged({ ...structuredClone(empty), sources });
    }
  } catch {
    return withManaged(empty);
  }
}
snapshot = read();
window.addEventListener('storage', (event) => {
  if (event.key === key || event.key === null) {
    snapshot = read();
    listeners.forEach((listener) => listener());
  }
});
function write(next: SourceConfiguration) {
  const valid = validateConfiguration(next);
  try {
    const previous = JSON.parse(localStorage.getItem(key) ?? 'null');
    const hidden =
      managedSources.length && Array.isArray(previous?.sources)
        ? previous.sources.filter(
            (source: AnalysisSource) =>
              source.platform === 'tiktok' &&
              source.purpose === 'own' &&
              !valid.sources.some((item) => item.id === source.id),
          )
        : [];
    localStorage.setItem(
      key,
      JSON.stringify({
        ...valid,
        sources: [
          ...valid.sources.filter(
            (source) => !managedSources.some((item) => item.id === source.id),
          ),
          ...hidden,
        ],
      }),
    );
  } catch {
    throw new Error('Не удалось сохранить настройки. Проверьте свободное место в браузере.');
  }
  snapshot = withManaged(valid);
  listeners.forEach((listener) => listener());
}
export function updateManagedSources(sources: AnalysisSource[]) {
  if (JSON.stringify(managedSources) === JSON.stringify(sources)) return;
  managedSources = sources;
  snapshot = read();
  listeners.forEach((listener) => listener());
}
export function useSources() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
export function saveSource(source: AnalysisSource) {
  const current = read();
  const parsed = parseSource(source.url, source.platform);
  if (!source.title.trim() || source.title.trim().length > 100)
    throw new Error('Укажите название до 100 символов.');
  if (
    current.sources.some(
      (item) => item.id !== source.id && item.url.toLowerCase() === parsed.url.toLowerCase(),
    )
  )
    throw new Error('Этот источник уже добавлен.');
  if (!current.sources.some((item) => item.id === source.id) && current.sources.length >= 200)
    throw new Error('Достигнут лимит: 200 источников.');
  write({
    ...current,
    sources: [
      ...current.sources.filter((item) => item.id !== source.id),
      { ...source, title: source.title.trim(), url: parsed.url, kind: parsed.kind },
    ],
  });
}
export function removeSource(id: string) {
  const current = read();
  write({ ...current, sources: current.sources.filter((item) => item.id !== id) });
}
export function saveCollectionSettings(settings: CollectionSettings, runLimits?: RunLimits) {
  const current = read();
  write({
    ...current,
    settings: validateSettings(settings),
    runLimits: runLimits ?? current.runLimits,
  });
}
export function savePlatformSettings<P extends keyof PlatformSettings>(
  platform: P,
  value: PlatformSettings[P],
) {
  const current = read();
  write({
    ...current,
    platforms: validatePlatformSettings({ ...current.platforms, [platform]: value }),
  });
}
