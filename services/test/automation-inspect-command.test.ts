import test from 'node:test';
import assert from 'node:assert/strict';
import { JobStore, jobIdentity } from '../automation-worker/src/jobs.ts';
import { inspectHeldPreparation } from '../automation-worker/src/preparation-inspection.ts';
import type { HttpExecutionGateway } from '../automation-worker/src/http-gateway.ts';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

test('inspection derives the original request from a held job and never changes its history', async () => {
  const store = new JobStore(':memory:'), rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' };
  const runId = 'autorn_00000000-0000-4000-8000-000000000000', job = store.enqueue(rule), claim = store.claim('worker', 30000)!;
  store.transition(claim, 'PREPARING'); store.transition(claim, 'HELD', { reason: 'PREPARATION_UNKNOWN' });
  let called = 0, answer: Awaited<ReturnType<HttpExecutionGateway['inspectPreparation']>>;
  const gateway = { inspectPreparation: async (input: { mandateId: string; policyVersion: number; occurrenceKey: string; requestKey: string }) => {
    called++; assert.deepEqual(input, { mandateId: rule.mandateId, policyVersion: 1, occurrenceKey: rule.occurrenceKey, requestKey: jobIdentity(rule).requestKey }); return answer;
  } };
  try {
    const before = JSON.stringify([store.get(job.id), store.attempts(job.id), store.outbox(job.id)]);
    assert.deepEqual(await inspectHeldPreparation(store.db, gateway, runId, job.id), { status: 'NOT_RECORDED' });
    answer = { id: 'autoexec_1', runId, orderId: 'order_1', amountMinor: 15000 };
    assert.deepEqual(await inspectHeldPreparation(store.db, gateway, runId, job.id), { status: 'PREPARED', executionId: 'autoexec_1', orderId: 'order_1', amountMinor: 15000 });
    answer = { skipped: true, reason: 'private-token-marker' };
    assert.deepEqual(await inspectHeldPreparation(store.db, gateway, runId, job.id), { status: 'SKIPPED' });
    answer = { id: 'autoexec_1', runId: 'autorn_11111111-1111-4111-8111-111111111111', orderId: 'order_1', amountMinor: 15000 };
    await assert.rejects(inspectHeldPreparation(store.db, gateway, runId, job.id));
    assert.equal(JSON.stringify([store.get(job.id), store.attempts(job.id), store.outbox(job.id)]), before);
    assert.equal(called, 4);
    await assert.rejects(inspectHeldPreparation(store.db, gateway, runId, 'job_wrong'));
    const other = store.enqueue({ ...rule, occurrenceKey: 'other' });
    await assert.rejects(inspectHeldPreparation(store.db, gateway, runId, other.id));
    assert.equal(called, 4, 'non-held or unknown jobs never trigger provider inspection');
  } finally { store.close(); }
});

test('inspection rejects changed run or a job that changes while the provider is read', async () => {
  const store = new JobStore(':memory:'), rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' };
  const runId = 'autorn_00000000-0000-4000-8000-000000000000', job = store.enqueue(rule), claim = store.claim('worker', 30000)!;
  store.transition(claim, 'PREPARING'); store.transition(claim, 'HELD', { reason: 'PREPARATION_UNKNOWN', runId });
  let reads = 0;
  const gateway = { inspectPreparation: async () => { reads++; store.db.prepare("UPDATE jobs SET reason='OTHER' WHERE id=?").run(job.id); return undefined; } };
  try {
    await assert.rejects(inspectHeldPreparation(store.db, gateway, 'autorn_11111111-1111-4111-8111-111111111111', job.id));
    assert.equal(reads, 0);
    await assert.rejects(inspectHeldPreparation(store.db, gateway, runId, job.id));
    assert.equal(reads, 1);
  } finally { store.close(); }
});

test('inspection command reads a held job without starting a worker, exposing credentials or creating databases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-inspection-')), path = join(dir, 'jobs.sqlite');
  const runId = 'autorn_00000000-0000-4000-8000-000000000000', rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' };
  const store = new JobStore(path), job = store.enqueue(rule), claim = store.claim('worker', 30000)!;
  store.transition(claim, 'PREPARING'); store.transition(claim, 'HELD', { reason: 'PREPARATION_UNKNOWN' });
  const before = JSON.stringify([store.get(job.id), store.attempts(job.id), store.outbox(job.id)]); store.close();
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'fixture-service-token', expires_in: 300 }));
    return res.end(JSON.stringify({ success: true, found: true, preparation: { id: 'autoexec_1', orderId: 'order_1', runId, mandateId: rule.mandateId, occurrenceKey: rule.occurrenceKey, policyVersion: 1, state: 'PREPARED', amountMinor: 15000, currency: 'AED' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = { ...process.env, NODE_ENV: 'development', AUTOMATION_JOBS_DB: path, AUTOMATION_RUN_ID: runId, AUTOMATION_WORKER_CLIENT_SECRET: 'fixture-private-secret', KEYCLOAK_TOKEN_URL: `${base}/token`, PROVIDER_PAYMENTS_URL: base, DELEGATION_AUTHORITY_URL: base };
  try {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/inspect-automation-preparation.ts', job.id], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; child.stdout.setEncoding('utf8').on('data', part => { output += part; }); child.stderr.setEncoding('utf8').on('data', part => { output += part; });
    const [exitCode] = await once(child, 'close'); assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(output), { status: 'PREPARED', executionId: 'autoexec_1', orderId: 'order_1', amountMinor: 15000 });
    assert.doesNotMatch(output, /fixture-private-secret|fixture-service-token/);
    assert.deepEqual(paths, ['POST /token', `GET /internal/automation-runs/${runId}/requests/${jobIdentity(rule).requestKey}`]);
    const reopened = new JobStore(path);
    try { assert.equal(JSON.stringify([reopened.get(job.id), reopened.attempts(job.id), reopened.outbox(job.id)]), before); } finally { reopened.close(); }
    const missing = join(dir, 'missing.sqlite');
    const rejected = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/inspect-automation-preparation.ts', job.id], { env: { ...env, AUTOMATION_JOBS_DB: missing }, encoding: 'utf8', windowsHide: true });
    assert.notEqual(rejected.status, 0); assert.equal(existsSync(missing), false);
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, /fixture-private-secret|fixture-service-token/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); removeTemp(dir); }
});
