import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, configuration, finish } from './fixtures.ts';
import { createApplication } from '../index.ts';
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
    ) {
      this.calls.push(path);
      throw new TikTokRequestError(429, 'TIKTOK_BLOCKED', 'Отдача ограничена', 200);
    }
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

class CommentPages extends Transport {
  readonly stoppedVideo = String(BigInt(rawVideo.id) - 5n);
  readonly stoppedPage = `/tiktok/video/${this.stoppedVideo}/comments?count=20&cursor=2`;
  readonly attempts: number[] = [];
  retryAt?: string;

  constructor(
    private refusal = 429,
    private upstreamWait = 0,
    private temporaryFailures = 1,
  ) {
    super();
  }

  override async get(path: string, signal: AbortSignal) {
    if (path.startsWith('/tiktok/user/posts')) {
      const { itemList } = (await super.get(path, signal)) as { itemList: (typeof rawVideo)[] };
      return {
        itemList: Array.from({ length: 20 }, (_, index) => ({
          ...itemList[0],
          id: String(BigInt(rawVideo.id) - BigInt(index)),
          createTime: itemList[0].createTime - index,
          statsV2: { ...rawVideo.statsV2, commentCount: '2' },
        })),
        hasMore: false,
      };
    }
    const match = /^\/tiktok\/video\/(\d+)\/comments\?/.exec(path);
    if (!match) return super.get(path, signal);
    signal.throwIfAborted();
    this.calls.push(path);
    if (path === this.stoppedPage) {
      this.attempts.push(Date.now());
      if (this.attempts.length <= this.temporaryFailures) {
        this.retryAt = this.upstreamWait
          ? new Date(this.attempts[0] + this.upstreamWait).toISOString()
          : undefined;
        throw new TikTokRequestError(
          this.refusal,
          'TIKTOK_BLOCKED',
          'Отдача ограничена',
          200,
          this.retryAt,
        );
      }
    }
    const videoId = match[1];
    const page = path.endsWith('cursor=0') ? 0 : 1;
    const index = BigInt(rawVideo.id) - BigInt(videoId);
    return {
      comments: [
        {
          ...rawComment(String(9200000000000000000n + index * 10n + BigInt(page))),
          aweme_id: videoId,
          create_time: Math.floor(Date.now() / 1000) - 60,
        },
      ],
      has_more: page === 0 ? 1 : 0,
      cursor: 2,
      status_code: 0,
    };
  }
}

async function startPagedRun(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  mode: 'cycle' | 'tiktok' = 'tiktok',
) {
  await connected(f);
  const config = configuration();
  config.sources = [];
  config.platforms.tiktok.replies = false;
  config.runLimits.maxComments = 500;
  config.runLimits.maxRequests = 100;
  const result = await f.request('/collection/runs', 'POST', {
    id,
    mode,
    configuration: config,
  });
  assert.equal(result.status, 202);
}

async function waitForTikTokPause(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let i = 0; i < 120; i++) {
    const run = f.app.store.run(id, false);
    const source = Object.values(run?.sources ?? {})[0];
    if (run?.status === 'running' && source?.retry) return { run, source };
    await delay(5);
  }
  assert.fail('The current run did not record its waiting state.');
}

