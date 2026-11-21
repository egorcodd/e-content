import { createHash } from 'node:crypto';
import type { AiIdeaReport, CollectedRecord, FoundIdea } from '../src/features/collection/contracts.ts';
import { model, effort, instructions, format, corpus, resolveContestedEvidence, readCommentIndex } from './comment-index.ts';
import { evidenceFor } from './discover-topics.ts';
import { IdeaLibrary } from './idea-library.ts';
import { ResponseDelivery } from './response-delivery.ts';
import { AppError } from './errors.ts';
import type { LocalStore } from './store.ts';

export class AiIdeaAnalysis {
  private readonly pending = new Map<string, Promise<AiIdeaReport>>();
  private readonly library: IdeaLibrary;
  constructor(
    private store: LocalStore,
    private request: typeof fetch = fetch,
  ) { this.library = new IdeaLibrary(store); }

  saved(runId: string) {
    const row = this.store.db
      .prepare('SELECT fingerprint, body FROM ai_idea_reports WHERE run_id=?')
      .get(runId);
    return row
      ? { fingerprint: row.fingerprint, report: JSON.parse(String(row.body)) as AiIdeaReport }
      : null;
  }
  materialsVersion() {return this.library.materialsVersion();}
  materials() {return this.library.materials();}
  async analyze(runId: string): Promise<AiIdeaReport> {
    const run = this.store.run(runId, false);
    if (!run || run.status === 'running')
      throw new AppError(409, 'AI_RUN', 'Выберите завершённый сбор.');
    return this.analyzeComments(runId);
  }

  async analyzeStage(runId: string, signal?: AbortSignal) {
    const run = this.store.run(runId, false);
    if (run?.active !== 'ideas' || run.status !== 'running' || run.ideaMode !== 'ai')
      throw new AppError(409, 'AI_RUN', 'Разбор доступен на этапе идей.');
    const report = await this.analyzeComments(runId, undefined, false, signal);
    const billedHere = this.store.db.prepare(
      'SELECT 1 FROM ai_idea_attempts a JOIN ai_idea_reports r ON r.fingerprint=a.fingerprint WHERE r.run_id=? AND a.run_id=?',
    ).get(runId, runId);
    return { report, usage: billedHere ? report.usage : { input: 0, output: 0 } };
  }

  publishReviewedIdea(fingerprint: string, topicId: string) {
    const row = this.store.db.prepare('SELECT body FROM ai_idea_reviews WHERE fingerprint=?').get(fingerprint);
    if (!row || !(JSON.parse(String(row.body)) as AiIdeaReport).ideas.some(idea => idea.topicId === topicId))
      throw new AppError(400, 'AI_REVIEW', 'В сохранённом разборе нет такой идеи.');
    this.store.db.prepare('INSERT OR IGNORE INTO ai_review_publications VALUES (?,?)').run(fingerprint, topicId);
  }

  async reviewSavedTikTokInputs(runId: string, { blind = false } = {}) {
    const saved = this.saved(runId);
    if (!saved) throw new AppError(409, 'AI_RUN', 'У этого сбора нет сохранённого разбора.');
    const records = this.store.db.prepare(`
      SELECT r.body FROM ai_idea_inputs i JOIN run_records r ON r.run_id=i.run_id AND r.id=i.record_id
      WHERE i.run_id=?`).all(runId).map(row => JSON.parse(String(row.body)) as CollectedRecord);
    if (!records.length || records.length !== saved.report.comments || records.some(r => r.platform !== 'tiktok'))
      throw new AppError(409, 'AI_INPUTS', 'Не удалось подтвердить исходную выборку TikTok.');
    return this.analyzeComments(runId, records, blind);
  }

