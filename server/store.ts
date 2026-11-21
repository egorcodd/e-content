import { estimateAnalysisCost } from './analysis-cost.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { CollectionRun, CollectedRecord } from '../src/features/collection/contracts.ts';
import type { SourceConfiguration } from '../src/features/sources/model.ts';
import type { TikTokThread } from './tiktok/contracts.ts';

export type TikTokJob = {
  mode: 'cycle' | 'tiktok';
  config: SourceConfiguration;
  budget: { publications: number; comments: number };
};

function selectionPolicy(config: SourceConfiguration) {
  const { custom, commentsPerVideo, replies, order, minLikes } = config.platforms.tiktok;
  const { period, maxPublications, maxComments, comments } = { ...config.settings, ...custom };
  return JSON.stringify([period, maxPublications, maxComments, comments, commentsPerVideo,
    replies, order, minLikes, config.runLimits.maxPublications]);
}

export function unfinishedTikTokSource(run: CollectionRun) {
  if (
    (run.status !== 'partial' && run.status !== 'failed') ||
    !run.tiktokCollectionVersion ||
    run.ideaMode === 'ai' ||
    run.threadsOnly ||
    !run.skipped.includes('telegram') ||
    run.counts.requests >= (run.parameters?.limits.maxRequests ?? 0)
  )
    return;
  const sources = Object.entries(run.sources ?? {});
  if (sources.length !== 1) return;
  const [sourceId, progress] = sources[0];
  if (
    progress.platform === 'tiktok' &&
    ['TIKTOK_DEFERRED', 'TIKTOK_RETRY_EXHAUSTED', 'TIKTOK_RETRY_TOO_LATE'].includes(
      progress.stopCode ?? '',
    )
  )
    return sourceId;
}