test('a button-triggered TikTok run resumes the exact sixth-video page and completes all 20 videos', async () => {
  const transport = new CommentPages(429, 500);
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [10, 20, 40],
  });
  const id = 'native-recover-all-pages';
  try {
    await startPagedRun(f, id);
    const { run: waiting, source } = await waitForTikTokPause(f, id);
    assert.equal(waiting.active, 'tiktok');
    assert.equal(waiting.counts.comments, 11);
    assert.ok(waiting.counts.ideas > 0);
    assert.equal(f.app.store.ideas(id).length, waiting.counts.ideas);
    assert.equal(waiting.steps.tiktok, 1);
    assert.deepEqual(source.videos, { selected: 20, processed: 5 });
    assert.deepEqual(source.retry, { at: transport.retryAt, attempt: 1 });
    assert.equal(source.failedRequest?.videoNumber, 6);
    assert.equal(transport.attempts.length, 1);

    const finished = await finish(f.app, id);
    const progress = Object.values(finished.sources!)[0];
    assert.equal(finished.status, 'completed');
    assert.equal(finished.counts.posts, 20);
    assert.equal(finished.counts.comments, 40);
    assert.equal(finished.counts.requests, 43);
    assert.deepEqual(progress.videos, { selected: 20, processed: 20 });
    assert.equal(progress.retry, undefined);
    assert.equal(progress.failedRequest, undefined);
    assert.equal(transport.attempts.length, 2);
    assert.ok(transport.attempts[1] >= Date.parse(transport.retryAt!));
    assert.equal(transport.calls.filter((path) => path.includes('/comments?')).length, 41);
    const replayed = transport.calls.indexOf(transport.stoppedPage);
    assert.ok(transport.calls[replayed + 1].includes(String(BigInt(rawVideo.id) - 6n)));
    assert.equal(transport.calls.at(-1), transport.stoppedPage);
    const records = f.app.store.records(id).filter((record) => record.kind === 'comment');
    assert.equal(new Set(records.map((record) => record.id)).size, 40);
  } finally {
    await f.close();
  }
});

test('cancelling while waiting keeps the collected comments and stops the pending retry', async () => {
  const transport = new CommentPages();
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [10_000],
  });
  const id = 'native-cancel-retry';
  try {
    await startPagedRun(f, id);
    await waitForTikTokPause(f, id);
    assert.equal((await f.request(`/collection/runs/${id}/cancel`, 'POST', {})).status, 200);
    const stopped = await finish(f.app, id);
    assert.equal(stopped.status, 'cancelled');
    assert.equal(stopped.counts.comments, 11);
    assert.equal(f.app.store.pendingTikTokJob(), null);
    assert.equal(Object.values(stopped.sources!)[0].retry, undefined);
    assert.equal(transport.attempts.length, 1);
  } finally {
    await f.close();
  }
});

test('a pre-queue run resumes its saved pause after upgrading and survives repeated throttles', async () => {
  const transport = new CommentPages(429, 180, 5);
  const options = {
    tiktokTransport: 'native' as const,
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [5, 10, 20],
  };
  const f = await fixture(options);
  const id = 'resume-manual-cycle';
  let restored: ReturnType<typeof createApplication> | undefined;
  try {
    await startPagedRun(f, id, 'cycle');
    const { source } = await waitForTikTokPause(f, id);
    const firstRetryAt = Date.parse(source.retry!.at);
    const before = transport.calls.length;
    // The previous release only stored the current failed page under 'retry'.
    const sourceId = Object.keys(f.app.store.run(id)!.sources!)[0];
    const journal = f.app.store.tikTokJournal(id, sourceId);
    const [legacy] = journal.get<unknown[]>('video-turns')!;
    journal.put('retry', legacy);
    f.app.store.db
      .prepare("DELETE FROM tiktok_pages WHERE run_id=? AND source_id=? AND page='video-turns'")
      .run(id, sourceId);
    await f.app.close();
    restored = createApplication({ ...options, directory: f.directory, requestInterval: 0 });
    await new Promise<void>((resolve) => restored!.server.listen(0, '127.0.0.1', resolve));
    const result = await finish(restored, id);
    assert.equal(result.status, 'completed');
    assert.deepEqual(Object.values(result.sources!)[0].videos, { selected: 20, processed: 20 });
    assert.equal(result.counts.comments, 40);
    assert.ok(result.counts.ideas > 0);
    assert.equal(restored.store.ideas(id).length, result.counts.ideas);
    assert.equal(Object.values(result.sources!)[0].comments, 40);
    assert.equal(result.counts.requests, 47);
    assert.equal(transport.attempts.length, 6);
    assert.equal(restored.store.pendingTikTokJob(), null);
    assert.equal(restored.store.db.prepare('SELECT COUNT(*) AS n FROM tiktok_pages').get()!.n, 0);
    assert.ok(transport.attempts[1] >= firstRetryAt);
    assert.ok(transport.calls[before].includes(String(BigInt(rawVideo.id) - 6n)));
    assert.equal(transport.calls.filter((p) => p.includes('/comments?')).length, 45);
    assert.ok(
      ['collector', 'ideas', 'materials', 'orchestrator'].every((stage) =>
        result.done.includes(stage),
      ),
    );
  } finally {
    await restored?.close();
    if (restored) await f.disposeDirectory();
    else await f.close();
  }
});

