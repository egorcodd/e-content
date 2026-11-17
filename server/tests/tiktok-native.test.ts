import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, configuration, finish } from './fixtures.ts';
import { NativeTikTokSource } from '../tiktok/native-source.ts';
import { TikTokRequestError, type TikTokTransport } from '../tiktok/native-host.ts';
import { rawVideo, rawComment } from './tiktok-fixtures.ts';

class Transport implements TikTokTransport {
  calls: string[] = [];
  empty = false;
  repeat = false;
  async get(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    this.calls.push(path);
    const now = Math.floor(Date.now() / 1000) - 60;
    if (path.startsWith('/tiktok/user/detail'))
      return {
        userInfo: {
          user: {
            id: '9000000000000000001',
            uniqueId: 'fixture_user',
            nickname: 'Creator',
            secUid: 'sec-fixture',
          },
        },
      };
    if (path.startsWith('/tiktok/user/posts'))
      return {
        itemList: [
          {
            ...rawVideo,
            createTime: now,
            author: { uniqueId: 'fixture_user' },
            stats: { commentCount: 5 },
          },
        ],
        hasMore: false,
      };
    if (path.includes('/replies')) {
      const second = path.endsWith('cursor=2');
      return {
        comments: [0, 1].map((n) => ({
          ...rawComment(String(9000000000000000010n + BigInt(n + (second ? 2 : 0)))),
          create_time: now,
        })),
        total: 4,
        cursor: second ? 4 : 2,
        has_more: 0,
        status_code: 0,
      };
    }
    return {
      comments: this.empty
        ? []
        : [
            {
              ...rawComment('9000000000000000002'),
              create_time: now,
              reply_comment_total: 4,
            },
          ],
      has_more: this.repeat ? 1 : 0,
      cursor: this.repeat ? 1 : 0,
      status_code: 0,
    };
  }
  async close() {}
}

class MultipleVideos extends Transport {
  missingReplies = false;
  blockedVideo?: string;
  override async get(path: string, signal: AbortSignal) {
    if (
      this.blockedVideo &&
      path.includes(`/video/${this.blockedVideo}/`) &&
      path.includes('/replies')
    )
      throw new TikTokRequestError(429, 'TIKTOK_BLOCKED', 'Отдача ограничена', 200);
    const result = await super.get(path, signal);
    if (path.startsWith('/tiktok/user/posts')) {
      const video = (result as { itemList: (typeof rawVideo)[] }).itemList[0];
      return { itemList: [video, { ...video, id: String(BigInt(video.id) - 1n) }], hasMore: false };
    }
    if (path.includes('/comments')) {
      const videoId = /\/video\/(\d+)/.exec(path)![1];
      const data = result as { comments: ReturnType<typeof rawComment>[] };
      return {
        ...result,
        comments:
          this.missingReplies && path.includes('/replies')
            ? []
            : data.comments.map((comment) => ({
                ...comment,
                aweme_id: videoId,
                cid: String(BigInt(comment.cid) + (BigInt(rawVideo.id) - BigInt(videoId)) * 100n),
              })),
      };
    }
    return result;
  }
}

async function connected(f: Awaited<ReturnType<typeof fixture>>) {
  await f.request('/connections');
  const response = await f.request('/tiktok/connect', 'POST', { handle: '@fixture_user' });
  assert.equal(response.status, 200);
  for (let i = 0; i < 100 && f.app.tiktok.busy; i++) await delay(5);
  assert.equal(f.app.tiktok.state().phase, 'connected');
}

test('native connector stores a public profile without claiming account authorization, survives reopening, and feeds real-shaped replies to workshop', async () => {
  const transport = new Transport();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const state = (await f.request('/connections')).data;
    assert.equal(state.tiktok.transport, 'native');
    assert.equal(state.tiktok.authentication, 'public');
    assert.equal(state.accounts.length, 0);
    assert.equal(state.managedSources[0].accountId, null);
    const reopened = new NativeTikTokSource(f.app.store, transport);
    assert.equal(reopened.state().account?.handle, 'fixture_user');
    const config = configuration();
    config.sources = [];
    await f.app.engine.start('native-evidence', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-evidence');
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.comments, 5);
    assert.equal(run.counts.posts, 1);
    assert.equal(
      run.counts.ideas,
      0,
      'a single thread is insufficient evidence of a recurring theme',
    );
    const records = f.app.store.records(run.id).filter((r) => r.kind === 'comment');
    assert.equal(records.filter((r) => r.parentId).length, 4);
    assert.ok(transport.calls.some((p) => p.includes('/replies?cursor=2')));
    assert.equal(new Set(records.map((r) => r.id)).size, 5);
    const oldCount = records.length;
    await f.app.tiktok.disconnect();
    assert.equal(f.app.store.records(run.id).filter((r) => r.kind === 'comment').length, oldCount);
  } finally {
    await f.close();
  }
});

test('native connector counts replies in the common budget and keeps partial results instead of falsely completing', async () => {
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: new Transport() });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    config.runLimits.maxComments = 2;
    await f.app.engine.start('native-limit', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-limit');
    assert.equal(run.counts.comments, 2);
    assert.equal(run.status, 'partial');
    assert.equal(Object.values(run.sources!)[0].status, 'limited');
  } finally {
    await f.close();
  }
});

