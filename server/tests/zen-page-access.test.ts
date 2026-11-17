import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

async function pageHarness(failures: number, granted = true) {
  let injections = 0;
  const browser = {
    runtime: {
      getURL: () => 'moz-extension://11111111-2222-3333-4444-555555555555/',
      onMessage: { addListener() {} },
    },
    webRequest: { onBeforeRequest: { addListener() {} } },
    storage: { local: { get: async () => ({}) } },
    permissions: { contains: async () => granted },
    tabs: {
      get: async () => ({ id: 7, status: 'complete', url: 'https://www.tiktok.com/@fixture_user' }),
      executeScript: async (_id: number, options: { file?: string; code?: string }) => {
        if (options.file && ++injections <= failures)
          throw Error('Missing host permission for the tab');
        return options.code ? [{ items: [], ready: true }] : [undefined];
      },
      sendMessage: async () => {
        throw Error('Could not establish connection. Receiving end does not exist.');
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
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
    clearTimeout() {},
  });
  const helper = new URL('../../extensions/zen-tiktok/page-access.js', import.meta.url);
  if (existsSync(helper)) runInContext(await readFile(helper, 'utf8'), context);
  runInContext(
    await readFile(new URL('../../extensions/zen-tiktok/background.js', import.meta.url), 'utf8'),
    context,
  );
  return {
    execute: () =>
      runInContext(
        "running = { task: { id: 'fixture' }, tabId: 7, cancelled: false }; page(running, 'snapshot')",
        context,
      ),
    injections: () => injections,
  };
}
test('a document transition retries one missing-host error and reads directly without a page message port', async () => {
  const h = await pageHarness(1);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.execute())), { items: [], ready: true });
  assert.equal(h.injections(), 2);
});
test('a real missing site grant stops before any injection and explains the permission', async () => {
  const h = await pageHarness(0, false);
  await assert.rejects(h.execute(), /Разрешите.*TikTok/);
  assert.equal(h.injections(), 0);
});
test('repeated navigation failures are bounded and remain actionable', async () => {
  const h = await pageHarness(99);
  await assert.rejects(h.execute(), /вкладк.*TikTok/i);
  assert.equal(h.injections(), 3);
});
