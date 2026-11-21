import { indexResponse } from './semantic-index-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, finish, fixture } from './fixtures.ts';
import { rawComment, rawVideo } from './tiktok-fixtures.ts';
import { TikTokRequestError, type TikTokTransport } from '../tiktok/native-host.ts';
import { TikTokReadBacklog } from '../tiktok/read-backlog.ts';
import { NativeTikTokSource } from '../tiktok/native-source.ts';
import { createApplication } from '../index.ts';

const otherVideo = String(BigInt(rawVideo.id) - 1n);

class Transport implements TikTokTransport {
  calls: string[] = [];
  blocked = false;
  replies = false;
  retryAt?: string;
  get(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    this.calls.push(path);
    if (path.includes('/user/detail'))
      return Promise.resolve({
        userInfo: {
          user: { id: '9000000000000000001', uniqueId: 'fixture_user', secUid: 'fixture-sec' },
        },
      });
    if (path.includes('/user/posts'))
      return Promise.resolve({
        itemList: [rawVideo, { ...rawVideo, id: otherVideo }],
        hasMore: false,
      });
    const videoId = /\/video\/(\d+)\//.exec(path)![1];
    const next = path.endsWith('cursor=2');
    const reply = path.includes('/replies');
    if (this.blocked && videoId === rawVideo.id && (this.replies ? reply : next))
      throw this.retryAt
        ? new TikTokRequestError(429, 'TIKTOK_BLOCKED', 'Ожидание', 429, this.retryAt)
        : new TikTokRequestError(503, 'TIKTOK_UNAVAILABLE', 'Страница временно недоступна', 503);
    const id = String(BigInt(videoId) + (reply ? 55n : next ? 100n : 10n));
    return Promise.resolve({
      comments: [
        {
          ...rawComment(id),
          aweme_id: videoId,
          reply_comment_total: !next && !reply && this.replies ? 1 : 0,
        },
      ],
      has_more: !this.replies && !next ? 1 : 0,
      cursor: next ? 4 : 2,
      total: 1,
      status_code: 0,
    });
  }
  async close() {}
}

async function setup(transport: Transport, retryDelay = 120_000) {
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: transport,
    tiktokRetryDelaysMs: [retryDelay],
  });
  await f.request('/connections');
  assert.equal(
    (await f.request('/tiktok/connect', 'POST', { handle: 'fixture_user' })).status,
    200,
  );
  for (let i = 0; i < 100 && f.app.tiktok.busy; i++) await delay(5);
  const config = configuration();
  config.sources = [];
  config.platforms.tiktok.replies = transport.replies;
  const start = async (id: string) => {
    assert.equal(
      (await f.request('/collection/runs', 'POST', { id, mode: 'tiktok', configuration: config }))
        .status,
      202,
    );
  };
  const run = async (id: string) => {
    await start(id);
    return finish(f.app, id);
  };
  return { f, run, start, config };
}

