import { createHash } from 'node:crypto';
import type { AiIdeaReport, FoundIdea } from '../src/features/collection/contracts.ts';
import type { LocalStore } from './store.ts';

export function titleId(source: FoundIdea['source'], title: string) {
  const key = title
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return source + '-ai-' + createHash('sha256').update(key).digest('hex').slice(0, 24);
}

export class IdeaLibrary {
  constructor(private store: LocalStore) {}
  materialsVersion() {
    const latest = this.store.db
      .prepare('SELECT run_id, fingerprint FROM ai_idea_reports ORDER BY rowid DESC LIMIT 1')
      .get();
    if (!latest) return null;
    const merges = this.store.db
      .prepare('SELECT alias_id,topic_id FROM ai_topic_merges ORDER BY alias_id')
      .all();
    const rejected = this.store.db
      .prepare('SELECT topic_id,record_id FROM ai_evidence_rejections ORDER BY topic_id,record_id')
      .all();
    const publications = this.store.db
      .prepare(
        'SELECT fingerprint,topic_id FROM ai_review_publications ORDER BY fingerprint,topic_id',
      )
      .all();
    const digest = createHash('sha256')
      .update(JSON.stringify([merges, rejected, publications]))
      .digest('hex');
    return `topics-v2:${latest.run_id}:${latest.fingerprint}:${digest}`;
  }

  materials(): FoundIdea[] {
    const cards = new Map<string, FoundIdea>();
    const aliases = new Map(
      this.store.db
        .prepare('SELECT alias_id,topic_id FROM ai_topic_merges')
        .all()
        .map((row) => [String(row.alias_id), String(row.topic_id)]),
    );
    const reports = this.store.db.prepare(`
      SELECT body FROM (
        SELECT 0 AS reviewed, rowid AS position, body FROM ai_idea_reports
        UNION ALL
        SELECT 1, p.rowid, json_object('ideas',json_array(json(j.value)))
        FROM ai_review_publications p JOIN ai_idea_reviews r USING(fingerprint), json_each(r.body,'$.ideas') j
        WHERE json_extract(j.value,'$.topicId')=p.topic_id
      ) ORDER BY reviewed,position`);
    for (const row of reports.iterate()) {
      const report: AiIdeaReport = JSON.parse(String(row.body));
      for (const idea of report.ideas) {
        const source = idea.evidence.some((e) => e.source === 'tiktok') ? 'tiktok' : 'telegram';
        const originalId = idea.topicId ?? titleId(source, idea.title);
        const id = aliases.get(originalId) ?? originalId;
        const card =
          cards.get(id) ??
          ({
            id,
            title: idea.title,
            body: idea.angle,
            format: source === 'tiktok' ? 'video' : 'post',
            source,
            evidence: [],
          } satisfies FoundIdea);
        const evidence = new Map(card.evidence.map((item) => [item.id, item]));
        for (const { quote, ...item } of idea.evidence) {
          if (!evidence.has(item.id)) evidence.set(item.id, { ...item, text: quote || item.text });
        }
        const material: FoundIdea = { ...card, evidence: [...evidence.values()] };
        if (originalId !== id && !material.mergedFrom?.some((alias) => alias.id === originalId)) {
          material.mergedFrom = [
            ...(material.mergedFrom ?? []),
            { id: originalId, title: idea.title, body: idea.angle },
          ];
        }
        cards.set(id, material);
      }
    }
    for (const row of this.store.db
      .prepare('SELECT topic_id,record_id FROM ai_evidence_rejections')
      .iterate()) {
      const card = cards.get(aliases.get(String(row.topic_id)) ?? String(row.topic_id));
      if (!card) continue;
      const id = String(row.record_id);
      (card.excludedEvidenceIds ??= []).push(id);
      card.evidence = card.evidence.filter((item) => item.id !== id);
    }
    return [...cards.values()];
  }
}
