import { useSyncExternalStore } from 'react';
import {
  defaultPlatformSettings,
  defaultSettings,
  parseSource,
  validatePlatformSettings,
  validateSettings,
  type AnalysisSource,
  type CollectionSettings,
  type PlatformSettings,
  type SourceConfiguration,
} from './model';

const key = 'e-content-sources-v1';
const empty: SourceConfiguration = {
  sources: [],
  settings: { ...defaultSettings },
  platforms: defaultPlatformSettings,
};
// Saved before per-platform parameters existed (or damaged) — fall back to defaults only here.
function readPlatforms(value?: PlatformSettings) {
  try {
    return value ? validatePlatformSettings(value) : defaultPlatformSettings;
  } catch {
    return defaultPlatformSettings;
  }
}
let snapshot = empty;
const listeners = new Set<() => void>();
function read(): SourceConfiguration {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!stored) return empty;
    if (!Array.isArray(stored.sources) || stored.sources.length > 200) return empty;
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
    return {
      sources,
      settings: validateSettings(stored.settings),
      platforms: readPlatforms(stored.platforms),
    };
  } catch {
    return empty;
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
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    throw new Error('Не удалось сохранить настройки. Проверьте свободное место в браузере.');
  }
  snapshot = next;
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
export function saveCollectionSettings(settings: CollectionSettings) {
  write({ ...read(), settings: validateSettings(settings) });
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