test('full cycle keeps the cursor and analyzes the available sample when the platform wait exceeds five minutes', async (t) => {
  const fetchLocal = globalThis.fetch;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return fetchLocal(url, init);
    calls++;
    return Promise.resolve(Response.json({status: 'completed', usage: {input_tokens: 20, output_tokens: 4},
      output: [{type: 'message', content: [{type: 'output_text', text: indexResponse([])}]}]}));
  });
  const transport = new Transport();
  const { f, config } = await setup(transport);
  try {
    f.app.store.setSecret('openai-api-key', 'fixture');
    transport.blocked = true;
    transport.retryAt = new Date(Date.now() + 600_000).toISOString();
    const id = 'bounded-sample-for-ai';
    const response = await f.request('/collection/runs', 'POST', {id, mode: 'cycle', configuration: config});
    assert.equal(response.status, 202);
    const result = await finish(f.app, id);
    assert.equal(result.status, 'completed', result.error);
    const [source, progress] = Object.entries(result.sources!)[0];
    assert.equal(progress.status, 'limited');
    assert.equal(progress.stopCode, 'TIKTOK_SAMPLE_PAUSED');
    assert.ok(result.counts.comments > 0);
    assert.ok(new TikTokReadBacklog(f.app.store.db).roots(source).length);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('a fresh cycle uses matching saved discussions during a shared cooldown and bills only once', async (t) => {
  const transport = new Transport();
  const fetchLocal = globalThis.fetch;
  let calls = 0;
  let expectedCount = 0;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return fetchLocal(url, init);
    calls++;
    const rows = JSON.parse(JSON.parse(String(init?.body)).input) as {id: string; text: string}[];
    assert.equal(rows.length, expectedCount);
    const ideas = [{ title: 'Подтверждённая тема', angle: 'План', evidence: rows.map(r => r.id) }];
    return Response.json({status: 'completed', usage: {input_tokens: 20, output_tokens: 4},
      output: [{type: 'message', content: [{type: 'output_text', text: indexResponse(ideas)}]}]});
  });
  const { f, config, run } = await setup(transport);
  try {
    const first = await run('collected-before-cooldown');
    const sourceId = Object.keys(first.sources!)[0];
    const saved = f.app.store.records(first.id).filter(r => r.kind === 'comment');
    assert.ok(saved.length > 1);
    const unrelated = [
      { sourceId: 'another-profile' }, { videoId: 'outside-selection' },
      { publishedAt: '2001-01-01T00:00:00Z' }, { parentId: 'excluded-reply' },
    ];
    unrelated.forEach((fields, i) => f.app.store.addRecord(first.id, {
      ...saved[0], ...fields, id: 'excluded-' + i, text: 'excluded',
    }));
    const backlog = new TikTokReadBacklog(f.app.store.db);
    backlog.rememberCooldown(sourceId, '*', Date.now() + 600_000);
    const requests = transport.calls.length;
    expectedCount = saved.length;
    f.app.store.setSecret('openai-api-key', 'fixture');
    for (const mode of ['cycle', 'tiktok']) {
      const id = 'shared-cooldown-' + mode;
      assert.equal((await f.request('/collection/runs', 'POST', {id, mode, configuration: config})).status, 202);
      const result = await finish(f.app, id);
      assert.equal(result.status, 'completed', result.error);
      assert.deepEqual(f.app.store.records(id).filter(r => r.kind === 'comment').map(r => r.id).sort(), mode === 'cycle' ? saved.map(r => r.id).sort() : []);
      assert.equal(result.counts.ideas, mode === 'cycle' ? 1 : 0);
      assert.equal(result.sources![sourceId].status, 'limited');
      assert.deepEqual(result.aiUsage, mode === 'cycle' ? {input:20, output:4} : undefined);
    }
    assert.equal(transport.calls.length, requests);
    assert.equal(calls, 1);
    assert.equal((await f.request('/collection/ai-materials')).data.ideas.length, 1);
    config.platforms.tiktok.minLikes = 10000;
    const filteredId = 'shared-cooldown-no-matching-sample';
    assert.equal((await f.request('/collection/runs', 'POST', {id: filteredId, mode: 'cycle', configuration: config})).status, 202);
    const filtered = await finish(f.app, filteredId);
    assert.equal(filtered.counts.comments, 0);
    assert.ok(filtered.skipped.includes('ideas') && !filtered.done.includes('materials'));
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('a completed sample stays idle after restart and the next press resumes the cursor with disjoint AI inputs', async t => {
  const normal = globalThis.fetch;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return normal(url,init);
    calls++;
    return Response.json({status:'completed',usage:{input_tokens:20,output_tokens:4},
      output:[{type:'message',content:[{type:'output_text',text:indexResponse([])}]}]});
  });
  const transport = new Transport();
  const {f,config} = await setup(transport,10);
  let active = f.app;
  try {
    active.store.setSecret('openai-api-key','fixture');
    transport.blocked = true;
    transport.retryAt = new Date(Date.now()+2000).toISOString();
    const id = 'continue-source-after-restart';
    await f.request('/collection/runs','POST',{id, mode:'tiktok',configuration:config});
    const sample = await finish(active,id);
    assert.equal(sample.followUp?.state,'manual');
    assert.equal(calls,1);
    await active.close();
    transport.blocked = false;
    const before = transport.calls.length;
    active = createApplication({directory:f.directory, requestInterval:0,tiktokTransport:'native',tiktokNativeTransport:transport});
    await new Promise<void>(resolve=>active.server.listen(0,'127.0.0.1',resolve));
    active.store.db.prepare('UPDATE tiktok_cooldowns SET until_ms=0').run();
    await delay(5100);
    assert.equal(transport.calls.length, before);
    assert.equal(active.store.run(id)!.status,'completed');
    const next = 'next-press-continues';
    const address = active.server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    const session = await fetch(base+'/connections');
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    const {csrfToken} = await session.json();
    const response = await fetch(base+'/collection/runs',{
      method:'POST',headers:{'Content-Type':'application/json',cookie,'x-csrf-token':csrfToken},body:JSON.stringify({id:next,mode:'tiktok',configuration:config})});
    assert.equal(response.status,202);
    const final = await finish(active,next);
    assert.equal(final.status,'completed',final.error);
    assert.equal(calls,2);
    const ids = (runId: string) => active.store.records(runId).filter(r => r.kind==='comment').map(r=>r.id);
    const firstIds = ids(id), secondIds = ids(next);
    assert.equal(firstIds.length+secondIds.length,4);
    assert.equal(new Set([...firstIds,...secondIds]).size,4);
    assert.ok(!transport.calls.slice(before).some(p=>p.includes('/user/')));
    assert.ok(transport.calls.slice(before).some(p=>p.includes('cursor=2')));
    assert.ok(!transport.calls.slice(before).some(p=>p.includes(rawVideo.id) && p.endsWith('cursor=0')));
  } finally {await active.close(); await f.disposeDirectory();}
});

