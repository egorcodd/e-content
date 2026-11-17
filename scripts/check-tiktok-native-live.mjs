import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  defaultSettings,
  defaultPlatformSettings,
  defaultRunLimits,
} from '../src/features/sources/model.ts';

if (!process.argv.includes('--live')) throw new Error('Для настоящего сбора укажите --live.');
const base = process.env.ECONTENT_API ?? 'http://127.0.0.1:5187/api';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Проверка разрешена только локально.');
let cookie, csrf;
async function request(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
  return result;
}
let state = await request('/connections');
csrf = state.csrfToken;
assert.equal(state.tiktok.transport, 'native');
if (state.tiktok.phase !== 'connected') {
  await request('/tiktok/connect', { handle: process.env.TIKTOK_PROFILE ?? '@egorcod' });
  for (let i = 0; i < 120; i++) {
    await delay(1000);
    state = await request('/connections');
    if (state.tiktok.phase !== 'checking') break;
  }
}
assert.equal(state.tiktok.phase, 'connected', state.tiktok.message);
console.log(
  JSON.stringify({
    profile: state.tiktok.account.handle,
    videos: state.tiktok.videos.length,
    coverage: state.tiktok.coverage,
  }),
);
const configuration = {
  schemaVersion: 2,
  sources: [],
  settings: {
    ...defaultSettings,
    period: '90',
    comments: true,
    publications: true,
    metrics: true,
    maxComments: 50,
  },
  platforms: structuredClone(defaultPlatformSettings),
  runLimits: { ...defaultRunLimits, maxPublications: 20, maxComments: 50, maxRequests: 25 },
};
const latest = (await request('/collection/latest')).run;
const reusable =
  latest?.id?.startsWith('tiktok-native-live-') &&
  (latest.status === 'running' || latest.counts.comments > 0);
const id = reusable ? latest.id : 'tiktok-native-live-' + Date.now();
if (!reusable) await request('/collection/runs', { id, mode: 'tiktok', configuration });
let run;
for (let i = 0; i < 240; i++) {
  await delay(1000);
  run = (await request('/collection/runs/' + id)).run;
  if (!['queued', 'running'].includes(run.status)) break;
}
if (['queued', 'running'].includes(run.status)) {
  await request('/collection/runs/' + id + '/cancel', {});
  throw new Error('Проверка остановлена по времени.');
}
console.log(
  JSON.stringify({
    id,
    status: run.status,
    counts: run.counts,
    sourceStates: Object.values(run.sources ?? {}).map((s) => ({
      status: s.status,
      code: s.stopCode,
    })),
    error: run.error,
  }),
);
assert.ok(run.counts.comments > 0, 'Не получены настоящие комментарии.');
const records = await request('/collection/runs/' + id + '/records');
const rows = records.items;
const comments = rows.filter((r) => r.kind === 'comment');
assert.ok(
  comments.some((c) => c.parentId),
  'Не получены настоящие ответы.',
);
assert.ok(comments.every((c) => typeof c.text === 'string' && c.commentId && c.url));
assert.ok(
  comments.some((c) => c.text.trim()),
  'Нет текстовых комментариев.',
);
console.log(
  JSON.stringify({
    verifiedComments: comments.length,
    replies: comments.filter((c) => c.parentId).length,
    unique: new Set(comments.map((c) => c.id)).size,
  }),
);
