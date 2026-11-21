import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, configuration } from './fixtures.ts';
import { rawVideo, rawComment } from './tiktok-fixtures.ts';
import { parseVideo } from '../tiktok/parser.ts';
import { NativeTikTokSource } from '../tiktok/native-source.ts';
import type { SourceProgress } from '../../src/features/collection/contracts.ts';
import type { ReadOptions } from '../tiktok/contracts.ts';

test('ordinary runs reuse the confirmed public end and recheck when the parent count changes', async () => {
  const f = await fixture();
  try {
    let replies = 8,
      pages = 0;
    const root = '9000000000000000014';
    const reader = new NativeTikTokSource(f.app.store, {
      async get(path) {
        if (path.includes('/replies?')) {
          pages++;
          return { comments: [], has_more: 0, cursor: 0, total: replies, status_code: 0 };
        }
        if (path.includes('/comments?'))
          return {
            comments: [{ ...rawComment(root), reply_comment_total: replies }],
            has_more: 0,
            cursor: 0,
            status_code: 0,
          };
        return { itemInfo: { itemStruct: rawVideo } };
      },
      async close() {},
    });
    const video = parseVideo(rawVideo, rawVideo.id);
    const source = {
      ...configuration().sources[0],
      platform: 'tiktok' as const,
      kind: 'video' as const,
      url: video.url,
    };
    const options: ReadOptions = {
      signal: new AbortController().signal,
      tiktokCollectionVersion: 2,
      since: '',
      maxVideos: 1,
      maxComments: 100,
      comments: true,
      replies: true,
      beforeRequest: async () => {},
      onVideo() {},
      onComment() {},
      onProgress() {},
    };
    await reader.read(source, options);
    await reader.read(source, options);
    assert.equal(pages, 1);
    replies++;
    await reader.read(source, options);
    assert.equal(pages, 2);
    assert.equal(f.app.store.pendingThreadCount(source.id), 0);
    f.app.store.db
      .prepare('UPDATE tiktok_exhausted_threads SET checked_at=0 WHERE source_id=?')
      .run(source.id);
    await reader.read(source, options);
    assert.equal(pages, 3);
  } finally {
    await f.close();
  }
});

test('a verified public end closes only the exhausted thread, even when the counter is larger', async () => {
  const video = parseVideo(rawVideo, rawVideo.id);
  const exhausted = '9000000000000000011';
  const ambiguous = '9000000000000000012';
  const replyId = '9000000000000000013';
  const calls: string[] = [];
  const f = await fixture();
  try {
    const reader = new NativeTikTokSource(f.app.store, {
      async get(path) {
        calls.push(path);
        assert.ok(path.includes('/replies?'));
        if (path.includes(ambiguous))
          return { comments: [], has_more: 1, cursor: 8, total: 8, status_code: 0 };
        return path.endsWith('cursor=3')
          ? {
              comments: [rawComment(replyId, exhausted)],
              has_more: 0,
              cursor: 4,
              total: 8,
              status_code: 0,
            }
          : { comments: [], has_more: 0, cursor: 4, total: 8, status_code: 0 };
      },
      async close() {},
    });
    const source = {
      ...configuration().sources[0],
      platform: 'tiktok' as const,
      kind: 'profile' as const,
      url: 'https://www.tiktok.com/@fixture_user',
    };
    const task = { video, rootId: exhausted, total: 8, seen: [], cursor: '3' };
    f.app.store.saveThread(source.id, task);
    let last: Omit<SourceProgress, 'platform' | 'updatedAt'> | undefined;
    const replies: string[] = [];
    const read = () =>
      reader.read(source, {
        tiktokCollectionVersion: 2,
        threadsOnly: true,
        signal: new AbortController().signal,
        maxVideos: 20,
        comments: true,
        replies: true,
        maxComments: 100,
        since: '',
        beforeRequest: async () => {},
        onVideo() {},
        onComment(comment) {
          replies.push(comment.id);
        },
        onProgress(progress) {
          last = progress;
        },
      });
    await read();
    assert.equal(last?.status, 'completed');
    assert.deepEqual(last?.threads, { selected: 1, completed: 1 });
    assert.deepEqual(replies, [replyId]);
    assert.equal(calls.length, 2);
    assert.equal(f.app.store.pendingThreadCount(source.id), 0);
    assert.equal(f.app.store.closedThreads(source.id)[0]?.rootId, exhausted);
    f.app.store.saveThread(source.id, { ...task, rootId: ambiguous });
    await read();
    assert.equal(f.app.store.pendingThreadCount(source.id), 1);
    assert.equal(f.app.store.closedThreads(source.id).length, 1);
  } finally {
    await f.close();
  }
});