test('an empty paused selection completes without AI and the next click analyzes the recovered pages', async t => {
  const transport = new Transport();
  const local = globalThis.fetch;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return local(url, init);
    requests++;
    const rows = JSON.parse(JSON.parse(String(init?.body)).input) as {id:string; text:string}[];
    assert.ok(rows.length >= 2);
    const ideas = [{title:'Вопрос из двух веток',angle:'Разбор',evidence:rows.map(r=>r.id)}];
    return Response.json({status:'completed', usage:{input_tokens:20,output_tokens:5},
      output:[{type:'message',content:[{type:'output_text',text:indexResponse(ideas)}]}]});
  });
  const {f,config} = await setup(transport);
  try {
    const id = 'cold-start-recovery';
    const source = f.app.tiktok.source()!.id;
    new TikTokReadBacklog(f.app.store.db).rememberCooldown(source,'*',Date.now()+600_000);
    f.app.store.setSecret('openai-api-key','fixture');
    await f.request('/collection/runs','POST',{id,mode:'tiktok',configuration:config});
    const waiting = await finish(f.app,id);
    assert.equal(waiting.counts.comments,0);
    assert.equal(requests,0);
    assert.equal(waiting.followUp?.state,'manual');
    assert.equal(waiting.status,'completed');
    f.app.store.db.prepare('UPDATE tiktok_cooldowns SET until_ms=0 WHERE source_id=?').run(source);
    const next = 'cold-start-next-press';
    await f.request('/collection/runs','POST',{id:next,mode:'tiktok',configuration:config});
    const ready = await finish(f.app,next);
    assert.equal(ready.status,'completed',ready.error);
    assert.equal(requests,1);
    assert.equal(ready.counts.ideas,1);
    assert.equal((await f.request('/collection/ai-materials')).data.ideas.length,1);
    assert.deepEqual(Object.values(ready.sources!)[0].videos,{processed:2,selected:2});
  } finally {await f.close();}
});