test('a temporary empty comment page is retried before moving on', async () => {
  const transport = new Transport();
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [300],
  });
  const id = 'native-recover-empty';
  try {
    transport.empty = true;
    await startPagedRun(f, id);
    const { source } = await waitForTikTokPause(f, id);
    assert.equal(source.failedRequest?.stage, 'comments');
    transport.empty = false;
    const run = await finish(f.app, id);
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.comments, 1);
    assert.equal(transport.calls.filter((path) => path.includes('/comments?')).length, 2);
  } finally {
    await f.close();
  }
});

test('two deferred videos retain queue order, page cursors and shared cooldown across restart', async () => {
  const second = String(BigInt(rawVideo.id) - 6n);
  const transport = new (class extends CommentPages {
    secondTries = 0;
    override async get(path: string, signal: AbortSignal) {
      if (
        path.includes(second + '/comments?') &&
        path.endsWith('cursor=2') &&
        this.secondTries++ === 0
      ) {
        this.calls.push(path);
        throw new TikTokRequestError(
          429,
          'TIKTOK_BLOCKED',
          'Пауза',
          200,
          new Date(Date.now() + 350).toISOString(),
        );
      }
      return super.get(path, signal);
    }
  })();
  const options = {
    tiktokTransport: 'native' as const,
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [10],
  };
  const f = await fixture(options);
  let restored: ReturnType<typeof createApplication> | undefined;
  try {
    const id = 'two-suspended-videos';
    await startPagedRun(f, id);
    let due = 0;
    for (let i = 0; i < 150; i++) {
      const s = Object.values(f.app.store.run(id)!.sources!)[0];
      if (s?.retry && s.deferredVideos?.length === 2) {
        due = Date.parse(s.retry.at);
        assert.deepEqual(s.deferredVideos, [6, 7]);
        break;
      }
      await delay(5);
    }
    assert.ok(due);
    const before = transport.calls.length;
    await f.app.close();
    restored = createApplication({ ...options, directory: f.directory, requestInterval: 0 });
    await new Promise<void>((resolve) => restored!.server.listen(0, '127.0.0.1', resolve));
    assert.equal(transport.calls.length, before);
    const finished = await finish(restored, id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.counts.comments, 40);
    assert.equal(finished.counts.requests, 44);
    assert.ok(transport.calls[before].includes(String(BigInt(rawVideo.id) - 7n)));
    assert.deepEqual(transport.calls.slice(-2), [
      transport.stoppedPage,
      transport.stoppedPage.replace(transport.stoppedVideo, second),
    ]);
  } finally {
    await restored?.close();
    if (restored) await f.disposeDirectory();
    else await f.close();
  }
});

