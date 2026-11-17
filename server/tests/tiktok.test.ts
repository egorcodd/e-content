import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComments, parseVideo, tiktokId } from '../tiktok/parser.ts';
import { readerFixture, rawVideo, rawComment, videoId, videoUrl } from './tiktok-fixtures.ts';
import type { ReadOptions } from '../tiktok/contracts.ts';
import { AppError } from '../errors.ts';

const source = {
  id: 'tt-fixture',
  platform: 'tiktok' as const,
  kind: 'video' as const,
  url: videoUrl,
  title: 'TikTok fixture',
  purpose: 'own' as const,
  accountId: null,
  enabled: true,
  createdAt: new Date().toISOString(),
};
test('TikTok parser retains long IDs, zero metrics, dates and inline reply relationships', () => {
  assert.equal(tiktokId(videoId), videoId);
  assert.throws(() => tiktokId(Number(videoId)));
  const video = parseVideo(
    { ...rawVideo, statsV2: { playCount: '0', commentCount: '3' } },
    videoId,
  );
  assert.equal(video.metrics.views, 0);
  assert.equal(video.metrics.likes, undefined);
  assert.throws(() => parseVideo(rawVideo, '12345'), /другой ролик/);
  const raw = rawComment('9000000000000000001');
  Object.assign(raw, { reply_comment: [rawComment('9000000000000000002', raw.cid)] });
  const parsed = parseComments(
    { status_code: 0, comments: [raw], cursor: 20, has_more: 1 },
    videoId,
  );
  assert.equal(parsed.previews[0].parentId, raw.cid);
  assert.equal(parsed.items[0].videoId, videoId);
  assert.throws(
    () => parseComments({ status_code: 0, comments: [], cursor: 0, has_more: 1 }, videoId),
    /курсор/,
  );
  assert.throws(() => parseComments({}, videoId), /страницу комментариев/);
  assert.throws(() => parseComments({ captcha: true }, videoId), /проверку/);
});

function options(patch: Partial<ReadOptions> = {}) {
  const comments: string[] = [],
    videos: string[] = [],
    states: string[] = [],
    reasons: (string | undefined)[] = [];
  let requests = 0;
  const value: ReadOptions = {
    signal: AbortSignal.timeout(20000),
    maxVideos: 1,
    maxComments: 10,
    replies: true,
    comments: true,
    since: new Date(Date.now() - 7 * 86400000).toISOString(),
    beforeRequest: async () => {
      requests++;
    },
    onVideo: (video) => videos.push(video.id),
    onComment: (comment) => comments.push(comment.id),
    onProgress: (progress) => {
      states.push(progress.status);
      reasons.push(progress.reason);
    },
    ...patch,
  };
  return {
    value,
    comments,
    videos,
    states,
    reasons,
    get requests() {
      return requests;
    },
  };
}
test('guest browser reads root pages and inline replies without authentication', async () => {
  const fixture = readerFixture(),
    capture = options();
  await fixture.reader.read(source, capture.value);
  assert.deepEqual(capture.comments, [
    '9000000000000000001',
    '9000000000000000002',
    '9000000000000000003',
  ]);
  assert.deepEqual(capture.videos, [videoId]);
  assert.equal(capture.states.at(-1), 'completed');
  assert.equal(fixture.requests.filter((path) => path.includes('/api/comment/')).length, 2);
  assert.ok(capture.requests >= 3);
  assert.ok(!fixture.requests.some((path) => /login|passport|oauth/.test(path)));
  assert.equal(fixture.browser?.isConnected(), false);
});
test('record limits stop pagination and keep an explicitly limited result', async () => {
  const fixture = readerFixture(),
    capture = options({ maxComments: 1 });
  await fixture.reader.read(source, capture.value);
  assert.equal(capture.comments.length, 1);
  assert.equal(capture.states.at(-1), 'limited');
  assert.equal(capture.reasons.at(-1), 'Достигнут предел комментариев выбранного источника.');
  assert.equal(fixture.requests.filter((path) => path.includes('/api/comment/')).length, 1);
});
test('reply switch excludes previews; cursor loops fail instead of looping forever', async () => {
  const fixture = readerFixture(),
    capture = options({ replies: false });
  await fixture.reader.read(source, capture.value);
  assert.equal(capture.comments.length, 2);
  assert.equal(capture.states.at(-1), 'completed');
  const repeated = readerFixture('repeat');
  await assert.rejects(repeated.reader.read(source, options().value), /курсор/);
  assert.equal(repeated.browser?.isConnected(), false);
});
test('exhausted comment budget retains video metadata without claiming comment completion', async () => {
  const fixture = readerFixture(),
    capture = options({ maxComments: 0 });
  await fixture.reader.read(source, capture.value);
  assert.equal(capture.videos.length, 1);
  assert.equal(capture.comments.length, 0);
  assert.equal(capture.states.at(-1), 'limited');
  assert.equal(fixture.requests.filter((path) => path.includes('/api/comment/')).length, 0);
});
test('login, age verification and CAPTCHA stop after retaining public metadata', async () => {
  for (const [mode, code] of [
    ['login', 'TIKTOK_LOGIN_REQUIRED'],
    ['age', 'TIKTOK_AGE_REQUIRED'],
    ['captcha', 'TIKTOK_BLOCKED'],
  ] as const) {
    const fixture = readerFixture(mode),
      capture = options();
    await assert.rejects(
      fixture.reader.read(source, capture.value),
      (error) => error instanceof AppError && error.code === code,
    );
    assert.equal(capture.videos.length, 1);
    assert.equal(capture.comments.length, 0);
    assert.equal(fixture.browser?.isConnected(), false);
  }
});
test('cancellation and network budget close the browser and preserve a bounded attempt', async () => {
  const control = new AbortController(),
    fixture = readerFixture('hang');
  const capture = options({ signal: control.signal, onVideo: () => control.abort() });
  await assert.rejects(fixture.reader.read(source, capture.value));
  assert.equal(fixture.browser?.isConnected(), false);
  let requests = 0;
  const limited = readerFixture();
  await assert.rejects(
    limited.reader.read(
      source,
      options({
        beforeRequest: async () => {
          if (++requests > 2) throw new AppError(429, 'REQUEST_BUDGET', 'Fixture request limit');
        },
      }).value,
    ),
    /request limit/,
  );
  assert.equal(limited.browser?.isConnected(), false);
});