test('an empty page parks only its video and larger pages preserve the remaining comment limit', async () => {
  const times: { path: string; at: number }[] = [];
  let failed = false;
  const transport = new class extends Transport {
    readonly maxCommentPageSize = 50;
    override get(path: string, signal: AbortSignal) {
      times.push({ path, at: Date.now() });
      if (!failed && path.includes('/video/' + rawVideo.id + '/comments?')) {
        failed = true;
        throw new TikTokRequestError(429, 'TIKTOK_BLOCKED', 'Empty response', 200, undefined, 'empty');
      }
      return super.get(path, signal);
    }
  }();
  const { f, run } = await setup(transport, 350);
  try {
    const result = await run('isolated-empty-page');
    assert.equal(result.status, 'completed');
    const calls = times.filter(call => call.path.includes('/comments?'));
    assert.match(calls[0].path, /count=50&cursor=0/);
    const retry = calls.filter(call => call.path === calls[0].path).at(-1)!;
    const other = calls.find(call => call.path.includes(otherVideo))!;
    assert.ok(other.at < retry.at);
    assert.ok(retry.at - calls[0].at >= 345);
    assert.equal(result.counts.comments, 4);
  } finally {
    await f.close();
  }
});

test('an interrupted page continues in the same manual cycle after a long pause and server restart', async (t) => {
  const transport = new Transport();
  const { f, start } = await setup(transport);
  const id = 'long-running-profile';
  let restored: ReturnType<typeof createApplication> | undefined;
  try {
    transport.blocked = true;
    await start(id);
    let due = 0;
    for (let i = 0; i < 100; i++) {
      const run = f.app.store.run(id)!;
      if (run.status !== 'running') assert.fail('A temporary failure ended the manual run');
      const retry = Object.values(run.sources!)[0]?.retry;
      if (retry) {
        due = Date.parse(retry.at);
        break;
      }
      await delay(5);
    }
    assert.ok(due > Date.now() + 90_000);
    const before = transport.calls.length;
    assert.ok(f.app.store.run(id)!.counts.comments > 0);
    await f.app.close();
    transport.blocked = false;
    const realNow = Date.now.bind(Date);
    t.mock.method(Date, 'now', () => realNow() + 121_000);
    restored = createApplication({
      directory: f.directory,
      tiktokTransport: 'native',
      tiktokNativeTransport: transport,
      tiktokRetryDelaysMs: [120_000],
      requestInterval: 0,
    });
    await new Promise<void>((resolve) => restored!.server.listen(0, '127.0.0.1', resolve));
    const finished = await finish(restored, id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.counts.comments, 4);
    assert.equal(restored.store.latest()!.id, id);
    assert.equal(restored.store.pendingTikTokJob(), null);
    assert.deepEqual(Object.values(finished.sources!)[0].videos, { selected: 2, processed: 2 });
    assert.equal(transport.calls.length - before, 1);
    assert.ok(transport.calls.at(-1)!.endsWith('cursor=2'));
  } finally {
    if (restored) {
      await restored.close();
      await f.disposeDirectory();
    } else await f.close();
  }
});

test('persistent temporary failures stop automatically with pending roots and a verified partial result', async () => {
  const transport = new Transport();
  const { f, run } = await setup(transport, 5);
  try {
    transport.blocked = true;
    const result = await run('repeated-root-outage');
    const [[source, progress]] = Object.entries(result.sources!);
    assert.equal(result.status, 'partial');
    assert.equal(progress.stopCode, 'TIKTOK_RETRY_EXHAUSTED');
    assert.equal(result.counts.comments, 3);
    assert.deepEqual(progress.videos, { selected: 2, processed: 1 });
    assert.equal(new TikTokReadBacklog(f.app.store.db).roots(source)[0].cursor, '2');
    const calls = transport.calls.filter((p) => p.includes(rawVideo.id) && p.endsWith('cursor=2'));
    assert.ok(calls.length >= 6 && calls.length <= 7);
    assert.equal((await f.request('/collection/latest')).data.run.canResumeTikTok, true);
    assert.equal(f.app.store.pendingTikTokJob(), null);
    transport.blocked = false;
    transport.calls = [];
    const resumeUrl = '/collection/runs/' + result.id + '/resume';
    assert.equal((await f.request(resumeUrl, 'POST', {})).status, 202);
    const resumed = await finish(f.app, result.id);
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.counts.comments, 4);
    assert.equal(resumed.startedAt, result.startedAt);
    assert.deepEqual(transport.calls, [calls[0]]);
    assert.equal((await f.request('/collection/latest')).data.run.canResumeTikTok, undefined);
    assert.equal((await f.request(resumeUrl, 'POST', {})).status, 202);
    assert.equal(transport.calls.length, 1);
  } finally {
    await f.close();
  }
});

