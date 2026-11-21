import { accountedForIdeas, readMaterial, reviewVideoIdeas, saveFoundIdea } from '../materials/repository';
import { api } from './api';
import type { CollectionRun, FoundIdea } from './contracts';
import { isDiscoveredIdea } from './idea-drafts';

const importKey = 'e-content-imported-runs-v2';
const reviewKey = 'e-content-reviewed-video-ideas';
const importing = new Map<string, Promise<void>>();

export async function importAiMaterials(version?: string | null) {
  if (!version) return;
  const sync = () => syncAiMaterials(version);
  if (navigator.locks) return navigator.locks.request('e-content-import-ai-materials', sync);
  const next = pendingImport.then(sync);
  pendingImport = next.catch(() => {});
  return next;
}

let pendingImport = Promise.resolve();
async function syncAiMaterials(version: string) {
  const key = 'e-content-imported-ai-materials';
  let receipt: Receipt | null = null;
  try { receipt = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch {}
  if (receipt?.revision === version && Array.isArray(receipt.ids) && await accountedForIdeas(receipt.ids)) return;
  const saved = await api<{ version: string; ideas: FoundIdea[] }>('/collection/ai-materials');
  for (const idea of saved.ideas) await saveFoundIdea(idea);
  localStorage.setItem(key, JSON.stringify({ revision: saved.version, ids: saved.ideas.map(idea => idea.id) }));
}

type Receipt = { revision: string; ids: string[] };
function currentReceipt(receipt: Receipt | undefined, revision: string, count: number) {
  return receipt?.revision === revision && Array.isArray(receipt.ids) &&
    receipt.ids.length === count && accountedForIdeas(receipt.ids);
}

function importedRuns(): Record<string, Receipt> {
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
  if (run.ideaMode) return;
  const live = run.status === 'running';
  if (!reviewVersion || (live && (!run.ideaRevision || !run.counts.ideas))) return;
  const revision = live ? `live-${run.ideaRevision}` : run.updatedAt;
  const key = `${run.id}:${revision}`;
  const existing = importing.get(key);
  if (existing) return existing;
  const previous = run.previousTikTokRun;
  if (
    run.threadsOnly &&
    previous &&
    previous.counts.ideas &&
    !(await currentReceipt(importedRuns()[previous.id], previous.updatedAt, previous.counts.ideas))
  ) {
    const { run: mainRun } = await api<{ run: CollectionRun }>(`/collection/runs/${previous.id}`);
    await importIdeas(mainRun, reviewVersion);
  }
  const save = async () => {
    const imported = importedRuns();
    const review = ideaReview();
    const discovered = new Set(review.discovered);
    const newCollectedData =
      run.ideaAnalysisVersion === reviewVersion && run.counts.comments > 0 && review.run !== key;
    if (!live && (review.version !== reviewVersion || newCollectedData)) {
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
    if (await currentReceipt(imported[run.id], revision, run.counts.ideas)) return;
    const ids = new Set<string>();
    for (let offset = 0; offset < run.counts.ideas; offset += 25) {
      const { items } = await api<{ items: FoundIdea[] }>(
        `/collection/runs/${run.id}/ideas?offset=${offset}&limit=25`,
      );
      for (const idea of items) {
        if (isDiscoveredIdea(idea.id)) {
          discovered.add(idea.id);
        }
        await saveFoundIdea(idea);
        ids.add(idea.id);
      }
    }
    localStorage.setItem(reviewKey, JSON.stringify({ ...review, discovered: [...discovered] }));
    delete imported[run.id];
    imported[run.id] = { revision, ids: [...ids] };
    localStorage.setItem(
      importKey,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(imported)
            .slice(-500),
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