test('a shared discussion outage probes saved pages and resumes the same legacy run', async () => {
  const seventh = String(BigInt(rawVideo.id) - 6n);
  const seventhPage = `/tiktok/video/${seventh}/comments?count=20&cursor=0`;
  const transport = new (class extends CommentPages {
    remainingFailures = 3;
    override async get(path: string, signal: AbortSignal) {
      if (this.remainingFailures && (path === this.stoppedPage || path === seventhPage)) {
        this.remainingFailures--;
        this.calls.push(path);
        throw new TikTokRequestError(429, 'TIKTOK_BLOCKED', 'Пауза', 200);
      }
      return super.get(path, signal);
    }
  })(429, 0, 0);
  const options = {
    tiktokTransport: 'native' as const,
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [10, 400, 10],
  };
  const f = await fixture(options);
  const id = 'shared-outage';
  let restored: ReturnType<typeof createApplication> | undefined;
  try {
    await startPagedRun(f, id, 'cycle');
    let nextAttempt = 0;
    for (let i = 0; i < 150; i++) {
      const source = Object.values(f.app.store.run(id)!.sources!)[0];
      if (source?.retry?.scope === 'discussions') {
        nextAttempt = Date.parse(source.retry.at);
        assert.deepEqual(source.deferredVideos, [6, 7]);
        assert.equal(source.comments, 11);
        break;
      }
      await delay(5);
    }
    assert.ok(nextAttempt);
    const sourceId = Object.keys(f.app.store.run(id)!.sources!)[0];
    const journal = f.app.store.tikTokJournal(id, sourceId);
    const rotations = journal.get<{ probeVideos?: number[] }[]>('video-turns')!;
    assert.equal(rotations.length, 2);
    // The live installation already has an unfinished run from before shared probes.
    delete rotations[1].probeVideos;
    journal.put('video-turns', rotations);
    const before = transport.calls.length;
    await f.app.close();
    restored = createApplication({ ...options, directory: f.directory, requestInterval: 0 });
    await new Promise<void>((resolve) => restored!.server.listen(0, '127.0.0.1', resolve));
    assert.equal(transport.calls.length, before);
    assert.equal(Object.values(restored.store.run(id)!.sources!)[0].comments, 11);
    const result = await finish(restored, id);
    assert.deepEqual(transport.calls.slice(before, before + 2), [
      transport.stoppedPage,
      seventhPage,
    ]);
    assert.equal(result.status, 'completed');
    assert.deepEqual(Object.values(result.sources!)[0].videos, { selected: 20, processed: 20 });
    assert.equal(result.counts.comments, 40);
    assert.equal(result.counts.requests, 45);
  } finally {
    await restored?.close();
    if (restored) await f.disposeDirectory();
    else await f.close();
  }
});

test('TikTok validation keeps the previous result and makes no data requests', async () => {
  const transport = new Transport();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  const id = 'native-valid-run';
  try {
    await startPagedRun(f, id);
    assert.equal((await finish(f.app, id)).status, 'completed');
    const before = transport.calls.length;
    const config = configuration();
    config.sources = [];
    config.runLimits.maxRequests = 0;
    for (const mode of ['tiktok', 'cycle']) {
      const result = await f.request('/collection/runs', 'POST', {
        id: `native-invalid-${mode}`,
        mode,
        configuration: config,
      });
      assert.equal(result.status, 400);
      assert.equal(result.data.error.code, 'PLAN_BLOCKED');
      assert.equal(f.app.store.latest(false)?.id, id);
      assert.equal(transport.calls.length, before);
    }
  } finally {
    await f.close();
  }
});

test('a TikTok access block stops without retrying and preserves the partial result', async () => {
  const transport = new CommentPages(403);
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [1, 3],
  });
  const id = 'native-stop-access-block';
  try {
    await startPagedRun(f, id);
    const stopped = await finish(f.app, id);
    assert.equal(stopped.status, 'partial');
    assert.equal(stopped.counts.comments, 11);
    assert.equal(Object.values(stopped.sources!)[0].retry, undefined);
    assert.equal(transport.attempts.length, 1);
  } finally {
    await f.close();
  }
});

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
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [1],
  });
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
    assert.equal(transport.calls.filter((path) => path.includes('/comments?')).length, 2);
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

test('a persistently empty discussion does not prevent collection of later videos', async () => {
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const value = await super.get(path, signal);
      if (path.includes('/video/' + rawVideo.id + '/comments?'))
        return { comments: [], has_more: 0 };
      return value;
    }
  })();
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [1],
  });
  try {
    await startPagedRun(f, 'empty-first-video');
    const run = await finish(f.app, 'empty-first-video');
    const source = Object.values(run.sources!)[0];
    assert.equal(run.status, 'partial');
    assert.deepEqual(source.videos, { selected: 2, processed: 1 });
    assert.equal(run.counts.comments, 1);
    assert.equal(source.stopCode, 'TIKTOK_COMMENTS_EMPTY');
    assert.ok(run.done.includes('materials'));
  } finally {
    await f.close();
  }
});