test('a replay below the previously displayed totals still publishes its real retry time', async () => {
  const transport = new Transport();
  const { f, start } = await setup(transport);
  const id = 'resuming-saved-progress';
  try {
    transport.blocked = true;
    await start(id);
    const sourceId = f.app.tiktok.source()!.id;
    for (let i = 0; i < 100 && !f.app.store.run(id)?.sources?.[sourceId]?.retry; i++)
      await delay(5);
    await f.app.engine.close();
    const run = f.app.store.run(id)!;
    const progress = run.sources![sourceId];
    const due = progress.retry!.at;
    // A later saved response from a previous pass already contributed to this
    // total, but replay meets an earlier unresolved page first.
    progress.receivedComments = (progress.receivedComments ?? 0) + 1;
    progress.status = 'limited';
    progress.reason = 'Данные получены частично.';
    progress.stopCode = 'TIKTOK_DEFERRED';
    delete progress.retry;
    f.app.store.saveRun(run, false);
    const calls = transport.calls.length;
    f.app.engine.resumePending();
    for (let i = 0; i < 100 && !f.app.store.run(id)?.sources?.[sourceId]?.retry; i++)
      await delay(5);
    const resumed = f.app.store.run(id)!.sources![sourceId];
    assert.equal(resumed.status, 'reading');
    assert.equal(resumed.retry?.at, due);
    assert.equal(resumed.receivedComments, progress.receivedComments);
    assert.equal(resumed.stopCode, undefined);
    assert.equal(transport.calls.length, calls);
  } finally {
    await f.close();
  }
});

test('a pause beyond the automatic recovery horizon carries the exact root cursor into the next ordinary run and lets other videos finish', async () => {
  const transport = new Transport();
  const { f, run } = await setup(transport, 25 * 3_600_000);
  try {
    transport.blocked = true;
    const first = await run('deferred-root-first');
    const [[source, progress]] = Object.entries(first.sources!);
    assert.equal(progress.stopCode, 'TIKTOK_RETRY_TOO_LATE');
    assert.equal(first.counts.comments, 3);
    assert.equal(first.status, 'partial');
    const backlog = new TikTokReadBacklog(f.app.store.db);
    assert.deepEqual(
      backlog.roots(source).map(({ video, cursor }) => [video.id, cursor]),
      [[rawVideo.id, '2']],
    );
    assert.ok(
      transport.calls.some((path) => path.includes(otherVideo) && path.endsWith('cursor=2')),
    );
    // Simulate reaching the allowed retry time.
    f.app.store.db.prepare('UPDATE tiktok_cooldowns SET until_ms=0 WHERE source_id=?').run(source);
    transport.blocked = false;
    transport.calls = [];
    const second = await run('deferred-root-second');
    assert.equal(second.status, 'completed');
    assert.deepEqual(backlog.roots(source), []);
    const failedVideoCalls = transport.calls.filter((path) =>
      path.includes('/video/' + rawVideo.id + '/'),
    );
    assert.equal(failedVideoCalls.length, 1);
    assert.ok(failedVideoCalls[0].endsWith('cursor=2'));
  } finally {
    await f.close();
  }
});

