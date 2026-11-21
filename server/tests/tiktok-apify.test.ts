import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, fixture, finish } from './fixtures.ts';
import { rawComment, rawVideo, videoUrl, now } from './tiktok-fixtures.ts';
import { indexResponse } from './semantic-index-fixture.ts';
import { readApifyComments } from '../tiktok/apify-comments.ts';
import { parseVideo } from '../tiktok/parser.ts';
import type { ReadOptions } from '../tiktok/contracts.ts';

const run = { id: 'actor123', defaultDatasetId: 'dataset123', status: 'SUCCEEDED' };
const rows = ['9000000000000000001', '9000000000000000002', '9000000000000000003'].map(
  (cid, i) => ({
    videoWebUrl: videoUrl,
    cid,
    text: rawComment(cid).text,
    diggCount: 3,
    createTimeISO: new Date(now * 1000).toISOString(),
    ...(i === 2 && { repliesToId: '9000000000000000001' }),
  }),
);

test('collect ideas reads an Apify dataset, preserves reply evidence and only analyzes fresh IDs', async (t) => {
  const original = fetch;
  let analyses = 0;
  let starts = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.host === 'api.openai.com') {
        analyses++;
        const comments = JSON.parse(JSON.parse(String(init?.body)).input) as { id: string }[];
        assert.equal(comments.length, 3);
        return Response.json({
          status: 'completed',
          usage: { input_tokens: 100, input_tokens_details: {cached_tokens: 20}, output_tokens: 30 },
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: indexResponse([
                    {
                      title: 'Как найти причину нестабильных тестов',
                      angle: 'Разбор падений в CI',
                      evidence: comments.map((c) => c.id),
                    },
                  ]),
                },
              ],
            },
          ],
        });
      }
      if (url.host !== 'api.apify.com') return original(input, init);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture');
      if (url.pathname.includes('/acts/')) {
        starts++;
        assert.equal(init?.method, 'POST');
        assert.ok(Number(url.searchParams.get('maxTotalChargeUsd')) > 0);
        assert.deepEqual(JSON.parse(String(init?.body)).postURLs, [videoUrl]);
        return Response.json({ data: { ...run, status: 'RUNNING' } });
      }
      if (url.pathname.includes('/actor-runs/')) return Response.json({ data: run });
      assert.ok(url.pathname.includes('/datasets/dataset123/items'));
      return Response.json(url.searchParams.get('offset') === '0' ? [...rows, rows[0]] : []);
    },
  );
  const f = await fixture({
    tiktokTransport: 'native',
    tiktokNativeTransport: {
      async get(path) {
        if (path.startsWith('/tiktok/user/detail'))
          return {
            userInfo: {
              user: {
                id: '700123',
                uniqueId: 'fixture_user',
                nickname: 'Creator',
                secUid: 'profile',
              },
            },
          };
        assert.ok(path.startsWith('/tiktok/user/posts'), path);
        return { itemList: [{ ...rawVideo, statsV2: { ...rawVideo.statsV2, commentCount: '50' } }], hasMore: false };
      },
      async close() {},
    },
  });
  try {
    f.app.store.setSecret('apify-api-token', 'fixture');
    f.app.store.setSecret('openai-api-key', 'fixture');
    await f.request('/connections');
    await f.request('/tiktok/connect', 'POST', { handle: '@fixture_user' });
    for (let i = 0; i < 100 && f.app.tiktok.busy; i++) await delay(5);
    assert.equal(f.app.tiktok.state().phase, 'connected');
    const config = configuration();
    config.sources = [];
    config.platforms.tiktok.replies = true;
    for (const id of ['apify-button-first', 'apify-button-repeat']) {
      const response = await f.request('/collection/runs', 'POST', {
        id,
        mode: 'tiktok',
        configuration: config,
      });
      assert.equal(response.status, 202);
      const result = await finish(f.app, id);
      assert.equal(result.status, 'completed', JSON.stringify(result.failures));
      if (id.endsWith('first')) {
        assert.equal(result.aiCostUsd, (80 * 2.5 + 20 * 0.25 + 30 * 15) / 1_000_000);
        assert.equal(result.counts.comments, 3);
        assert.equal(result.counts.ideas, 1);
      } else assert.equal(result.aiCostUsd, 0);
    }
    const materials = (await f.request('/collection/ai-materials')).data.ideas;
    assert.equal(materials.length, 1);
    assert.ok(
      materials[0].evidence.every((e: { url: string }) =>
        e.url.startsWith(videoUrl + '?comment_id='),
      ),
    );
    assert.equal(analyses, 1);
    assert.equal(starts, 2);
  } finally {
    await f.close();
  }
});

test('a restored actor is read without submitting twice and an empty or foreign dataset is partial', async () => {
  for (const data of [
    [],
    [{ ...rows[0], videoWebUrl: 'https://www.tiktok.com/@other/video/999' }],
  ]) {
    const events: Parameters<ReadOptions['onProgress']>[0][] = [];
    const video = parseVideo(rawVideo);
    const opts: ReadOptions = {
      maxVideos: 1,
      maxComments: 10,
      commentsPerVideo: 10,
      comments: true,
      replies: true,
      since: '',
      signal: new AbortController().signal,
      beforeRequest: async () => {},
      onVideo() {},
      onComment() {
        assert.fail('foreign comment');
      },
      onProgress: (p) => events.push(p),
      journal: { get: <T>() => run as T, put() {} },
    };
    await readApifyComments(videoUrl, [video], opts, 'fixture', async (url, init) => {
      assert.ok(String(url).includes('/datasets/'));
      assert.equal(init?.method, undefined);
      return Response.json(data);
    });
    assert.equal(events.at(-1)?.status, 'limited');
    assert.equal(events.at(-1)?.videos?.processed, 0);
  }
});
