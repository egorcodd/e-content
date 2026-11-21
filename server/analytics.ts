import { randomUUID } from 'node:crypto';
import type {
  AnalyticsHistory,
  CatalogVideo,
  TikTokCatalogScan,
} from '../src/features/analytics/contracts.ts';
import { accumulateVideoGrowth, catalogChange, catalogDifferences, sumCounters, videoGrowthMetrics } from '../src/features/analytics/counters.ts';
import { AppError } from './errors.ts';
import type { LocalStore } from './store.ts';
import type { NativeTikTokSource } from './tiktok/native-source.ts';

export class TikTokAnalytics {
  private current?: { control: AbortController; task: Promise<void> };
  private changes = new Map<string, ReturnType<typeof catalogChange>>();

  constructor(
    private readonly store: LocalStore,
    private readonly source?: NativeTikTokSource,
  ) {
    const { db } = store;
    db.exec(`
      CREATE TABLE IF NOT EXISTS tiktok_catalog_scans (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, started_at TEXT NOT NULL,
        status TEXT NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tiktok_catalog_profile
        ON tiktok_catalog_scans(profile_id, started_at);
      CREATE TABLE IF NOT EXISTS tiktok_catalog_videos (
        scan_id TEXT NOT NULL REFERENCES tiktok_catalog_scans(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scan_id, video_id)
      );
    `);
    for (const row of db
      .prepare("SELECT profile_id, body FROM tiktok_catalog_scans WHERE status='running'")
      .all()) {
      const scan = JSON.parse(row.body as string) as TikTokCatalogScan;
      this.save(row.profile_id as string, {
        ...scan,
        status: scan.videos ? 'partial' : 'failed',
        finishedAt: new Date().toISOString(),
        error: 'Сервер перезапустился во время сбора статистики.',
      });
    }
  }