test('long Retry-After covers the whole profile across manual launches without sleeping or contacting TikTok again', async () => {
  const transport = new Transport();
  const { f, run } = await setup(transport);
  try {
    transport.retryAt = new Date(Date.now() + 25 * 3_600_000).toISOString();
    transport.blocked = true;
    const first = await run('source-cooldown-first');
    assert.equal(first.status, 'partial');
    const source = Object.keys(first.sources!)[0];
    const backlog = new TikTokReadBacklog(f.app.store.db);
    assert.equal(backlog.cooldown(source, '/unrelated'), Date.parse(transport.retryAt));
    transport.calls = [];
    const second = await run('source-cooldown-again');
    assert.deepEqual(transport.calls, []);
    assert.equal(Object.values(second.sources!)[0].stopCode, 'TIKTOK_RETRY_TOO_LATE');
    assert.notEqual(second.status, 'completed');
    assert.ok(backlog.roots(source).length > 0);
  } finally {
    await f.close();
  }
});

test('an unavailable reply leaves a ready batch of root comments and the branch resumes on a regular launch', async () => {
  const transport = new Transport();
  transport.replies = true;
  const { f, run } = await setup(transport);
  try {
    transport.blocked = true;
    const first = await run('deferred-reply-first');
    const [[source, progress]] = Object.entries(first.sources!);
    assert.equal(first.status, 'completed');
    assert.equal(progress.stopCode, 'TIKTOK_DEFERRED_REPLIES');
    assert.equal(f.app.store.pendingThreadCount(source), 1);
    f.app.store.db.prepare('UPDATE tiktok_cooldowns SET until_ms=0 WHERE source_id=?').run(source);
    transport.blocked = false;
    const second = await run('deferred-reply-second');
    assert.equal(second.status, 'completed');
    assert.equal(f.app.store.pendingThreadCount(source), 0);
    assert.ok(f.app.store.records(second.id).some((row) => row.kind === 'comment' && row.parentId));
  } finally {
    await f.close();
  }
});

test('a resumed run with an almost spent waiting allowance defers even a short extra cooldown', async () => {
  const transport = new Transport();
  const { f } = await setup(transport);
  try {
    const source = f.app.tiktok.source()!;
    const reader = new NativeTikTokSource(f.app.store, transport, [500]);
    const entries = new Map<string, unknown>([['retry-wait', { used: 89_990, reservedUntil: 0 }]]);
    transport.blocked = true;
    transport.calls = [];
    let reason: string | undefined;
    await reader.read(source, {
      signal: new AbortController().signal,
      tiktokCollectionVersion: 2,
      maxVideos: 2,
      maxComments: 100,
      comments: true,
      replies: false,
      since: '2020-01-01T00:00:00Z',
      beforeRequest: async () => {},
      journal: {
        get<T>(key: string) {
          return entries.get(key) as T | undefined;
        },
        put(key, value) {
          entries.set(key, structuredClone(value));
        },
      },
      onVideo() {},
      onComment() {},
      onProgress(value) {
        reason = value.stopCode;
      },
    });
    assert.equal(reason, 'TIKTOK_DEFERRED');
    assert.equal(
      transport.calls.filter(
        (path) => path.includes('/' + rawVideo.id + '/') && path.endsWith('cursor=2'),
      ).length,
      1,
    );
    assert.equal(new TikTokReadBacklog(f.app.store.db).roots(source.id)[0].cursor, '2');
  } finally {
    await f.close();
  }
});

test('the collection deadline interrupts an in-flight page and preserves its cursor', async () => {
  let stalled = false;
  const transport = new class extends Transport {
    override async get(path: string, signal: AbortSignal) {
      if (path.includes('/comments?') && path.endsWith('cursor=2')) {
        stalled = true;
        await delay(10_000, undefined, {signal});
      }
      return super.get(path, signal);
    }
  }();
  const {f} = await setup(transport);
  try {
    const source = f.app.tiktok.source()!;
    const reader = new NativeTikTokSource(f.app.store, transport);
    let reason: string | undefined;
    const started = Date.now();
    await reader.read(source, {
      signal: new AbortController().signal, tiktokCollectionVersion:3, collectUntil:started+250,
      maxVideos:2, maxComments:100, comments:true, replies:false, since:'2020-01-01T00:00:00Z',
      beforeRequest:async()=>{}, onVideo(){}, onComment(){}, onProgress:p=>{reason=p.stopCode;},
    });
    assert.ok(stalled);
    assert.equal(reason,'TIKTOK_SAMPLE_TIME');
    assert.ok(Date.now()-started < 3000);
    assert.ok(new TikTokReadBacklog(f.app.store.db).roots(source.id).some(r=>r.cursor==='2'));
  } finally {await f.close();}
});