test('native connector rejects bad profiles before network and fails missing comment bodies without erasing metadata', async () => {
  const transport = new Transport();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await f.request('/connections');
    assert.equal(
      (await f.request('/tiktok/connect', 'POST', { handle: 'https://example.com/@someone' }))
        .status,
      400,
    );
    assert.equal(transport.calls.length, 0);
    await connected(f);
    transport.empty = true;
    const config = configuration();
    config.sources = [];
    await f.app.engine.start('native-empty', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-empty');
    assert.equal(run.status, 'partial');
    assert.equal(run.counts.posts, 1);
    assert.equal(run.counts.comments, 0);
    assert.equal(Object.values(run.sources!)[0].stopCode, 'TIKTOK_COMMENTS_EMPTY');
    assert.equal(f.app.tiktok.state().phase, 'connected');
  } finally {
    await f.close();
  }
});

test('native connector detects repeated comment cursors with already collected evidence retained', async () => {
  const transport = new Transport();
  transport.repeat = true;
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    await f.app.engine.start('native-cursor', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-cursor');
    assert.equal(Object.values(run.sources!)[0].stopCode, 'TIKTOK_CURSOR');
    assert.equal(run.counts.comments, 5);
    assert.ok(transport.calls.length < 12);
  } finally {
    await f.close();
  }
});

test('native settings accept a chosen number of recent videos and retain limits on reopening', async () => {
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: new Transport() });
  try {
    await connected(f);
    const response = await f.request('/tiktok/selection', 'POST', {
      latest: 37,
      commentsPerVideo: 2,
      enabled: true,
    });
    assert.equal(response.status, 200);
    const reopened = new NativeTikTokSource(f.app.store, new Transport());
    assert.equal(reopened.state().selection.latest, 37);
    assert.equal(reopened.state().selection.commentsPerVideo, 2);
    for (const invalid of [0, 101, 1.5]) {
      assert.equal(
        (
          await f.request('/tiktok/selection', 'POST', {
            latest: invalid,
            commentsPerVideo: 2,
            enabled: true,
          })
        ).status,
        400,
      );
    }
  } finally {
    await f.close();
  }
});

test('a per-video comment limit advances to the next video and records the exact reason', async () => {
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: new MultipleVideos(),
  });
  try {
    await connected(f);
    await f.request('/tiktok/selection', 'POST', { latest: 2, commentsPerVideo: 2, enabled: true });
    const config = configuration();
    config.sources = [];
    config.runLimits.maxComments = 20000;
    await f.app.engine.start('native-per-video', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-per-video');
    assert.equal(run.counts.comments, 4);
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.posts, 2);
    const progress = Object.values(run.sources!)[0];
    assert.equal(progress.stopCode, 'TIKTOK_PER_VIDEO_LIMIT');
    assert.deepEqual(progress.videos, { selected: 2, processed: 2 });
    assert.match(progress.reason!, /2 из 2/);
    assert.doesNotMatch(progress.reason!, /или|бюджет/i);
    assert.equal(run.parameters?.tiktok?.commentsPerVideo, 2);
  } finally {
    await f.close();
  }
});

test('the overall limit is reported separately from per-video limits', async () => {
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: new MultipleVideos(),
  });
  try {
    await connected(f);
    await f.request('/tiktok/selection', 'POST', { latest: 2, commentsPerVideo: 2, enabled: true });
    const config = configuration();
    config.sources = [];
    config.runLimits.maxComments = 3;
    await f.app.engine.start('native-overall-limit', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-overall-limit');
    assert.equal(run.counts.comments, 3);
    assert.equal(Object.values(run.sources!)[0].stopCode, 'TIKTOK_TOTAL_COMMENT_LIMIT');
    assert.match(run.error!, /общий лимит/i);
  } finally {
    await f.close();
  }
});

test('an upstream restriction records the exact video and step, including a partial discussion', async () => {
  const transport = new MultipleVideos();
  const videoId = String(BigInt(rawVideo.id) - 1n);
  transport.blockedVideo = videoId;
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    await f.app.engine.start('native-upstream-stop', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-upstream-stop');
    const progress = Object.values(run.sources!)[0];
    assert.equal(run.status, 'partial');
    assert.equal(run.counts.posts, 2);
    assert.equal(run.counts.comments, 6);
    assert.deepEqual(progress.videos, { selected: 2, processed: 1 });
    assert.deepEqual(progress.failedRequest, {
      stage: 'replies',
      videoId,
      videoNumber: 2,
      upstreamStatus: 200,
    });
    assert.equal(progress.stopCode, 'TIKTOK_BLOCKED');
  } finally {
    await f.close();
  }
});

test('missing reply continuation has its own reason instead of a generic limit message', async () => {
  const transport = new MultipleVideos();
  transport.missingReplies = true;
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    await f.app.engine.start(
      'native-missing-replies',
      'tiktok',
      f.app.tiktok.configuration(config),
    );
    const run = await finish(f.app, 'native-missing-replies');
    assert.equal(Object.values(run.sources!)[0].stopCode, 'TIKTOK_REPLIES_INCOMPLETE');
    assert.match(run.error!, /продолжение ответов/i);
    assert.doesNotMatch(run.error!, /достигнут лимит|бюджет/i);
  } finally {
    await f.close();
  }
});
