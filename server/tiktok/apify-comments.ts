import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../errors.ts';
import { counter, tiktokId, type TikTokComment, type TikTokVideo } from './parser.ts';
import type { ReadOptions } from './contracts.ts';

type ActorRun = { id: string; defaultDatasetId: string; status: string };
const running = new Set(['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING']);
const endpoint = 'https://api.apify.com/v2/';
const schemaError = () =>
  new AppError(502, 'APIFY_SCHEMA', 'Apify вернул данные в неизвестном формате.');

function parseRun(body: unknown): ActorRun {
  const data = (body as { data?: ActorRun } | null)?.data;
  if (
    !data ||
    !/^[a-zA-Z0-9]+$/.test(data.id ?? '') ||
    !/^[a-zA-Z0-9]+$/.test(data.defaultDatasetId ?? '') ||
    typeof data.status !== 'string'
  )
    throw schemaError();
  return data;
}

function parseRow(row: Record<string, unknown>, videos: Map<string, TikTokVideo>): TikTokComment {
  const url = new URL(String(row.videoWebUrl));
  const id = /^\/@[\w.]+\/video\/(\d+)\/?$/.exec(url.pathname)?.[1];
  if (url.hostname !== 'www.tiktok.com' && url.hostname !== 'tiktok.com') throw schemaError();
  if (!id || !videos.has(id) || typeof row.text !== 'string') throw schemaError();
  const created = typeof row.createTimeISO === 'string' ? Date.parse(row.createTimeISO) : NaN;
  if (!Number.isFinite(created)) throw schemaError();
  const parentId =
    row.repliesToId && String(row.repliesToId) !== '0' ? tiktokId(row.repliesToId) : undefined;
  return {
    id: tiktokId(row.cid),
    videoId: id,
    text: row.text,
    publishedAt: new Date(created).toISOString(),
    parentId,
    threadId: parentId,
    likes: counter(row.diggCount),
    replyCount: counter(row.replyCommentTotal),
  };
}