  get busy() {
    return this.current !== undefined;
  }
  async refresh(signal: AbortSignal) {
    signal.throwIfAborted();
    this.start();
    const current = this.current!;
    const abort = () => current.control.abort();
    signal.addEventListener('abort', abort, {once: true});
    try {
      await current.task;
      signal.throwIfAborted();
      const scan = this.history().scan;
      if (scan?.status !== 'complete') throw new Error(scan?.error ?? 'Статистика TikTok недоступна.');
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private save(profileId: string, scan: TikTokCatalogScan) {
    this.store.db
      .prepare(
        `
      INSERT INTO tiktok_catalog_scans VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, body=excluded.body
    `,
      )
      .run(scan.id, profileId, scan.startedAt, scan.status, JSON.stringify(scan));
  }

  history(): AnalyticsHistory {
    const account = this.source?.state().account;
    if (!account) return { tiktok: [] };
    const { db } = this.store;
    const recent = db
      .prepare(
        `SELECT body FROM tiktok_catalog_scans
      WHERE profile_id=? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(account.id);
    const complete = db
      .prepare(
        `SELECT body FROM tiktok_catalog_scans
      WHERE profile_id=? AND status='complete' ORDER BY started_at`,
      )
      .all(account.id)
      .map((row) => JSON.parse(row.body as string) as TikTokCatalogScan);
    const scan = recent ? (JSON.parse(recent.body as string) as TikTokCatalogScan) : undefined;
    return {
      handle: account.handle,
      scan,
      catalog: complete.at(-1) ?? (scan?.status === 'partial' ? scan : undefined),
      tiktok: complete.map((item, index) => ({
        id: item.id,
        date: item.finishedAt!,
        videos: item.videos,
        followers: item.followers,
        counters: item.counters!,
        change: index ? this.interval(complete[index - 1], item) : undefined,
      })),
    };
  }

  private interval(previous: TikTokCatalogScan, current: TikTokCatalogScan) {
    const key = previous.id + '/' + current.id;
    let change = this.changes.get(key);
    if (!change) {
      change = catalogChange(this.catalog(previous.id), this.catalog(current.id), previous.finishedAt!);
      this.changes.set(key, change);
    }
    return change;
  }

  catalog(id: string): CatalogVideo[] {
    const profile = this.source?.state().account;
    if (!profile) return [];
    return this.store.db
      .prepare(
        `
      SELECT v.body FROM tiktok_catalog_videos v JOIN tiktok_catalog_scans s ON s.id=v.scan_id
      WHERE s.id=? AND s.profile_id=? AND s.status IN ('complete', 'partial')
      ORDER BY json_extract(v.body,'$.date') DESC, v.video_id DESC
    `,
      )
      .all(id, profile.id)
      .map((row) => JSON.parse(row.body as string) as CatalogVideo);
  }

  videoGrowth(from: string, to: string): CatalogVideo[] {
    const profile = this.source?.state().account;
    if (!profile) return [];
    const scans = this.store.db.prepare(`
      SELECT id, json_extract(body, '$.finishedAt') AS date FROM tiktok_catalog_scans
      WHERE profile_id = ? AND status = 'complete'
        AND started_at >= (SELECT started_at FROM tiktok_catalog_scans WHERE id = ?)
        AND started_at <= (SELECT started_at FROM tiktok_catalog_scans WHERE id = ?)
      ORDER BY started_at
    `).all(profile.id, from, to) as { id: string; date: string }[];
    if (scans.length < 2 || scans[0].id !== from || scans.at(-1)?.id !== to) return [];

    const totals = new Map<string, CatalogVideo>();
    let previous = this.catalog(from);
    for (let i = 1; i < scans.length; i++) {
      const current = this.catalog(scans[i].id);
      const { changes } = catalogDifferences(previous, current, scans[i - 1].date);
      accumulateVideoGrowth(totals, changes);
      previous = current;
    }
    return [...totals.values()].filter((video) =>
      videoGrowthMetrics.some((metric) => (video.counters[metric] ?? 0) > 0),
    );
  }

  videoUrl(id: string): string | undefined {
    const profile = this.source?.state().account;
    if (!profile || !/^\d{1,30}$/.test(id)) return;
    const row = this.store.db.prepare(`
      SELECT json_extract(v.body, '$.url') AS url
      FROM tiktok_catalog_scans s JOIN tiktok_catalog_videos v ON v.scan_id = s.id
      WHERE s.profile_id = ? AND s.status = 'complete' AND v.video_id = ?
      ORDER BY s.started_at DESC LIMIT 1
    `).get(profile.id, id);
    return typeof row?.url === 'string' ? row.url : undefined;
  }

  start() {
    if (this.busy || this.source?.busy)
      throw new AppError(409, 'TIKTOK_BUSY', 'Дождитесь завершения текущего сбора TikTok.');
    const account = this.source?.state().account;
    if (!account || !this.source)
      throw new AppError(
        409,
        'TIKTOK_PROFILE_REQUIRED',
        'Выберите публичный профиль TikTok в «Источниках».',
      );

    const source = this.source;
    const scan: TikTokCatalogScan = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'running',
      videos: 0,
    };
    this.save(account.id, scan);
    const control = new AbortController();
    const collected = new Map<string, CatalogVideo>();
    const task = (async () => {
      try {
        await source.readCatalog(
          account,
          control.signal,
          (profile) => {
            scan.followers = profile.followers;
            scan.expectedVideos = profile.videos;
            this.save(account.id, scan);
          },
          (videos, last) => {
            const existing = collected.size;
            for (const video of videos) {
              const { forwards, ...other } = video.metrics;
              collected.set(video.id, {
                id: video.id,
                date: video.publishedAt!,
                url: video.url,
                title: video.text,
                counters: { ...other, shares: forwards },
              });
            }
            if (!last && collected.size === existing)
              throw new AppError(502, 'TIKTOK_CATALOG_REPEATED', 'TikTok повторил список роликов.');
            scan.videos = collected.size;
            const insert = this.store.db.prepare(`
            INSERT INTO tiktok_catalog_videos VALUES (?, ?, ?)
            ON CONFLICT(scan_id,video_id) DO UPDATE SET body=excluded.body
          `);
            this.store.db.exec('BEGIN');
            try {
              for (const video of videos)
                insert.run(scan.id, video.id, JSON.stringify(collected.get(video.id)!));
              this.save(account.id, scan);
              this.store.db.exec('COMMIT');
            } catch (error) {
              this.store.db.exec('ROLLBACK');
              throw error;
            }
          },
        );
        if (scan.expectedVideos !== undefined && scan.videos < scan.expectedVideos)
          throw new AppError(
            502,
            'TIKTOK_CATALOG_INCOMPLETE',
            'TikTok выдал меньше роликов, чем указано в профиле.',
          );
        scan.status = 'complete';
      } catch (error) {
        scan.status = scan.videos ? 'partial' : 'failed';
        scan.error = control.signal.aborted
          ? 'Сервер остановился во время сбора статистики.'
          : error instanceof AppError
            ? error.message
            : 'Не удалось обновить статистику TikTok.';
      }
      scan.finishedAt = new Date().toISOString();
      if (scan.status === 'complete') scan.counters = sumCounters([...collected.values()]);
      this.save(account.id, scan);
    })().finally(() => {
      this.current = undefined;
    });
    this.current = { control, task };
    return { ...scan };
  }

  async close() {
    this.current?.control.abort();
    await this.current?.task;
  }
}
