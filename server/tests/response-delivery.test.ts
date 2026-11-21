import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ResponseDelivery } from '../response-delivery.ts';

function ledger() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE ai_deliveries(fingerprint TEXT PRIMARY KEY,state TEXT NOT NULL,remote_id TEXT,result TEXT,diagnostic TEXT); INSERT INTO ai_deliveries VALUES ('batch','ready',NULL,NULL,NULL)",
  );
  return db;
}

test('after shutdown an accepted response is retrieved by ID, including after a temporary read failure', async (t) => {
  const db = ledger();
  t.after(() => db.close());
  const first = new ResponseDelivery(
    db,
    async (_url, opts) => {
      assert.equal(opts?.method, 'POST');
      assert.equal(JSON.parse(String(opts?.body)).background, true);
      return Response.json({ id: 'resp_1', status: 'queued' });
    },
    async () => {
      throw Error('shutdown');
    },
  );
  await assert.rejects(first.receive('batch', 'test', {}), /shutdown/);
  let reads = 0;
  const restarted = new ResponseDelivery(
    db,
    async (url, opts) => {
      assert.equal(opts?.method, 'GET');
      assert.ok(String(url).endsWith('/resp_1'));
      if (++reads === 1) return new Response(null, { status: 503 });
      return Response.json({ id: 'resp_1', status: 'completed', output: [] });
    },
    async () => {},
  );
  assert.equal((await restarted.receive('batch', 'test', {})).status, 'completed');
  assert.equal((await restarted.receive('batch', 'test', {})).status, 'completed');
  assert.equal(reads, 2);
});

test('retry a proven failure to connect, hold an ambiguous submission across restarts', async (t) => {
  const db = ledger();
  t.after(() => db.close());
  let sends = 0;
  const fetcher: typeof fetch = async () => {
    const code = ++sends === 1 ? 'ECONNREFUSED' : 'ECONNRESET';
    throw Object.assign(Error('network'), { cause: { code } });
  };
  const receive = () =>
    new ResponseDelivery(db, fetcher, async () => {}).receive('batch', 'test', {});
  await assert.rejects(receive(), { code: 'AI_UNCONFIRMED' });
  await assert.rejects(receive(), { code: 'AI_UNCONFIRMED' });
  assert.equal(sends, 2);
});