  private async analyzeComments(runId: string, review?: CollectedRecord[], blind = false, signal?: AbortSignal): Promise<AiIdeaReport> {
    const frozen = this.saved(runId);
    if (frozen && !review) return frozen.report;
    const records: CollectedRecord[] = review ?? [];
    for (let offset = 0; !review; offset += 500) {
      const page = this.store.records(runId, offset, 500);
      records.push(...page.filter((r) => (r.kind === 'comment' || r.platform === 'telegram') && r.text.trim()));
      if (page.length < 500) break;
    }
    if (!records.length)
      throw new AppError(400, 'AI_EMPTY', 'В выборке нет текстов для разбора.');
    records.sort((a, b) => a.id.localeCompare(b.id));
    const parent = this.store.db.prepare('SELECT body FROM records WHERE id=?');
    const { rows, videos } = corpus(records, id => {
      const row = parent.get(id);
      return row ? JSON.parse(String(row.body)) as CollectedRecord : undefined;
    });

    const prompt = records.some(r => r.platform === 'telegram')
      ? instructions + ' В выборке также есть посты и обсуждения Telegram. Для содержательного поста об IT или QA допустимо одно дословное основание: предложи собственный практический ракурс, сохрани связь с публикацией. Для комментариев по-прежнему нужны независимые ветки.'
      : instructions;
    const topics = blind ? [] : this.materials();
    const catalog = topics.map(({id, title, body}) => ({topicId: id, title, angle: body}));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([review ? [runId, blind, catalog] : null, model, effort, prompt, format, rows, records.map(evidenceFor)]))
      .digest('hex');
    const threadByRecord = new Map(rows.map(row => [records[Number(row.id.slice(1).split('.')[0])-1].id, row.thread]));
    const resolveEvidence = (report: AiIdeaReport) => resolveContestedEvidence(report, threadByRecord);
    if (review) {
      const cached = this.store.db.prepare('SELECT body FROM ai_idea_reviews WHERE fingerprint=?').get(fingerprint);
      if (cached) return JSON.parse(String(cached.body)) as AiIdeaReport;
    }
    const previous = this.store.db
      .prepare('SELECT body FROM ai_idea_reports WHERE fingerprint=? LIMIT 1')
      .get(fingerprint);
    const save = (report: AiIdeaReport) => {
      if (review) {
        this.store.db.prepare('INSERT OR IGNORE INTO ai_idea_reviews VALUES (?,?,?)')
          .run(runId, fingerprint, JSON.stringify(report));
        return report;
      }
      this.store.db.exec('BEGIN');
      try {
        this.store.db.prepare('INSERT INTO ai_idea_reports VALUES (?,?,?) ON CONFLICT(run_id) DO NOTHING')
          .run(runId, fingerprint, JSON.stringify(report));
        const mark = this.store.db.prepare('INSERT OR IGNORE INTO ai_idea_inputs VALUES (?,?)');
        this.store.db.prepare('DELETE FROM ai_input_claims WHERE fingerprint=?').run(fingerprint);
        this.store.db.prepare("UPDATE ai_deliveries SET state='published',result=NULL WHERE fingerprint=?").run(fingerprint);
        for (const record of records)
          if (record.platform === 'tiktok' && record.kind === 'comment') mark.run(record.id, runId);
        this.store.db.exec('COMMIT');
      } catch (error) {
        this.store.db.exec('ROLLBACK');
        throw error;
      }
      return report;
    };
    if (previous) return save(JSON.parse(String(previous.body)) as AiIdeaReport);
    const key = this.store.secret<string>('openai-api-key');
    if (!key) throw new AppError(409, 'AI_KEY', 'Добавьте ключ OpenAI для цеха.');
    const active = this.pending.get(fingerprint);
    if (active) return active.then(save);
    const attempt = this.store.db.prepare('SELECT run_id FROM ai_idea_attempts WHERE fingerprint=?').get(fingerprint);
    if (attempt && (attempt.run_id !== runId || !this.store.db.prepare('SELECT 1 FROM ai_deliveries WHERE fingerprint=?').get(fingerprint)))
      throw new AppError(409,'AI_ATTEMPT','Для выборки существует неподтверждённая отправка. Повтор отключён.');
    if (!attempt) {
      if (!review && this.store.db.prepare('SELECT 1 FROM ai_idea_attempts WHERE run_id=?').get(runId))
        throw new AppError(409,'AI_ATTEMPT','Для этого запуска уже есть оплачиваемая попытка.');
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        this.store.db.prepare('INSERT INTO ai_idea_attempts VALUES (?,?)').run(fingerprint,runId);
        this.store.db.prepare("INSERT INTO ai_deliveries(fingerprint,state) VALUES (?,'ready')").run(fingerprint);
        if (!review) {
          const claim = this.store.db.prepare('INSERT INTO ai_input_claims VALUES (?,?)');
          for (const record of records) claim.run(record.id,fingerprint);
        }
        this.store.db.exec('COMMIT');
      } catch (error) {this.store.db.exec('ROLLBACK');throw error;}
    }
    const input = JSON.stringify(catalog.length ? {comments: rows, topics: catalog} : rows);
    const task = this.generate(key, input, rows, records, videos, prompt, topics, fingerprint, signal)
      .then(resolveEvidence)
      .then(save)
      .catch(error => {
        if (error instanceof AppError && error.code === 'AI_REQUEST_REJECTED') {
          this.store.db.prepare('DELETE FROM ai_idea_attempts WHERE fingerprint=? AND run_id=?').run(fingerprint, runId);
        }
        throw error;
      })
      .finally(() => this.pending.delete(fingerprint));
    this.pending.set(fingerprint, task);
    return task;
  }
  private async generate(
    key: string,
    input: string,
    rows: ReturnType<typeof corpus>['rows'],
    records: CollectedRecord[],
    videos: number,
    prompt: string,
    topics: FoundIdea[],
    fingerprint:string,
    signal?:AbortSignal,
  ) {
    const delivery = new ResponseDelivery(this.store.db,this.request);
    const result = await delivery.receive(fingerprint,key,{
      model,input,instructions:prompt,max_output_tokens:Math.min(32000, Math.max(12000,rows.length*55)),
      reasoning:{effort},text:{format},
    },signal);
    return readCommentIndex(result,rows,records,videos,topics);
  }
}
