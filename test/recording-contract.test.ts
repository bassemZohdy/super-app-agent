import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pacing } from '../scripts/e2e/config.ts';
import { publishRecording, timecode } from '../scripts/e2e/report.ts';

test('recording defaults give readers six-second reviews and eight-second receipts; fast checks omit presentation pauses', t => {
  const original = process.env.E2E_PACE;
  t.after(() => { if (original === undefined) delete process.env.E2E_PACE; else process.env.E2E_PACE = original; });
  delete process.env.E2E_PACE;
  assert.equal(pacing(true).review, 6000); assert.equal(pacing(true).receipt, 8000);
  assert.equal(pacing(false).review, 0);
  process.env.E2E_PACE = '1.5'; assert.equal(pacing(true).receipt, 12000);
  for (const value of ['-1', '4', 'Infinity', 'invalid']) {
    process.env.E2E_PACE = value; assert.throws(() => pacing(true), /E2E_PACE/);
  }
});

test('recording chapter timestamps preserve milliseconds across minute and hour boundaries', () => {
  assert.equal(timecode(0), '00:00:00.000');
  assert.equal(timecode(61.25), '00:01:01.250');
  assert.equal(timecode(3600), '01:00:00.000');
});

test('failed or incomplete runs cannot overwrite the last successful recording viewer', async () => {
  const before = await readFile('docs/recordings/index.html');
  const report = { status: 'failed', createdAt: '', source: '', dirty: false, scope: '', chapters: [], pacing: pacing(false) };
  await assert.rejects(() => publishRecording('/unused-failed-run', report), /Only complete asserted recordings/);
  await assert.rejects(() => publishRecording('/unused-incomplete-run', { ...report, status: 'passed' }), /Only complete asserted recordings/);
  assert.deepEqual(await readFile('docs/recordings/index.html'), before);
});

test('recording server supports video byte ranges, rejects invalid ranges and contains file paths', async t => {
  const { server } = await import('../scripts/serve-recordings.ts');
  const { once } = await import('node:events');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const path = '/videos/superapp-e2e-scenarios.webm';
  const response = await fetch(base + path, { headers: { Range: 'bytes=0-15' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('accept-ranges'), 'bytes');
  const original = await readFile('docs/recordings' + path);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(0, 16));
  assert.equal(response.headers.get('content-range'), `bytes 0-15/${original.length}`);
  assert.equal((await fetch(base + path, { headers: { Range: 'bytes=99999999999-' } })).status, 416);
  assert.equal((await fetch(base + '/%2e%2e%2fSECURITY.md')).status, 403);
});
