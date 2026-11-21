import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Gateway, Peer, TelegramMessage, TelegramPage } from '../telegram.ts';
import { createApplication } from '../index.ts';
import {
  defaultSettings,
  defaultPlatformSettings,
  defaultRunLimits,
  type SourceConfiguration,
} from '../../src/features/sources/model.ts';

export const rpcError = (errorMessage: string) =>
  Object.assign(new Error(errorMessage), { errorMessage });
const now = Math.floor(Date.now() / 1000) - 10;
export const post = (id: number): TelegramMessage => ({
  id,
  date: now,
  text: `Как проверить качество тестов в проекте ${id}?`,
  forwarded: false,
  commentCount: 3,
  metrics: { views: 123 },
});
const reply = (id: number, parent = 900): TelegramMessage => ({
  ...post(id),
  replyTo: parent,
  topId: 900,
  text: [
    'Как проверить стабильность тестов на CI?',
    'Почему автотесты работают локально, но падают в пайплайне?',
    'Подскажи, где смотреть логи фейлов автотестов в CI?',
  ][id % 3],
  commentCount: 0,
});
export class FakeGateway implements Gateway {
  calls: string[] = [];
  signed = false;
  twoFA = false;
  revokeFailure = false;
  flood = false;
  delay = 0;
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
  target = {
    id: 'channel:100',
    channelId: '100',
    username: 'fixture_channel',
    input: {} as Peer['input'],
  };
  group = { id: 'channel:999', channelId: '999', input: {} as Peer['input'] };
  async connect() {
    this.calls.push('connect');
  }
  async disconnect() {
    this.calls.push('disconnect');
  }
  async sendCode() {
    this.calls.push('sendCode');
    return { hash: 'fixture-code-hash', length: 5, delivery: 'telegram' };
  }
  async signIn(_phone: string, _hash: string, code: string) {
    this.calls.push('signIn');
    if (code !== '12345') throw rpcError('PHONE_CODE_INVALID');
    if (this.twoFA) throw rpcError('SESSION_PASSWORD_NEEDED');
    this.signed = true;
  }
  async passwordHint() {
    return 'fixture';
  }
  async checkPassword(value: string) {
    if (value !== 'fixture-password') throw rpcError('PASSWORD_HASH_INVALID');
    this.signed = true;
  }
  async account() {
    return { id: 'telegram:7', displayName: 'Fixture User', handle: '@fixture_user' };
  }
  session() {
    return 'fixture-secret-session';
  }
  async revoke() {
    this.calls.push('revoke');
    if (this.revokeFailure) throw rpcError('TIMEOUT');
  }
  private async request(name: string, signal?: AbortSignal) {
    await this.beforeRequest?.(signal);
    this.calls.push(name);
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
    signal?.throwIfAborted();
    if (this.flood) throw rpcError('FLOOD_WAIT_3');
  }
  async resolve(_source: unknown, signal?: AbortSignal) {
    await this.request('resolve', signal);
    return this.target;
  }
  async posts(
    _peer: Peer,
    offset: number,
    _until: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TelegramPage> {
    await this.request(`posts:${offset}:${limit}`, signal);
    if (!offset) return { items: [], count: 1, cursor: 1000 };
    if (offset === 1000)
      return {
        items: [post(42), post(41)].slice(0, limit),
        count: Math.min(2, limit),
        cursor: limit === 1 ? 42 : 41,
      };
    return { items: [], count: 0, cursor: 0 };
  }
  async post(_peer: Peer, id: number, signal?: AbortSignal) {
    await this.request('post', signal);
    return post(id);
  }
  async discussion(_peer: Peer, id: number, signal?: AbortSignal) {
    await this.request(`discussion:${id}`, signal);
    return { peer: this.group, root: 900 };
  }
  async comments(
    peer: Peer,
    root: number,
    offset: number,
    _until: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TelegramPage> {
    if (peer.id !== this.group.id || root !== 900) throw new Error('Wrong discussion root');
    await this.request(`comments:${offset}:${limit}`, signal);
    const items = offset === 0 ? [reply(907), reply(906, 907)] : offset === 906 ? [reply(905)] : [];
    const result = items.slice(0, limit);
    return { items: result, count: result.length, cursor: result.at(-1)?.id ?? 0 };
  }
}
export function configuration(): SourceConfiguration {
  return {
    schemaVersion: 2,
    sources: [
      {
        id: 'source-1',
        title: 'Fixture channel',
        platform: 'telegram',
        kind: 'channel',
        url: 'https://t.me/fixture_channel',
        purpose: 'own',
        accountId: null,
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ],
    settings: { ...defaultSettings, maxPublications: 10, maxComments: 10 },
    platforms: structuredClone(defaultPlatformSettings),
    runLimits: { ...defaultRunLimits },
  };
}
export async function fixture(
  options: Pick<
    Parameters<typeof createApplication>[0] & {},
    | 'tiktokReaderFactory'
    | 'tiktokContextFactory'
    | 'tiktokTransport'
    | 'tiktokNativeTransport'
    | 'tiktokRetryDelaysMs'
  > = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'e-content-test-'));
  const gateway = new FakeGateway();
  const app = createApplication({
    directory,
    gatewayFactory: () => gateway,
    requestInterval: 0,
    tiktokTransport: 'zen',
    ...options,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let cookie = '',
    csrf = '';
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    const data = response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : await response.text();
    if (data?.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data, response };
  }
  async function login() {
    await request('/connections');
    await request('/telegram/configure', 'POST', { apiId: 123456, apiHash: 'a'.repeat(32) });
    await request('/telegram/code', 'POST', { phone: '+79000000000' });
    return request('/telegram/confirm', 'POST', { code: '12345' });
  }
  return {
    directory,
    gateway,
    app,
    base,
    request,
    login,
    disposeDirectory: () => rm(directory, { recursive: true, force: true }),
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function finish(app: ReturnType<typeof createApplication>, id: string) {
  for (let i = 0; i < 200; i++) {
    const run = app.store.run(id);
    if (run && run.status !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Run did not finish');
}
