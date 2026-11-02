import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientCredentials } from '../../packages/backend-kit/src/oauth.ts';

for (const oldFirst of [true, false]) test(`service-token invalidation fences in-flight refreshes (old completes first: ${oldFirst})`, async t => {
  let releaseOld!: () => void, releaseNew!: () => void, calls = 0;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    const call = ++calls;
    await (call === 1 ? oldGate : newGate);
    return Response.json({ access_token: call === 1 ? 'old-token' : 'fresh-token', expires_in: 300 });
  });
  const client = new ClientCredentials('test-client', 'test-secret');
  const old = client.token(); void old.catch(() => {});
  client.invalidate();
  const fresh = client.token(); void fresh.catch(() => {});
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 2, 'a new request must not join an invalidated refresh');
    if (oldFirst) {
      releaseOld();
      await assert.rejects(old, /invalidated/i);
      const joined = client.token();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(calls, 2, 'the old completion must not clear the newer pending request');
      releaseNew();
      assert.deepEqual(await Promise.all([fresh, joined]), ['fresh-token', 'fresh-token']);
    } else {
      releaseNew(); assert.equal(await fresh, 'fresh-token');
      releaseOld(); await assert.rejects(old, /invalidated/i);
    }
    assert.equal(await client.token(), 'fresh-token'); assert.equal(calls, 2);
  } finally {
    releaseOld(); releaseNew(); await Promise.allSettled([old, fresh]);
  }
});
