import { readMaterial, reviewVideoIdeas, saveFoundIdea } from '../materials/repository';
import { api } from './api';
import type { CollectionRun, FoundIdea } from './contracts';
import { isDiscoveredIdea } from './idea-drafts';

const importKey = 'e-content-imported-runs-v1';
const reviewKey = 'e-content-reviewed-video-ideas';
const importing = new Map<string, Promise<void>>();

function importedRuns(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(importKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function ideaReview(): { version?: number; run?: string; discovered: string[] } {
  try {
    const value = JSON.parse(localStorage.getItem(reviewKey) ?? 'null');
    if (typeof value === 'number') return { version: value, discovered: [] };
    if (Array.isArray(value?.discovered))
      return {
        version: value.version,
        run: value.run,
        discovered: value.discovered.filter((id: unknown) => typeof id === 'string'),
      };
  } catch {}
  return { discovered: [] };
}

export async function importIdeas(run: CollectionRun, reviewVersion = run.ideaAnalysisVersion) {
  if (run.status === 'running' || !reviewVersion) return;
  const key = `${run.id}:${run.updatedAt}`;
  const existing = importing.get(key);
  if (existing) return existing;
  const save = async () => {
    const review = ideaReview();
    const discovered = new Set(review.discovered);
    const newCollectedData =
      run.ideaAnalysisVersion === reviewVersion && run.counts.comments > 0 && review.run !== key;
    if (review.version !== reviewVersion || newCollectedData) {
      const { version, ideas } = await api<{ version: number; ideas: FoundIdea[] }>(
        '/collection/reviewed-ideas',
      );
      await reviewVideoIdeas(ideas);
      for (const idea of ideas) {
        if (!isDiscoveredIdea(idea.id) || discovered.has(idea.id)) continue;
        if (!(await readMaterial(idea.id))) await saveFoundIdea(idea);
        discovered.add(idea.id);
      }
      review.version = version;
      review.run = key;
      localStorage.setItem(reviewKey, JSON.stringify({ ...review, discovered: [...discovered] }));
    }
    if (!run.ideaAnalysisVersion || !run.counts.ideas) return;
    const imported = importedRuns();
    if (imported[run.id] === run.updatedAt) return;
    for (let offset = 0; offset < run.counts.ideas; offset += 25) {
      const { items } = await api<{ items: FoundIdea[] }>(
        `/collection/runs/${run.id}/ideas?offset=${offset}&limit=25`,
      );
      for (const idea of items) {
        if (isDiscoveredIdea(idea.id)) {
          if (discovered.has(idea.id) && !(await readMaterial(idea.id))) continue;
          discovered.add(idea.id);
        }
        await saveFoundIdea(idea);
      }
    }
    localStorage.setItem(reviewKey, JSON.stringify({ ...review, discovered: [...discovered] }));
    imported[run.id] = run.updatedAt;
    localStorage.setItem(
      importKey,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(imported)
            .sort((a, b) => b[1].localeCompare(a[1]))
            .slice(0, 500),
        ),
      ),
    );
  };
  const task = navigator.locks ? navigator.locks.request('e-content-import-ideas', save) : save();
  importing.set(key, task);
  try {
    await task;
  } finally {
    importing.delete(key);
  }
}