export async function readApifyComments(
  sourceUrl: string,
  videos: TikTokVideo[],
  options: ReadOptions,
  token: string,
  transport: typeof fetch = fetch,
  catalogComplete = true,
) {
  const selected = new Map(videos.map((v) => [v.id, v]));
  const perVideo = Math.min(options.commentsPerVideo ?? 100, options.maxComments);
  const limit = Math.min(options.maxComments, selected.size * perVideo);
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  let invalid = 0;
  let offset = 0;
  const until = options.collectUntil ?? Date.now() + 300_000;
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(Math.max(0, until - Date.now())),
  ]);
  const progress = (status: 'reading' | 'completed' | 'limited', reason?: string) => {
    const processed = status === 'completed' ? selected.size : counts.size;
    options.onProgress({
      url: sourceUrl,
      provider: 'apify',
      status,
      comments: seen.size,
      receivedComments: seen.size,
      videos: { selected: selected.size, processed },
      ...(reason && { reason, stopCode: 'APIFY_INCOMPLETE' }),
    });
  };
  for (const video of selected.values()) options.onVideo(video);
  progress('reading');
  if (!limit) {
    progress(
      catalogComplete ? 'completed' : 'limited',
      catalogComplete ? undefined : 'Получена часть списка роликов.',
    );
    return;
  }

  async function request(path: string, init?: RequestInit) {
    for (let attempt = 0; ; attempt++) {
      await options.beforeRequest('data', signal);
      let response: Response;
      try {
        response = await transport(endpoint + path, {
          ...init,
          signal,
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        if (init?.method || attempt >= 2 || signal.aborted) throw error;
        await delay(500 * (attempt + 1), undefined, { signal });
        continue;
      }
      if (response.ok) return response.json();
      if (!init?.method && attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? NaN : Number(header);
        const wait = Number.isFinite(seconds)
          ? seconds * 1000
          : header
            ? Date.parse(header) - Date.now()
            : NaN;
        await response.body?.cancel();
        await delay(
          Number.isFinite(wait)
            ? Math.max(100, Math.min(wait, until - Date.now()))
            : 1000 * (attempt + 1),
          undefined,
          { signal },
        );
        continue;
      }
      const reason =
        response.status === 401 || response.status === 403
          ? 'Проверьте ключ и доступ к сборщику в Apify.'
          : response.status === 402
            ? 'Исчерпан доступный баланс Apify.'
            : 'Apify не выполнил запрос (' + response.status + ').';
      throw new AppError(502, 'APIFY_REQUEST', reason);
    }
  }
  const key = 'apify-comment-run';
  const saved = options.journal?.get<ActorRun | 'submitting'>(key);
  if (saved === 'submitting')
    throw new AppError(
      503,
      'APIFY_UNCONFIRMED',
      'Apify не подтвердил запуск. Проверьте список запусков в Apify.',
    );
  let run = saved;
  try {
    if (!run) {
      const seconds = Math.max(1, Math.floor((until - Date.now()) / 1000) - 15);
      const params = new URLSearchParams({
        timeout: String(seconds),
        maxItems: String(limit),
        maxTotalChargeUsd: (Math.ceil(limit * 0.125) / 100).toFixed(2),
      });
      options.journal?.put(key, 'submitting');
      run = parseRun(
        await request('acts/clockworks~tiktok-comments-scraper/runs?' + params, {
          method: 'POST',
          body: JSON.stringify({
            postURLs: videos.map((v) => v.url),
            commentsPerPost: perVideo,
            maxRepliesPerComment: options.replies ? perVideo : 0,
          }),
        }),
      );
      options.journal?.put(key, run);
    }
    for (;;) {
      const terminal = !running.has(run.status);
      // Replay the dataset on process recovery. The local store deduplicates comment IDs.
      for (;;) {
        const size = Math.min(250, limit - seen.size);
        if (!size) break;
        const rows: unknown = await request(
          'datasets/' +
            run.defaultDatasetId +
            '/items?format=json&offset=' +
            offset +
            '&limit=' +
            size,
        );
        if (!Array.isArray(rows)) throw schemaError();
        for (const row of rows) {
          let comment: TikTokComment;
          try {
            comment = parseRow(row, selected);
          } catch {
            invalid++;
            continue;
          }
          if (seen.has(comment.id) || (!options.replies && comment.parentId)) continue;
          const n = counts.get(comment.videoId) ?? 0;
          if (n >= perVideo || seen.size >= limit) continue;
          options.onComment(comment, selected.get(comment.videoId)!);
          seen.add(comment.id);
          counts.set(comment.videoId, n + 1);
        }
        offset += rows.length;
        if (rows.length) progress('reading');
        if (rows.length < size) break;
      }
      if (terminal) break;
      const before = Date.now();
      run = parseRun(await request('actor-runs/' + run.id + '?waitForFinish=8'));
      options.journal?.put(key, run);
      if (running.has(run.status) && Date.now() - before < 1000)
        await delay(1000, undefined, { signal });
    }
    const empty = !seen.size && videos.some(v => v.commentCount !== 0);
    let reason: string | undefined;
    if (run.status !== 'SUCCEEDED')
      reason = 'Apify завершил сбор досрочно. Полученные реплики сохранены.';
    else if (invalid)
      reason =
        'Apify вернул строки с ошибкой или без привязки к ролику. Сохранены проверенные реплики.';
    else if (empty) reason = 'Apify не вернул комментариев ни к одному из выбранных роликов.';
    else if (!catalogComplete) reason = 'Получена часть списка роликов.';
    progress(reason ? 'limited' : 'completed', reason);
  } catch (error) {
    if (run && running.has(run.status)) {
      await transport(endpoint + 'actor-runs/' + run.id + '/abort', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
    options.signal.throwIfAborted();
    if (!signal.aborted && !(error instanceof AppError))
      throw new AppError(
        502,
        'APIFY_CONNECTION',
        'Не удалось получить ответ Apify. Проверьте соединение.',
      );
    if (!signal.aborted) throw error;
    progress('limited', 'Время сбора истекло. Сохранены полученные от Apify реплики.');
  }
}