test('complete inline replies save the separate request and incomplete threads are still paged', async () => {
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const result = await super.get(path, signal);
      if (!path.includes('/comments?')) return result;
      const { comments } = result as { comments: ReturnType<typeof rawComment>[] };
      const root = comments[0];
      const count = root.aweme_id === rawVideo.id ? 4 : 1;
      return {
        ...result,
        comments: [
          {
            ...root,
            reply_comment: Array.from({ length: count }, (_, i) => ({
              ...rawComment(String(BigInt(root.cid) + BigInt(i) + 8n), root.cid),
              aweme_id: root.aweme_id,
              create_time: root.create_time,
            })),
          },
        ],
      };
    }
  })();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    await f.app.engine.start('inline-replies-check', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'inline-replies-check');
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.comments, 10);
    assert.deepEqual(Object.values(run.sources!)[0].inlineReplies, { threads: 2, comments: 5 });
    assert.equal(transport.calls.filter((path) => path.includes('/replies?')).length, 2);
    assert.equal(
      transport.calls.some((path) => path.includes(rawVideo.id) && path.includes('/replies?')),
      false,
    );
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

test('the configured request limit bounds persistent throttling on a reply and keeps the exact stop position', async () => {
  const transport = new MultipleVideos();
  const videoId = String(BigInt(rawVideo.id) - 1n);
  transport.blockedVideo = videoId;
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [1, 3],
  });
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    config.runLimits.maxRequests = 9;
    await f.app.engine.start('native-upstream-stop', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'native-upstream-stop');
    const progress = Object.values(run.sources!)[0];
    assert.equal(run.status, 'partial');
    assert.equal(run.counts.posts, 2);
    assert.equal(run.counts.comments, 6);
    assert.deepEqual(progress.videos, { selected: 2, processed: 2 });
    assert.deepEqual(progress.failedRequest, {
      stage: 'replies',
      videoId,
      videoNumber: 2,
      upstreamStatus: 200,
    });
    assert.equal(progress.stopCode, 'REQUEST_BUDGET');
    assert.equal(run.counts.requests, 9);
    assert.equal(progress.retry, undefined);
    const report = await f.request(`/collection/runs/${run.id}/export.md`);
    assert.match(report.data, /REQUEST_BUDGET · replies · ролик 2 · HTTP 200/);
    assert.equal(
      transport.calls.filter(
        (path) => path.includes('/video/' + videoId + '/') && path.includes('/replies'),
      ).length,
      3,
    );
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

test('manual continuation survives a restart and requests only the missing reply pages', async () => {
  let available = false;
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const page = await super.get(path, signal);
      if (path.endsWith('/replies?cursor=2') && !available) return { ...page, comments: [] };
      return page;
    }
  })();
  const options = { tiktokTransport: 'native' as const, tiktokNativeTransport: transport };
  const f = await fixture(options);
  let reopened: ReturnType<typeof createApplication> | undefined;
  try {
    await connected(f);
    const config = configuration();
    config.sources = [];
    const first = 'first-pass-replies';
    await f.request('/collection/runs', 'POST', {
      mode: 'tiktok',
      id: first,
      configuration: config,
    });
    const original = await finish(f.app, first);
    assert.equal(original.counts.comments, 6);
    assert.equal((await f.request('/collection/latest')).data.pendingTikTokThreads, 2);
    const resume = {
      mode: 'tiktok',
      threadsOnly: true,
      id: 'still-missing-replies',
      configuration: config,
    };
    transport.calls.length = 0;
    assert.equal((await f.request('/collection/runs', 'POST', resume)).status, 202);
    const attempt = await finish(f.app, resume.id);
    assert.equal(attempt.status, 'partial');
    assert.equal(attempt.counts.comments, 0);
    assert.deepEqual(Object.values(attempt.sources!)[0].threads, { selected: 2, completed: 0 });
    assert.equal(transport.calls.length, 2);
    assert.ok(transport.calls.every((path) => path.endsWith('/replies?cursor=2')));
    await f.app.close();
    available = true;
    reopened = createApplication({ ...options, requestInterval: 0, directory: f.directory });
    const source = Object.keys(original.sources!)[0];
    assert.equal(reopened.store.pendingThreadCount(source), 2);
    assert.equal(reopened.store.pendingThreadCount('another-profile'), 0);
    const restored = reopened.tiktok.configuration(config);
    const id = 'recovered-replies';
    transport.calls.length = 0;
    await reopened.engine.start(id, 'tiktok', restored, true);
    const result = await finish(reopened, id);
    assert.equal(result.status, 'completed');
    assert.equal(result.counts.comments, 4);
    assert.equal(result.counts.posts, 0);
    assert.deepEqual(Object.values(result.sources!)[0].threads, { selected: 2, completed: 2 });
    assert.equal(reopened.store.pendingThreadCount(source), 0);
    assert.deepEqual(reopened.store.run(first)!.counts, original.counts);
    assert.equal((await reopened.engine.start(id, 'tiktok', restored, true)).id, id);
    await assert.rejects(reopened.engine.start('empty-queue-check', 'tiktok', restored, true), {
      code: 'NO_PENDING_THREADS',
    });
    assert.equal(transport.calls.length, 2);
    assert.ok(transport.calls.every((path) => path.endsWith('/replies?cursor=2')));
  } finally {
    if (reopened) {
      await reopened.close();
      await f.disposeDirectory();
    } else await f.close();
  }
});