test('a pause in the replies resumes the thread without fetching root pages or billing old comments', async t => {
  const normal = globalThis.fetch;
  const batches: number[] = [];
  t.mock.method(globalThis,'fetch', async (url: Parameters<typeof fetch>[0],init?:RequestInit) => {
    if (String(url)!=='https://api.openai.com/v1/responses') return normal(url,init);
    batches.push(JSON.parse(JSON.parse(String(init?.body)).input).length);
    return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:2},
      output:[{type:'message',content:[{type:'output_text',text:indexResponse([])}]}]});
  });
  const transport = new Transport();
  transport.replies = true;
  const {f,run} = await setup(transport);
  try {
    f.app.store.setSecret('openai-api-key','fixture');
    transport.blocked = true;
    transport.retryAt = new Date(Date.now()+60_000).toISOString();
    const first = await run('manual-reply-pause');
    assert.equal(first.followUp?.state,'manual');
    assert.equal(first.counts.comments,2);
    const calls = transport.calls.length;
    transport.blocked = false;
    f.app.store.db.prepare('UPDATE tiktok_cooldowns SET until_ms=0').run();
    const second = await run('reply-continue');
    assert.equal(second.status,'completed',second.error);
    assert.equal(second.counts.comments,2);
    assert.deepEqual(batches,[2,2]);
    assert.ok(transport.calls.slice(calls).every(p=>p.includes('/replies?')));
  } finally {await f.close();}
});

test('the next click advances a root when the per-run comment limit ends the page', async t => {
  const normal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return normal(url,init);
    return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:2},
      output:[{type:'message',content:[{type:'output_text',text:indexResponse([])}]}]});
  });
  const transport = new Transport();
  const {f,config,run} = await setup(transport);
  try {
    config.runLimits.maxComments = 1;
    f.app.store.setSecret('openai-api-key','fixture');
    const first = await run('first-single-comment');
    assert.equal(first.counts.comments,1);
    assert.equal(first.followUp?.state,'manual');
    const before = transport.calls.length;
    const second = await run('second-single-comment');
    assert.equal(second.counts.comments,1);
    assert.ok(transport.calls.slice(before).some(p=>p.endsWith('cursor=2')));
    const comment = (id:string) => f.app.store.records(id).find(r => r.kind==='comment')!.id;
    assert.notEqual(comment(first.id),comment(second.id));
  } finally {await f.close();}
});

test('a blocked video does not take the first read of every button press', async t => {
  const transport = new Transport();
    const local = globalThis.fetch;
    t.mock.method(globalThis,'fetch',(url: Parameters<typeof fetch>[0],init?: RequestInit) =>
      String(url).startsWith('https://api.openai.com/') ? Promise.resolve(Response.json({
        status:'completed',usage:{input_tokens:10,output_tokens:3},
        output:[{type:'message',content:[{type:'output_text',text:indexResponse([])}]}]
      })) : local(url,init));
  const {f,run} = await setup(transport,1);
  try {
    f.app.store.setSecret('openai-api-key','fixture');
    const normal = transport.get.bind(transport);
    const order:string[]=[];
    t.mock.method(transport,'get',async(path:string,signal:AbortSignal) => {
      if (path.includes('/comments')) {
        order.push(path);
        if (path.includes(rawVideo.id)) throw new TikTokRequestError(503,'TIKTOK_UNAVAILABLE','Пауза',503);
      }
      return normal(path,signal);
    });
    const first = await run('fair-pass-first');
    assert.equal(first.status,'completed',first.error);
    assert.ok(order[0].includes(rawVideo.id));
    order.length = 0;
    await delay(5);
    const next = await run('fair-pass-second');
    assert.equal(next.status,'completed',next.error);
    assert.ok(order[0].includes(otherVideo),order.join(', '));
    assert.ok(next.counts.comments>0);
  } finally {await f.close();}
});