export class LocalStore {
  readonly db: DatabaseSync;
  private key: Buffer;
  constructor(readonly directory: string, { recoverRuns = true } = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, 'vault.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('Некорректный ключ локального хранилища.');
    this.db = new DatabaseSync(join(directory, 'content.sqlite'));
    chmodSync(join(directory, 'content.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_ideas (run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,id));
      CREATE TABLE IF NOT EXISTS ai_idea_reports (run_id TEXT PRIMARY KEY REFERENCES runs(id), fingerprint TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_evidence_rejections (
        topic_id TEXT NOT NULL, record_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES ai_idea_reports(run_id) ON DELETE CASCADE,
        PRIMARY KEY(topic_id,record_id));
      CREATE TABLE IF NOT EXISTS ai_idea_reviews (
        run_id TEXT NOT NULL REFERENCES ai_idea_reports(run_id) ON DELETE CASCADE,
        fingerprint TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_review_publications (
        fingerprint TEXT NOT NULL REFERENCES ai_idea_reviews(fingerprint) ON DELETE CASCADE,
        topic_id TEXT NOT NULL, PRIMARY KEY(fingerprint,topic_id));
      CREATE TABLE IF NOT EXISTS ai_topic_merges (
        alias_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL CHECK(topic_id<>alias_id),
        run_id TEXT NOT NULL REFERENCES ai_idea_reports(run_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS ai_idea_attempts (fingerprint TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS result_jobs (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, mode TEXT NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_deliveries (
        fingerprint TEXT PRIMARY KEY REFERENCES ai_idea_attempts(fingerprint) ON DELETE CASCADE,
        state TEXT NOT NULL, remote_id TEXT, result TEXT, diagnostic TEXT);
      CREATE TABLE IF NOT EXISTS ai_input_claims (
        record_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL REFERENCES ai_deliveries(fingerprint) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tiktok_discussion_lookup ON records
        (json_extract(body,'$.sourceId'), json_extract(body,'$.videoId'), json_extract(body,'$.publishedAt') DESC)
        WHERE json_extract(body,'$.platform')='tiktok' AND json_extract(body,'$.kind')='comment';
      CREATE TABLE IF NOT EXISTS run_records (run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,id));
      CREATE TABLE IF NOT EXISTS tiktok_jobs (run_id TEXT PRIMARY KEY REFERENCES runs(id), plan TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tiktok_threads (source_id TEXT NOT NULL, video_id TEXT NOT NULL, root_id TEXT NOT NULL, body TEXT NOT NULL, last_attempt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_id,video_id,root_id));
      CREATE TABLE IF NOT EXISTS tiktok_exhausted_threads (source_id TEXT NOT NULL, video_id TEXT NOT NULL, root_id TEXT NOT NULL, reported_replies INTEGER NOT NULL, checked_at INTEGER NOT NULL, PRIMARY KEY(source_id,video_id,root_id));
      CREATE TABLE IF NOT EXISTS tiktok_pages (run_id TEXT NOT NULL REFERENCES tiktok_jobs(run_id) ON DELETE CASCADE, source_id TEXT NOT NULL, page TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,source_id,page));
      `);
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_idea_inputs'").get()) {
      this.db.exec(`BEGIN;
        CREATE TABLE ai_idea_inputs (record_id TEXT NOT NULL, run_id TEXT NOT NULL
          REFERENCES ai_idea_reports(run_id) ON DELETE CASCADE, PRIMARY KEY(record_id,run_id));
        INSERT INTO ai_idea_inputs
          SELECT id,run_id FROM (
            SELECT rr.id,rr.run_id,json_extract(rr.body,'$.platform') AS platform,
              row_number() OVER (PARTITION BY rr.run_id ORDER BY rr.rowid) AS position,
              json_extract(report.body,'$.comments') AS count
            FROM run_records rr JOIN ai_idea_reports report ON report.run_id=rr.run_id
            WHERE json_extract(rr.body,'$.kind')='comment' AND trim(json_extract(rr.body,'$.text'))<>''
          ) WHERE position<=count AND platform='tiktok';
        COMMIT;`);
    }
    if (!recoverRuns) return;
    this.updateSavedRunSummaries();
    this.db.exec(`UPDATE runs SET body=json_set(body,'$.followUp.state','manual',
      '$.active',NULL,'$.status',CASE WHEN json_extract(body,'$.status')='running' THEN 'completed'
      ELSE json_extract(body,'$.status') END) WHERE json_extract(body,'$.followUp.state') IN ('queued','reading') AND id NOT IN (SELECT run_id FROM result_jobs)`);
    this.db.exec("DELETE FROM tiktok_jobs WHERE run_id IN (SELECT id FROM runs WHERE json_extract(body,'$.status') NOT IN ('running','partial','failed') AND COALESCE(json_extract(body,'$.followUp.state'),'') <>'manual')");
    for (const row of this.db
      .prepare(
        "SELECT body FROM runs WHERE json_extract(body,'$.status')='running' AND id NOT IN (SELECT run_id FROM tiktok_jobs) AND id NOT IN (SELECT run_id FROM result_jobs)",
      )
      .all()) {
      const run = JSON.parse(row.body as string) as CollectionRun;
      if (run.status === 'running') {
        for (const source of Object.values(run.sources ?? {}))
          if (source.status === 'reading') {
            source.status = 'interrupted';
            delete source.retry;
            source.reason = 'Сервер был остановлен. Полученные данные сохранены.';
            source.updatedAt = new Date().toISOString();
          }
        this.saveRun({
          ...run,
          status: 'interrupted',
          error: 'Сервер был остановлен. Собранные данные сохранены.',
          active: null,
        });
      }
    }
  }
  private updateSavedRunSummaries() {
    const candidates = this.db.prepare(`SELECT runs.body,
      json_extract(ai_idea_reports.body,'$.model') AS model
      FROM runs LEFT JOIN ai_idea_reports ON ai_idea_reports.run_id=runs.id
      WHERE (json_extract(runs.body,'$.status')='partial' AND
        json_extract(runs.body,'$.failures.tiktok') LIKE 'Получена часть комментариев: %')
      OR (json_type(runs.body,'$.aiUsage')='object' AND json_type(runs.body,'$.aiCostUsd') IS NULL
        AND json_extract(ai_idea_reports.body,'$.model')='gpt-5.4')`).all();
    const update = this.db.prepare('UPDATE runs SET body=? WHERE id=?');
    for (const row of candidates) {
      const run: CollectionRun = JSON.parse(String(row.body));
      let changed = false;
      const failure = run.failures?.tiktok;
      const sources = Object.values(run.sources ?? {}).filter(source => source.platform === 'tiktok');
      // Only this specific legacy reason was produced after a successful, valid dataset.
      if (failure && sources.length && sources.every(source => source.status === 'completed' ||
        (source.stopCode === 'APIFY_INCOMPLETE' && source.receivedComments && source.videos &&
          source.reason === 'Получена часть комментариев: ' + source.receivedComments + '.')) &&
        sources.some(source => source.reason === failure && source.status === 'limited')) {
        for (const source of sources.filter(s => s.status === 'limited')) {
          source.provider = 'apify';
          source.status = 'completed';
          source.videos!.processed = source.videos!.selected;
          delete source.reason;
          delete source.stopCode;
        }
        delete run.failures!.tiktok;
        const stages = ['tiktok'];
        if (!run.failures!.telegram) stages.push('comments');
        run.done = [...new Set([...stages, ...run.done])];
        for (const stage of stages) run.steps[stage] = 4;
        if (run.error === failure || run.error?.includes(failure)) {
          run.error = run.error.split(failure).join('').trim() || undefined;
        }
        if (!Object.keys(run.failures!).length && !run.error) run.status = 'completed';
        changed = true;
      }
      if (run.aiUsage && run.aiCostUsd === undefined && row.model === 'gpt-5.4') {
        run.aiCostUsd = estimateAnalysisCost(row.model, run.aiUsage);
        changed = true;
      }
      if (changed) update.run(JSON.stringify(run), run.id);
    }
  }
  pendingThreadCount(sourceId: string) {
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM tiktok_threads WHERE source_id=?').get(sourceId)!
        .n,
    );
  }
  pendingThreads(sourceId: string): TikTokThread[] {
    return this.db
      .prepare('SELECT body FROM tiktok_threads WHERE source_id=? ORDER BY last_attempt, rowid')
      .all(sourceId)
      .map((row) => JSON.parse(String(row.body)) as TikTokThread);
  }
  closedThreads(sourceId: string) {
    return this.db
      .prepare(
        'SELECT video_id, root_id, reported_replies, checked_at FROM tiktok_exhausted_threads WHERE source_id=?',
      )
      .all(sourceId)
      .map((row) => ({
        videoId: String(row.video_id),
        rootId: String(row.root_id),
        reportedReplies: Number(row.reported_replies),
        checkedAt: Number(row.checked_at),
      }));
  }
  closePublicThread(sourceId: string, thread: TikTokThread, reportedReplies: number) {
    this.db.exec('SAVEPOINT close_public_thread');
    try {
      this.db
        .prepare(
          `INSERT INTO tiktok_exhausted_threads VALUES (?,?,?,?,?)
        ON CONFLICT(source_id,video_id,root_id) DO UPDATE SET
          reported_replies=excluded.reported_replies, checked_at=excluded.checked_at`,
        )
        .run(sourceId, thread.video.id, thread.rootId, reportedReplies, Date.now());
      this.finishThread(sourceId, thread.video.id, thread.rootId);
      this.db.exec('RELEASE close_public_thread');
    } catch (error) {
      this.db.exec('ROLLBACK TO close_public_thread; RELEASE close_public_thread');
      throw error;
    }
  }
  saveThread(sourceId: string, thread: TikTokThread) {
    this.db
      .prepare(
        `INSERT INTO tiktok_threads(source_id,video_id,root_id,body,last_attempt) VALUES (?,?,?,?,?)
      ON CONFLICT(source_id,video_id,root_id) DO UPDATE SET body=excluded.body,last_attempt=excluded.last_attempt`,
      )
      .run(sourceId, thread.video.id, thread.rootId, JSON.stringify(thread), Date.now());
  }
  finishThread(sourceId: string, videoId: string, rootId: string) {
    this.db
      .prepare('DELETE FROM tiktok_threads WHERE source_id=? AND video_id=? AND root_id=?')
      .run(sourceId, videoId, rootId);
  }
  beginTikTokJob(run: CollectionRun, plan: TikTokJob) {
    this.db.exec('BEGIN');
    try {
      // A new selection supersedes the previous resumable journal for this workspace.
      this.db.exec(`DELETE FROM tiktok_jobs WHERE run_id IN (SELECT id FROM runs
        WHERE json_extract(body,'$.status') IN ('partial','failed')
        AND COALESCE(json_extract(body,'$.followUp.state'),'') <>'manual')`);
      this.saveRun(run);
      this.db.prepare('INSERT INTO tiktok_jobs VALUES (?,?)').run(run.id, JSON.stringify(plan));
      if (run.ideaMode === 'ai' && !run.threadsOnly) {
        for (const source of plan.config.sources.filter(s => s.platform === 'tiktok' && s.enabled)) {
          const previous = this.db.prepare(`SELECT j.run_id,j.plan FROM tiktok_jobs j JOIN runs r ON r.id=j.run_id
            JOIN tiktok_pages p ON p.run_id=j.run_id AND p.source_id=? AND p.page IN ('analysis-videos','finished')
            WHERE json_extract(r.body,'$.followUp.state')='manual' AND j.run_id<>?
            ORDER BY r.rowid DESC LIMIT 1`).get(source.id, run.id);
          if (!previous) continue;
          const old = JSON.parse(String(previous.plan)) as TikTokJob;
          const same = old.config.sources.some(s => s.id === source.id && s.url === source.url && s.accountId === source.accountId)
            && selectionPolicy(plan.config) === selectionPolicy(old.config);
          if (same && this.tikTokJournal(String(previous.run_id), source.id).get('analysis-videos')) {
            this.db.prepare(`INSERT INTO tiktok_pages SELECT ?,source_id,page,body FROM tiktok_pages
              WHERE run_id=? AND source_id=? AND (page='analysis-videos' OR page LIKE 'received:%')`)
              .run(run.id, previous.run_id, source.id);
            this.tikTokJournal(run.id, source.id).put('continue-selection', true);
          }
          this.db.prepare('DELETE FROM tiktok_pages WHERE run_id=? AND source_id=?').run(previous.run_id,source.id);
          this.db.prepare('DELETE FROM tiktok_jobs WHERE run_id=? AND NOT EXISTS (SELECT 1 FROM tiktok_pages WHERE run_id=?)')
            .run(previous.run_id,previous.run_id);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  pendingTikTokJob() {
    const row = this.db.prepare(`SELECT run_id, plan FROM tiktok_jobs
      JOIN runs ON runs.id=run_id WHERE json_extract(runs.body,'$.status')='running'`).get();
    if (!row) return null;
    const run = this.run(String(row.run_id))!;
    const totals = this.db
      .prepare(
        "SELECT json_extract(body,'$.kind') AS kind, COUNT(*) AS n FROM run_records WHERE run_id=? GROUP BY kind",
      )
      .all(run.id);
    for (const row of totals)
      run.counts[row.kind === 'post' ? 'posts' : 'comments'] = Number(row.n);
    return { run, plan: JSON.parse(String(row.plan)) as TikTokJob };
  }
  finishTikTokJob(id: string) {
    this.db.prepare('DELETE FROM tiktok_jobs WHERE run_id=?').run(id);
  }
  resumableTikTok(run: CollectionRun, connectedSource?: string) {
    return (
      !!connectedSource &&
      unfinishedTikTokSource(run) === connectedSource &&
      !!this.db.prepare('SELECT 1 FROM tiktok_jobs WHERE run_id=?').get(run.id)
    );
  }
  reopenTikTokJob(run: CollectionRun, sourceId: string) {
    const row = this.db.prepare('SELECT plan FROM tiktok_jobs WHERE run_id=?').get(run.id)!;
    const plan = JSON.parse(String(row.plan)) as TikTokJob;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Keep verified pages, the rotation history, reply checkpoints and the actual
      // provider cooldown. A temporary deferral is a scheduling decision, not a
      // successful response, including for reply pages that were never requested.
      this.db.prepare(`DELETE FROM tiktok_pages WHERE run_id=? AND source_id=? AND
        (page IN ('finished','primary-outage') OR
         (page LIKE 'unavailable:%' AND
          json_extract(body,'$.code') IN ('TIKTOK_DEFERRED','TIKTOK_RETRY_EXHAUSTED','TIKTOK_RETRY_TOO_LATE')))`).run(run.id, sourceId);
      run.tiktokCollectionVersion = 3;
      run.status = 'running';
      run.active = 'tiktok';
      const stages = ['tiktok', 'comments', 'collector', 'ideas', 'materials', 'orchestrator'];
      run.done = run.done.filter((stage) => !stages.includes(stage));
      run.steps = Object.fromEntries(
        Object.entries(run.steps).filter(([stage]) => run.done.includes(stage)),
      );
      run.steps.tiktok = 1;
      delete run.finishedAt;
      delete run.error;
      delete run.retryAt;
      delete run.failures?.tiktok;
      const source = run.sources![sourceId];
      source.status = 'reading';
      delete source.reason;
      delete source.stopCode;
      delete source.notices;
      delete source.retry;
      run.events = ['Продолжаем чтение комментариев с сохранённых страниц', ...run.events].slice(0, 20);
      this.saveRun(run, false);
      this.db.exec('COMMIT');
      return plan;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  tikTokJournal(runId: string, sourceId: string) {
    const get = this.db.prepare(
      'SELECT body FROM tiktok_pages WHERE run_id=? AND source_id=? AND page=?',
    );
    const put = this.db.prepare('INSERT OR REPLACE INTO tiktok_pages VALUES (?,?,?,?)');
    return {
      get<T>(page: string): T | undefined {
        const row = get.get(runId, sourceId, page);
        return row ? (JSON.parse(String(row.body)) as T) : undefined;
      },
      put(page: string, value: unknown) {
        put.run(runId, sourceId, page, JSON.stringify(value));
      },
    };
  }
  savedSourceComments(runId: string, sourceId: string) {
    return Number(
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM run_records WHERE run_id=? AND json_extract(body,'$.sourceId')=? AND json_extract(body,'$.kind')='comment'",
        )
        .get(runId, sourceId)!.n,
    );
  }
  secret<T>(id: string): T | null {
    const row = this.db.prepare('SELECT value FROM vault WHERE id=?').get(id);
    if (!row) return null;
    const data = Buffer.from(row.value as string, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
    );
  }
  setSecret(id: string, value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    this.db
      .prepare('INSERT OR REPLACE INTO vault VALUES (?,?)')
      .run(id, Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64'));
  }
  deleteSecret(id: string) {
    this.db.prepare('DELETE FROM vault WHERE id=?').run(id);
  }
  saveRun(run: CollectionRun, withIdeas = true) {
    run.updatedAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(run.id, JSON.stringify({ ...run, ideas: [] }));
    if (!withIdeas) return;
    const insert = this.db.prepare('INSERT OR REPLACE INTO run_ideas VALUES (?,?,?)');
    for (const idea of run.ideas) insert.run(run.id, idea.id, JSON.stringify(idea));
  }
  run(id: string, withIdeas = true): CollectionRun | null {
    const row = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id);
    if (!row) return null;
    const run = JSON.parse(row.body as string) as CollectionRun;
    if (withIdeas) run.ideas = this.ideas(id, 0, 100);
    return run;
  }
  latest(withIdeas = true): CollectionRun | null {
    const row = this.db
      .prepare("SELECT body FROM runs ORDER BY json_extract(body,'$.startedAt') DESC LIMIT 1")
      .get();
    if (!row) return null;
    const run = JSON.parse(row.body as string) as CollectionRun;
    if (withIdeas) run.ideas = this.ideas(run.id, 0, 100);
    return run;
  }
  latestForPlatform(platform: 'telegram' | 'tiktok'): CollectionRun | null {
    const row = this.db
      .prepare(
        "SELECT body FROM runs WHERE EXISTS (SELECT 1 FROM json_each(runs.body,'$.sources') AS s WHERE json_extract(s.value,'$.platform')=?) ORDER BY json_extract(body,'$.startedAt') DESC LIMIT 1",
      )
      .get(platform);
    return row ? JSON.parse(row.body as string) : null;
  }
  previousTikTokRun(sourceId: string, before: string): CollectionRun['previousTikTokRun'] {
    const row = this.db
      .prepare(
        `SELECT id, json_extract(body,'$.counts') AS counts, json_extract(body,'$.updatedAt') AS updated FROM runs
      WHERE NOT COALESCE(json_extract(body,'$.threadsOnly'),0)
        AND json_extract(body,'$.startedAt') < ?
        AND json_extract(body,'$.status') IN ('completed','partial')
        AND EXISTS (SELECT 1 FROM json_each(body,'$.sources') WHERE key=?)
        AND NOT EXISTS (SELECT 1 FROM json_each(body,'$.sources') WHERE key<>?)
      ORDER BY json_extract(body,'$.startedAt') DESC LIMIT 1`,
      )
      .get(before, sourceId, sourceId);
    return (
      row && {
        id: String(row.id),
        counts: JSON.parse(String(row.counts)),
        updatedAt: String(row.updated),
      }
    );
  }
  ideas(runId: string, offset = 0, limit = 25): CollectionRun['ideas'] {
    return this.db
      .prepare('SELECT body FROM run_ideas WHERE run_id=? ORDER BY rowid LIMIT ? OFFSET ?')
      .all(runId, limit, offset)
      .map((row) => JSON.parse(row.body as string));
  }
  legacyIdeaRuns(version: number): CollectionRun[] {
    return this.db
      .prepare(
        `SELECT body FROM runs
      WHERE COALESCE(json_extract(body,'$.ideaAnalysisVersion'),0) < ?
      AND json_extract(body,'$.status') != 'running'
      AND EXISTS (SELECT 1 FROM json_each(runs.body,'$.done') WHERE value IN ('ideas','materials'))`,
      )
      .all(version)
      .map((row) => JSON.parse(row.body as string));
  }
  replaceRunIdeas(run: CollectionRun) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM run_ideas WHERE run_id=?').run(run.id);
      this.saveRun(run);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  addRecord(runId: string, record: CollectedRecord) {
    const body = JSON.stringify(record);
    this.db.exec('SAVEPOINT collect_record');
    try {
      this.db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
        .run(record.id, body);
      const result = this.db.prepare('INSERT OR IGNORE INTO run_records VALUES (?,?,?)').run(runId, record.id, body);
      this.db.exec('RELEASE collect_record');
      return Number(result.changes) > 0;
    } catch (error) {
      this.db.exec('ROLLBACK TO collect_record; RELEASE collect_record');
      throw error;
    }
  }
  analyzedComment(id: string) {
    return !!this.db.prepare('SELECT 1 FROM ai_idea_inputs WHERE record_id=? UNION ALL SELECT 1 FROM ai_input_claims WHERE record_id=? LIMIT 1').get(id,id);
  }
  savedDiscussion(runId: string, sourceId: string, videoId: string, window: { since: string; until: string },
    replies: boolean, minLikes: number, limit: number): CollectedRecord[] {
    return this.db.prepare(`SELECT body FROM records
      WHERE json_extract(body,'$.platform')='tiktok' AND json_extract(body,'$.kind')='comment'
        AND json_extract(body,'$.sourceId')=? AND json_extract(body,'$.videoId')=?
        AND length(trim(json_extract(body,'$.text'))) > 0
        AND json_extract(body,'$.publishedAt') BETWEEN ? AND ?
        AND (? OR json_extract(body,'$.parentId') IS NULL)
        AND COALESCE(json_extract(body,'$.metrics.likes'),0)>=?
        AND NOT EXISTS (SELECT 1 FROM ai_idea_inputs i WHERE i.record_id=records.id)
        AND NOT EXISTS (SELECT 1 FROM ai_input_claims c WHERE c.record_id=records.id)
        AND NOT EXISTS (SELECT 1 FROM run_records r WHERE r.run_id=? AND r.id=records.id)
      ORDER BY json_extract(body,'$.publishedAt') DESC, id LIMIT ?`)
      .all(sourceId, videoId, window.since, window.until, Number(replies), minLikes, runId, limit)
      .map(row => JSON.parse(String(row.body)));
  }
  attachSavedRecord(runId: string, record: CollectedRecord) {
    return this.db.prepare('INSERT OR IGNORE INTO run_records VALUES (?,?,?)')
      .run(runId, record.id, JSON.stringify(record)).changes > 0;
  }
  discussionSize(runId: string, sourceId: string, videoId: string) {
    return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM run_records WHERE run_id=?
      AND json_extract(body,'$.sourceId')=? AND json_extract(body,'$.videoId')=?
      AND json_extract(body,'$.kind')='comment'`).get(runId, sourceId, videoId)!.n);
  }
  videosWithComments(runId: string, sourceId: string) {
    return Number(this.db.prepare(`SELECT COUNT(DISTINCT json_extract(body,'$.videoId')) AS n
      FROM run_records WHERE run_id=? AND json_extract(body,'$.sourceId')=? AND json_extract(body,'$.kind')='comment'`)
      .get(runId, sourceId)!.n);
  }
  records(runId: string, offset = 0, limit = 200): CollectedRecord[] {
    return this.db
      .prepare('SELECT body FROM run_records WHERE run_id=? ORDER BY rowid LIMIT ? OFFSET ?')
      .all(runId, limit, offset)
      .map((row) => JSON.parse(row.body as string));
  }
  *collectedRecords(): IterableIterator<CollectedRecord> {
    for (const row of this.db.prepare('SELECT body FROM records ORDER BY rowid').iterate()) {
      yield JSON.parse(row.body as string) as CollectedRecord;
    }
  }
  close() {
    this.db.close();
    this.key.fill(0);
  }
}
