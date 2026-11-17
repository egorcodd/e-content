import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

async function harness(phase: string) {
  let listener: (details: unknown) => Promise<unknown>;
  const filters: { onerror?: () => void; error?: string }[] = [];
  let release: (value: unknown) => void = () => {};
  const permission = new Promise((resolve) => {
    release = resolve;
  });
  const browser = {
    runtime: {
      getURL: () => 'moz-extension://11111111-2222-3333-4444-555555555555/',
      getManifest: () => ({ version: '0.1.2' }),
      onMessage: { addListener() {} },
    },
    storage: { local: { get: async () => ({}) } },
    webRequest: {
      onBeforeRequest: {
        addListener(value: typeof listener) {
          listener = value;
        },
      },
      filterResponseData() {
        const filter = {
          write() {},
          close() {},
          error: 'Invalid request ID',
          onerror: undefined as (() => void) | undefined,
        };
        filters.push(filter);
        return filter;
      },
    },
  };
  const context = createContext({
    browser,
    URL,
    AbortSignal,
    TextDecoder,
    Uint8Array,
    setInterval: () => 0,
    fetch: () => permission,
  });
  runInContext(
    await readFile(new URL('../../extensions/zen-tiktok/background.js', import.meta.url), 'utf8'),
    context,
  );
  runInContext(
    'running = { task: { id: "fixture" }, tabId: 7, phase: ' +
      JSON.stringify(phase) +
      ', epoch: 1, cancelled: false }; globalThis.fixtureJob = running;',
    context,
  );
  return {
    trigger: () =>
      listener({
        tabId: 7,
        requestId: 'fixture',
        url: 'https://www.tiktok.com/api/post/item_list/',
        type: 'xmlhttprequest',
      }),
    filters,
    release: () => release({ ok: true, json: async () => ({ allowed: true }) }),
    job: context.fixtureJob,
  };
}
test('a response filter attaches before waiting for the local request budget', async () => {
  const h = await harness('profile');
  const pending = h.trigger();
  assert.equal(h.filters.length, 1);
  h.release();
  await pending;
});
test('post-list requests on the home/identity screen are not observed as profile results', async () => {
  const h = await harness('identity');
  const pending = h.trigger();
  h.release();
  await pending;
  assert.equal(h.filters.length, 0);
});
test('a filter error from a previous document cannot fail the next document', async () => {
  const h = await harness('profile');
  const pending = h.trigger();
  h.release();
  await pending;
  h.job.epoch++;
  h.filters[0].onerror!();
  assert.equal(h.job.error, undefined);
  assert.equal(h.job.captureError, undefined);
});
