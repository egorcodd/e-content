import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { LocalStore } from '../server/store.ts';

if (!process.argv.includes('--confirm'))
  throw new Error('Для удаления материалов и истории укажите --confirm.');
const store = new LocalStore(resolve(import.meta.dirname, '../.local'), { recoverRuns: false });
const db = store.db;
try {
  db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  );
  if (
    db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.status')='running' LIMIT 1").get() ||
    (tables.has('tiktok_catalog_scans') &&
      db.prepare("SELECT id FROM tiktok_catalog_scans WHERE status='running' LIMIT 1").get())
  )
    throw new Error('Дождитесь завершения активного сбора.');
  for (const name of [
    'ai_idea_reports',
    'ai_idea_attempts',
    'run_ideas',
    'run_records',
    'records',
    'tiktok_pages',
    'tiktok_jobs',
    'tiktok_threads',
    'tiktok_exhausted_threads',
    'tiktok_root_backlog',
    'tiktok_deferred_videos',
    'tiktok_counters',
    ...(process.argv.includes('--include-analytics')
      ? ['tiktok_catalog_videos', 'tiktok_catalog_scans', 'telegram_measurements']
      : []),
    'runs',
  ])
    if (tables.has(name)) db.exec('DELETE FROM ' + name);
  if (tables.has('tiktok_cooldowns'))
    db.prepare('DELETE FROM tiktok_cooldowns WHERE until_ms <= ?').run(Date.now());
  store.setSecret('library-reset', randomUUID());
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
} finally {
  store.close();
}