test('continuation with a limit halfway through a reply page keeps only unseen replies', async () => {
  const transport = new Transport();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    await f.request('/tiktok/selection', 'POST', { latest: 1, commentsPerVideo: 2, enabled: true });
    const config = f.app.tiktok.configuration(configuration());
    const request = (id: string, threadsOnly: boolean) =>
      f.app.engine.start(id, 'tiktok', config, threadsOnly);
    await request('initial-small-cap', false);
    const initial = await finish(f.app, 'initial-small-cap');
    assert.equal(initial.counts.comments, 2);
    const source = Object.keys(initial.sources!)[0];
    const task = f.app.store.pendingThreads(source)[0];
    assert.equal(task.cursor, '0');
    assert.equal(task.seen.length, 1);
    const ids = new Set(f.app.store.records(initial.id).map((row) => row.id));
    for (const [id, count] of [
      ['resume-small-1', 2],
      ['resume-small-2', 1],
    ] as const) {
      transport.calls.length = 0;
      await request(id, true);
      assert.equal((await finish(f.app, id)).counts.comments, count);
      assert.ok(transport.calls.every((path) => path.includes('/replies?')));
      for (const row of f.app.store.records(id)) {
        assert.ok(!ids.has(row.id));
        ids.add(row.id);
      }
    }
    assert.equal(f.app.store.pendingThreadCount(source), 0);
  } finally {
    await f.close();
  }
});

test('a full run reads the main pages of every recent video before spending requests on reply pages', async () => {
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const value = await super.get(path, signal);
      if (!path.includes('/comments?')) return value;
      const first = path.endsWith('cursor=0');
      const root = (value.comments as ReturnType<typeof rawComment>[])[0];
      const cid = first ? root.cid : String(BigInt(root.cid) + 1n);
      const inline = rawComment(String(BigInt(root.cid) + 8n), root.cid);
      return {
        ...value,
        comments: [
          {
            ...root,
            cid,
            reply_comment_total: first ? 4 : 0,
            reply_comment: first ? [{ ...inline, aweme_id: root.aweme_id }] : [],
          },
        ],
        has_more: first ? 1 : 0,
        cursor: first ? 1 : 0,
      };
    }
  })();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.runLimits.maxComments = 500;
    await f.app.engine.start('staged-root-pages', 'tiktok', f.app.tiktok.configuration(config));
    const run = await finish(f.app, 'staged-root-pages');
    const discussion = transport.calls.filter((path) => path.includes('/comments'));
    const roots = discussion.slice(0, 4);
    assert.ok(roots.every((path) => path.includes('/comments?')));
    assert.ok(roots[0].includes(rawVideo.id) && roots[0].endsWith('cursor=0'));
    assert.ok(roots[1].includes(String(BigInt(rawVideo.id) - 1n)) && roots[1].endsWith('cursor=0'));
    assert.ok(roots[2].endsWith('cursor=1') && roots[3].endsWith('cursor=1'));
    assert.ok(discussion.slice(4).every((path) => path.includes('/replies?')));
    assert.equal(run.status, 'completed');
    assert.equal(run.counts.comments, 12);
    assert.deepEqual(Object.values(run.sources!)[0].inlineReplies, { threads: 2, comments: 2 });
  } finally {
    await f.close();
  }
});

