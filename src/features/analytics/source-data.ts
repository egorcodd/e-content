import type { Platform } from './chart-model';
import { samples } from './data';
import { getWindow, type AnalyticsPeriod } from './model';

export type ViewSource = { id: string; label: string; views: number };
type SourceDay = { date: string; sources: ViewSource[] };
export type ViewSourcesResult =
  { status: 'ready'; sources: ViewSource[]; total: number } | { status: 'unavailable' };

const labels = ['Каналы', 'Личные чаты', 'Поиск', 'Группы', 'Прочее'];
const history: Partial<Record<Platform, SourceDay[]>> = {
  telegram: samples.map((point, index) => {
    const weights = [0.43 + Math.sin(index / 12) * 0.05, 0.24, 0.15, 0.11];
    const counts = weights.map((weight) => Math.floor(point.telegram.views * weight));
    counts.push(point.telegram.views - counts.reduce((sum, value) => sum + value, 0));
    return {
      date: point.date,
      sources: labels.map((label, source) => ({
        id: String(source),
        label,
        views: counts[source],
      })),
    };
  }),
};

export function viewSources(platform: Platform, period: AnalyticsPeriod): ViewSourcesResult {
  const available = history[platform];
  if (!available) return { status: 'unavailable' };
  const dates = new Set(getWindow(period).points.map((point) => point.date));
  const totals = new Map<string, ViewSource>();
  for (const day of available) {
    if (!dates.has(day.date)) continue;
    for (const source of day.sources) {
      const before = totals.get(source.id);
      totals.set(source.id, { ...source, views: (before?.views ?? 0) + source.views });
    }
  }
  const sources = [...totals.values()].sort((a, b) => b.views - a.views);
  return {
    status: 'ready',
    sources,
    total: sources.reduce((sum, source) => sum + source.views, 0),
  };
}
