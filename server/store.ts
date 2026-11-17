import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { CollectionRun, CollectedRecord } from '../src/features/collection/contracts.ts';

export class LocalStore {
  readonly db: DatabaseSync;
  private key: Buffer;
  constructor(readonly directory: string) {
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
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_records (run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,id));`);
    for (const row of this.db
      .prepare("SELECT body FROM runs WHERE json_extract(body,'$.status')='running'")
      .all()) {
      const run = JSON.parse(row.body as string) as CollectionRun;
      if (run.status === 'running') {
        for (const source of Object.values(run.sources ?? {}))
          if (source.status === 'reading') {
            source.status = 'interrupted';
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
  saveRun(run: CollectionRun) {
    run.updatedAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(run.id, JSON.stringify({ ...run, ideas: [] }));
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
    const result = this.db
      .prepare('INSERT OR IGNORE INTO run_records VALUES (?,?,?)')
      .run(runId, record.id, JSON.stringify(record));
    this.db
      .prepare('INSERT OR REPLACE INTO records VALUES (?,?)')
      .run(record.id, JSON.stringify(record));
    return Number(result.changes) > 0;
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