test('restarting during the reply phase reuses the saved root pages for all videos', async () => {
  const transport = new (class extends MultipleVideos {
    attempts = 0;
    override async get(path: string, signal: AbortSignal) {
      if (path.includes('/replies?') && this.attempts++ === 0) {
        this.calls.push(path);
        throw new TikTokRequestError(
          429,
          'TIKTOK_BLOCKED',
          'Пауза',
          429,
          new Date(Date.now() + 400).toISOString(),
        );
      }
      return super.get(path, signal);
    }
  })();
  const options = {
    tiktokTransport: 'native' as const,
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [20],
  };
  const f = await fixture(options);
  let restored: ReturnType<typeof createApplication> | undefined;
  try {
    await connected(f);
    const id = 'resume-staged-threads';
    const config = configuration();
    await f.app.engine.start(id, 'tiktok', f.app.tiktok.configuration(config));
    const { source } = await waitForTikTokPause(f, id);
    assert.deepEqual(source.videos, { selected: 2, processed: 2 });
    assert.equal(transport.calls.filter((p) => p.includes('/comments?')).length, 2);
    await f.app.close();
    const before = transport.calls.length;
    restored = createApplication({ ...options, directory: f.directory, requestInterval: 0 });
    await new Promise<void>((resolve) => restored!.server.listen(0, '127.0.0.1', resolve));
    const result = await finish(restored, id);
    assert.equal(result.status, 'completed');
    assert.equal(result.counts.comments, 10);
    assert.ok(transport.calls.slice(before).every((p) => p.includes('/replies?')));
    assert.equal(restored.store.pendingThreadCount(Object.keys(result.sources!)[0]), 0);
  } finally {
    if (restored) {
      await restored.close();
      await f.disposeDirectory();
    } else await f.close();
  }
});

test('a tight overall comment limit leaves room for primary comments from the second video', async () => {
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const value = await super.get(path, signal);
      if (!path.includes('/comments?')) return value;
      const count = Number(new URL(path, 'http://localhost').searchParams.get('count'));
      const root = (value.comments as ReturnType<typeof rawComment>[])[0];
      return {
        ...value,
        comments: Array.from({ length: count }, (_, i) => ({
          ...root,
          cid: String(BigInt(root.cid) + BigInt(i)),
          reply_comment_total: 1,
          reply_comment: [{ ...root, cid: String(BigInt(root.cid) + 8n + BigInt(i)) }],
        })),
      };
    }
  })();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.runLimits.maxComments = 3;
    await f.app.engine.start(
      'root-coverage-with-cap',
      'tiktok',
      f.app.tiktok.configuration(config),
    );
    const run = await finish(f.app, 'root-coverage-with-cap');
    const records = f.app.store.records(run.id).filter((r) => r.kind === 'comment');
    assert.equal(records.length, 3);
    assert.equal(new Set(records.map((r) => r.publicationId)).size, 2);
    assert.ok(records.every((r) => !r.parentId));
    assert.equal(transport.calls.filter((p) => p.includes('/replies?')).length, 0);
  } finally {
    await f.close();
  }
});

test('recovering a job written before the two-phase collector keeps the legacy request order', async () => {
  const transport = new MultipleVideos();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const id = 'legacy-unstaged-workshop';
    const config = f.app.tiktok.configuration(configuration());
    const now = new Date().toISOString();
    f.app.store.beginTikTokJob(
      {
        id,
        status: 'running',
        active: 'tiktok',
        startedAt: now,
        updatedAt: now,
        done: [],
        events: [],
        skipped: ['analytics', 'telegram'],
        ideas: [],
        steps: {},
        counts: { posts: 0, comments: 0, ideas: 0, requests: 0 },
      },
      { mode: 'tiktok', config, budget: { publications: 0, comments: 0 } },
    );
    f.app.engine.resumePending();
    const run = await finish(f.app, id);
    assert.equal(run.status, 'completed');
    const paths = transport.calls.filter((p) => p.includes('/comments'));
    assert.ok(paths[0].includes('/comments?') && paths[1].includes('/replies?'));
    assert.equal(run.counts.comments, 10);
  } finally {
    await f.close();
  }
});

