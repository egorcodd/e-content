import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { fixture, configuration } from '../server/tests/fixtures.ts';
import { interceptTikTok } from './support/zen-tiktok-responses.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const count = process.env.ZEN_TEST_VIDEOS === '20' ? 20 : 10;
const root = await mkdtemp(join(tmpdir(), 'e-content-zen-addon-'));
const profile = join(root, 'profile'),
  extension = join(root, 'extension');
const f = await fixture();
let browserProcess, socket, network;
try {
  await cp(resolve('extensions/zen-tiktok'), extension, { recursive: true });
  const background = join(extension, 'background.js');
  await writeFile(
    background,
    (await readFile(background, 'utf8')).replace(
      'http://127.0.0.1:5187/api/zen-bridge',
      f.base + '/api/zen-bridge',
    ),
  );
  const allocator = createServer();
  await new Promise((r) => allocator.listen(0, '127.0.0.1', r));
  const port = allocator.address().port;
  await new Promise((r) => allocator.close(r));
  await mkdir(profile);
  await writeFile(
    join(profile, 'user.js'),
    `user_pref("marionette.port",${port});\nuser_pref("browser.shell.checkDefaultBrowser",false);\nuser_pref("browser.startup.homepage_override.mstone","ignore");`,
  );
  const binary =
    process.env.FIREFOX_BIN ||
    (process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : 'firefox');
  browserProcess = spawn(
    binary,
    [
      '--headless',
      '--remote-debugging-port',
      '0',
      '--no-remote',
      '--remote-allow-system-access',
      '--profile',
      profile,
      '--marionette',
    ],
    {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    },
  );
  let launchError;
  browserProcess.on('error', (error) => {
    launchError = error;
  });
  for (let i = 0; i < 200; i++) {
    if (launchError) throw launchError;
    socket = await new Promise((r) => {
      const s = connect({ host: '127.0.0.1', port });
      s.once('connect', () => r(s));
      s.once('error', () => {
        s.destroy();
        r(null);
      });
    });
    if (socket) break;
    await wait(100);
  }
  assert.ok(socket, 'Firefox Marionette did not start');
  let buffer = Buffer.alloc(0),
    sequence = 0;
  const pending = new Map();
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58);
      if (colon < 0) break;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) break;
      const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
      buffer = buffer.subarray(colon + 1 + length);
      if (Array.isArray(message) && message[0] === 1) {
        const p = pending.get(message[1]);
        pending.delete(message[1]);
        if (p) {
          clearTimeout(p.timer);
          message[2] ? p.reject(Error(JSON.stringify(message[2]))) : p.resolve(message[3]);
        }
      }
    }
  });
  const command = (name, args = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        body = JSON.stringify([0, id, name, args]);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Marionette command timed out: ' + name));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      socket.write(Buffer.byteLength(body) + ':' + body);
    });
  const execute = async (script) => {
    const result = await command('WebDriver:ExecuteScript', {
      script,
      args: [],
      newSandbox: true,
      sandbox: 'default',
    });
    return result && Object.hasOwn(result, 'value') ? result.value : result;
  };
  const session = await command('WebDriver:NewSession', {
    acceptInsecureCerts: true,
    webSocketUrl: true,
  });
  network = await interceptTikTok(session.capabilities.webSocketUrl);
  const archive = await fetch(f.base + '/api/zen/extension.zip');
  assert.equal(archive.status, 200);
  const zip = join(root, 'e-content-zen.zip');
  await writeFile(zip, Buffer.from(await archive.arrayBuffer()));
  const installed = await command('Addon:Install', { path: zip, temporary: true });
  assert.ok(JSON.stringify(installed).includes('tiktok-bridge@e-content.local'));
  await command('Addon:Uninstall', { id: 'tiktok-bridge@e-content.local' });
  await command('Addon:Install', { path: extension, temporary: true });
  await command('Marionette:SetContext', { value: 'chrome' });
  const uuids = JSON.parse(
    await execute('return Services.prefs.getStringPref("extensions.webextensions.uuids");'),
  );
  const uuid = uuids['tiktok-bridge@e-content.local'];
  assert.ok(uuid);
  await command('Marionette:SetContext', { value: 'content' });
  await command('WebDriver:Navigate', { url: 'moz-extension://' + uuid + '/popup.html' });
  await f.request('/connections');
  await f.request('/zen/pairing', 'POST', {});
  const code = f.app.zen.state().pairing.code;
  await execute(
    'document.getElementById("code").value=' +
      JSON.stringify(code) +
      ';document.getElementById("pair").requestSubmit();',
  );
  for (let i = 0; i < 100 && !f.app.zen.online; i++) await wait(100);
  assert.equal(
    f.app.zen.online,
    true,
    'Real Firefox extension must pair with the production HTTP bridge',
  );
  let text = '';
  for (let i = 0; i < 50; i++) {
    text = await execute('return document.getElementById("status").textContent');
    if (text.includes('подключён')) break;
    await wait(100);
  }
  assert.match(text, /подключён/);
  for (let i = 0; i < 300 && f.app.tiktok.state().phase !== 'connected'; i++) {
    network.check();
    await wait(100);
  }
  assert.equal(f.app.tiktok.state().phase, 'connected', f.app.tiktok.state().message);
  assert.equal(f.app.tiktok.state().videos.length, 20);
  await f.request('/tiktok/selection', 'POST', { latest: count, enabled: true });
  const config = configuration();
  config.sources = [];
  config.settings.maxComments = 100;
  await f.request('/collection/runs', 'POST', {
    id: 'zen-extension-real-browser-cycle',
    mode: 'tiktok',
    configuration: config,
  });
  for (let i = 0; i < 600 && f.app.store.latest()?.status === 'running'; i++) {
    network.check();
    await wait(100);
  }
  const run = f.app.store.latest();
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.counts.posts, count);
  assert.equal(run.counts.comments, count);
  assert.ok(run.counts.ideas > 0);
  await command('WebDriver:DeleteSession');
  console.log(
    `Zen extension passed: actual ZIP installs, popup pairs, response capture verifies fixture identity, ${count} videos/comments reach workshop and ideas. No live TikTok or user profile accessed.`,
  );
} finally {
  network?.close();
  socket?.destroy();
  browserProcess?.kill();
  await f.close();
  await wait(500);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
