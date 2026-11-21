import type { DatabaseSync } from 'node:sqlite';
import type { TikTokVideo } from './parser.ts';

type RootPage = { video: TikTokVideo; cursor: string };

// Both tables outlive the per-run journal. A blocked path is scoped to the
// public source; an explicit upstream cooldown also covers catalog requests.
export class TikTokReadBacklog {
  constructor(private db: DatabaseSync) {
    const needsDeferrals = !db.prepare("SELECT 1 FROM sqlite_master WHERE name='tiktok_deferred_videos'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS tiktok_root_backlog (
      source_id TEXT NOT NULL, video_id TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(source_id,video_id)
    );
    CREATE TABLE IF NOT EXISTS tiktok_deferred_videos (
      source_id TEXT NOT NULL, video_id TEXT NOT NULL, deferred_at INTEGER NOT NULL,
      PRIMARY KEY(source_id,video_id)
    );
    CREATE TABLE IF NOT EXISTS tiktok_cooldowns (
      source_id TEXT NOT NULL, path TEXT NOT NULL, until_ms INTEGER NOT NULL,
      PRIMARY KEY(source_id,path)
    );`);
    if (needsDeferrals && db.prepare("SELECT 1 FROM sqlite_master WHERE name='runs'").get()) {
      db.exec(`INSERT OR IGNORE INTO tiktok_deferred_videos
        SELECT source.key, json_extract(source.value,'$.failedRequest.videoId'),
          CAST(strftime('%s',json_extract(latest.body,'$.updatedAt')) AS INTEGER) * 1000
        FROM (SELECT body FROM runs WHERE json_extract(body,'$.finishedAt') IS NOT NULL ORDER BY rowid DESC LIMIT 1) latest,
          json_each(latest.body,'$.sources') source
        WHERE json_extract(source.value,'$.stopCode')='TIKTOK_SAMPLE_PAUSED'
          AND json_extract(source.value,'$.failedRequest.videoId') IS NOT NULL
          AND strftime('%s',json_extract(latest.body,'$.updatedAt')) IS NOT NULL`);
    }
  }

  roots(source: string): RootPage[] {
    return this.db
      .prepare('SELECT body FROM tiktok_root_backlog WHERE source_id=? ORDER BY rowid')
      .all(source)
      .map((row) => JSON.parse(String(row.body)) as RootPage);
  }

  save(source: string, video: TikTokVideo, cursor: string) {
    this.db
      .prepare(
        `INSERT INTO tiktok_root_backlog VALUES (?,?,?)
      ON CONFLICT(source_id,video_id) DO UPDATE SET body=excluded.body`,
      )
      .run(source, video.id, JSON.stringify({ video, cursor }));
  }

  finish(source: string, videoId: string) {
    this.db
      .prepare('DELETE FROM tiktok_root_backlog WHERE source_id=? AND video_id=?')
      .run(source, videoId);
  }

  deferVideo(source: string, video: string) {
    this.db.prepare(`INSERT INTO tiktok_deferred_videos VALUES (?,?,?)
      ON CONFLICT(source_id,video_id) DO UPDATE SET deferred_at=excluded.deferred_at`).run(source,video,Date.now());
  }

  deferredVideos(source: string): Record<string,number> {
    const rows = this.db.prepare('SELECT video_id,deferred_at FROM tiktok_deferred_videos WHERE source_id=?').all(source);
    return Object.fromEntries(rows.map(row => [String(row.video_id),Number(row.deferred_at)]));
  }

  clearDeferral(source: string, video: string) {
    this.db.prepare('DELETE FROM tiktok_deferred_videos WHERE source_id=? AND video_id=?').run(source,video);
  }

  cooldown(source: string, path: string) {
    const result = this.db
      .prepare(
        `SELECT MAX(until_ms) AS next FROM tiktok_cooldowns
      WHERE source_id=? AND path IN ('*',?) AND until_ms>?`,
      )
      .get(source, path, Date.now());
    return Number(result?.next ?? 0);
  }

  rememberCooldown(source: string, path: string, until: number) {
    this.db
      .prepare(
        `INSERT INTO tiktok_cooldowns VALUES (?,?,?)
      ON CONFLICT(source_id,path) DO UPDATE SET until_ms=MAX(until_ms, excluded.until_ms)`,
      )
      .run(source, path, until);
  }

  pruneCooldowns(source: string) {
    this.db
      .prepare('DELETE FROM tiktok_cooldowns WHERE source_id=? AND until_ms<=?')
      .run(source, Date.now());
  }
}