test('the request ceiling checkpoints every unfinished primary cursor and subsequent clicks make progress', async () => {
  const transport = new (class extends MultipleVideos {
    override async get(path: string, signal: AbortSignal) {
      const page = await super.get(path, signal);
      if (!path.includes('/comments?')) return page;
      const firstPage = path.endsWith('cursor=0');
      const root = (page.comments as ReturnType<typeof rawComment>[])[0];
      return {
        ...page,
        has_more: firstPage ? 1 : 0,
        cursor: firstPage ? 1 : 0,
        comments: [
          {
            ...root,
            cid: firstPage ? root.cid : String(BigInt(root.cid) + 1n),
            reply_comment_total: 0,
          },
        ],
      };
    }
  })();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    const config = configuration();
    config.runLimits.maxRequests = 3; // Profile, recent list and just one primary page per click.
    const configured = f.app.tiktok.configuration(config);
    const first = rawVideo.id;
    const second = String(BigInt(first) - 1n);
    for (const [i, [video, cursor]] of [
      [first, '0'],
      [first, '1'],
      [second, '0'],
      [second, '1'],
    ].entries()) {
      const id = 'capped-primary-' + i;
      transport.calls.length = 0;
      await f.app.engine.start(id, 'tiktok', configured);
      const run = await finish(f.app, id);
      assert.equal(run.counts.requests, 3);
      assert.equal(Object.values(run.sources!)[0].stopCode, 'REQUEST_BUDGET');
      const roots = transport.calls.filter((path) => path.includes('/comments?'));
      assert.equal(roots.length, 1);
      assert.ok(
        roots[0].includes('/video/' + video + '/') && roots[0].endsWith('cursor=' + cursor),
      );
    }
  } finally {
    await f.close();
  }
});

test('old pending replies outside the recent selection consume only spare publication capacity', async () => {
  const transport = new MultipleVideos();
  const f = await fixture({ tiktokTransport: 'native', tiktokNativeTransport: transport });
  try {
    await connected(f);
    await f.request('/tiktok/selection', 'POST', {
      latest: 1,
      commentsPerVideo: 100,
      enabled: true,
    });
    const config = configuration();
    const source = f.app.tiktok.source()!;
    const oldId = String(BigInt(rawVideo.id) - 5n);
    f.app.store.saveThread(source.id, {
      video: {
        id: oldId,
        text: '',
        url: 'https://www.tiktok.com/@fixture_user/video/' + oldId,
        metrics: {},
        publishedAt: new Date().toISOString(),
      },
      rootId: '9000000000000000502',
      cursor: '2',
      seen: ['9000000000000000510', '9000000000000000511'],
      total: 4,
    });
    config.runLimits.maxPublications = 1;
    transport.calls.length = 0;
    await f.app.engine.start('no-extra-publications', 'tiktok', f.app.tiktok.configuration(config));
    await finish(f.app, 'no-extra-publications');
    assert.ok(transport.calls.every((p) => !p.includes(oldId)));
    assert.equal(f.app.store.pendingThreadCount(source.id), 1);
    config.runLimits.maxPublications = 2;
    transport.calls.length = 0;
    await f.app.engine.start(
      'spare-publication-slot',
      'tiktok',
      f.app.tiktok.configuration(config),
    );
    const result = await finish(f.app, 'spare-publication-slot');
    assert.equal(result.counts.posts, 1);
    assert.equal(Object.values(result.sources!)[0].backlogVideos, 1);
    assert.equal(f.app.store.pendingThreadCount(source.id), 0);
    assert.deepEqual(
      transport.calls.filter((p) => p.includes(oldId)),
      ['/tiktok/video/' + oldId + '/comments/9000000000000000502/replies?cursor=2'],
    );
    assert.ok(f.app.tiktok.state().videos.every((video) => video.id !== oldId));
  } finally {
    await f.close();
  }
});
