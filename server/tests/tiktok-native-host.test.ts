import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeTikTokHost } from '../tiktok/native-host.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'e-content-native-host-'));
  const directory = '.local/fixture-upstream';
  const python = join(
    root,
    '.local/tiktok-native/venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  await Promise.all([
    mkdir(join(root, 'collectors/tiktok'), { recursive: true }),
    mkdir(join(root, directory, 'dist'), { recursive: true }),
    mkdir(join(python, '..'), { recursive: true }),
  ]);
  await writeFile(python, '');
  await writeFile(
    join(root, 'collectors/tiktok/upstream.json'),
    JSON.stringify({ directory, revision: 'fixture' }),
  );
  await writeFile(
    join(root, '.local/tiktok-native/installed.json'),
    JSON.stringify({ revision: 'fixture' }),
  );
  const health = join(root, 'health-called.json');
  await writeFile(
    join(root, directory, 'dist/main.js'),
    `
    const http=require('node:http');const fs=require('node:fs');
    http.createServer((req,res)=>{
      if(req.url==='/internal/health'){fs.writeFileSync(${JSON.stringify(health)},'true');return;}
      if(req.url==='/'){res.writeHead(404);return res.end();}
      if(req.url.includes('slow'))return;
      res.setHeader('Content-Type','application/json');
      if(req.url.includes('rejected-client')){
        res.writeHead(429);
        return res.end(JSON.stringify({error:{kind:'UPSTREAM_THROTTLED',message:'TikTok answered HTTP 200 with an empty body for the page (tt-ticket-guard-result: 0).',details:{upstreamStatus:200,ticketGuardResult:0}}}));
      }
      if(req.url.includes('throttled')){
        res.writeHead(502,{'Retry-After':'20'});
        return res.end(JSON.stringify({error:{kind:'UPSTREAM_THROTTLED',message:'TikTok answered HTTP 200 with an empty body for the page.',details:{upstreamStatus:200,retryAfterMs:30000}}}));
      }
      if(req.url.includes('timeout')){
        res.writeHead(502);
        return res.end(JSON.stringify({error:{kind:'UPSTREAM_TIMEOUT'}}));
      }
      res.end(JSON.stringify(req.url.includes('refused')?{status_code:0,statusCode:10221}:{status_code:0,userInfo:{user:{uniqueId:'fixture'}}}));
    }).listen(Number(process.env.PORT),'127.0.0.1');
  `,
  );
  const host = new NativeTikTokHost(root);
  return {
    host,
    health,
    async close() {
      await host.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('native host starts without contacting upstream health and rejects conflicting nonzero TikTok status', async () => {
  const f = await fixture();
  try {
    const response = await f.host.get(
      '/tiktok/user/detail?uniqueId=fixture',
      AbortSignal.timeout(5000),
    );
    assert.ok(response.userInfo);
    await assert.rejects(readFile(f.health), { code: 'ENOENT' });
    await assert.rejects(
      f.host.get('/tiktok/user/detail?uniqueId=refused', AbortSignal.timeout(5000)),
      { code: 'TIKTOK_REFUSED' },
    );
    await assert.rejects(f.host.get('/internal/session', AbortSignal.timeout(5000)), {
      code: 'TIKTOK_PATH',
    });
    await assert.rejects(f.host.get('/tiktok/user/detail?uniqueId=rejected-client', AbortSignal.timeout(5000)),
      {code:'TIKTOK_BLOCKED',upstreamStatus:200,responseIssue:'access'});
    const beforeThrottle = Date.now();
    await assert.rejects(
      f.host.get('/tiktok/user/detail?uniqueId=throttled', AbortSignal.timeout(5000)),
      (error: unknown) => {
        const item = error as {
          code?: string;
          status?: number;
          upstreamStatus?: number;
          retryAt?: string;
          responseIssue?: string;
        };
        assert.equal(item.code, 'TIKTOK_BLOCKED');
        assert.equal(item.status, 429);
        assert.equal(item.upstreamStatus, 200);
        assert.equal(item.responseIssue, 'empty');
        assert.ok(Date.parse(item.retryAt!) >= beforeThrottle + 30_000);
        return true;
      },
    );
    await assert.rejects(
      f.host.get('/tiktok/user/detail?uniqueId=timeout', AbortSignal.timeout(5000)),
      { code: 'TIKTOK_TIMEOUT', status: 504 },
    );
  } finally {
    await f.close();
  }
});

test('native host cancellation closes the collector and permits a fresh start', async () => {
  const f = await fixture();
  try {
    await f.host.get('/tiktok/user/detail?uniqueId=fixture', AbortSignal.timeout(5000));
    const controller = new AbortController();
    const reading = f.host.get('/tiktok/user/detail?uniqueId=slow', controller.signal);
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      await assert.rejects(reading, { name: 'AbortError' });
    } finally {
      clearTimeout(timer);
    }
    assert.ok(
      (await f.host.get('/tiktok/user/detail?uniqueId=fixture', AbortSignal.timeout(5000)))
        .userInfo,
    );
  } finally {
    await f.close();
  }
});
