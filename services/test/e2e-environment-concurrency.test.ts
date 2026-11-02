import test from 'node:test';
import assert from 'node:assert/strict';
import { startEnvironment } from '../../scripts/e2e/environment.ts';

test('isolated startup rejects overlap and releases the guard after preflight failure', async t => {
  let release!: (response: Response) => void, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { release = resolve; });
    return new Response('', { status: 503 });
  });
  const original = process.env.SERVICE_RIDE_URL;
  const first = startEnvironment();
  const firstRejected = assert.rejects(first, /Start local Keycloak\/Redis/);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('overlapping startup did not stop')), 1000); });
    await assert.rejects(Promise.race([startEnvironment(), deadline]), /isolated environment is already active/i);
    assert.equal(calls, 1); assert.equal(process.env.SERVICE_RIDE_URL, original);
  } finally { clearTimeout(timer); release(new Response('', { status: 503 })); }
  await firstRejected;
  await assert.rejects(startEnvironment(), /Start local Keycloak\/Redis/);
  assert.equal(calls, 2);
});
