/** P2-16: qualifies the focused agent as one container. Builds the image from this checkout, runs compose.agent.yml with its SQLite volume
 *  and the private generated configuration, and checks the probes, the non-root user and writable volume, an approval that survives a
 *  restart, a payment that happens once however often the approval is replayed, and a clean stop. Needs Docker; touches only the
 *  `super-app-agent` compose project of compose.agent.yml, and prints no credential. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Its own compose project, so the data volume it starts from empty and removes at the end is never a developer's own agent data.
const PROJECT = 'super-app-agent-qualify';
const compose = (...args: string[]) => spawnSync('docker', ['compose', '-p', PROJECT, '-f', 'compose.agent.yml', ...args], { encoding: 'utf8' });
const must = (result: ReturnType<typeof compose>, what: string) => { assert.equal(result.status, 0, `${what} failed: ${(result.stderr || result.stdout).slice(-400)}`); return result.stdout.trim(); };
const env = Object.fromEntries(readFileSync('.env.agent', 'utf8').trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 2, -1)]; }));
const token = (JSON.parse(env.AGENT_TEST_IDENTITIES) as Array<{ token: string }>)[0].token;
const base = 'http://127.0.0.1:4300';
const call = async (path: string, body?: unknown, key = randomUUID(), bearer = token) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) as any };
};
const ready = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/ready`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* not up yet */ } await new Promise(done => setTimeout(done, 1000)); } throw new Error('the agent never became ready'); };

const revision = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
must(compose('down', '-v'), 'start from an empty volume');
must(compose('build'), 'build');
const image = must(spawnSync('docker', ['image', 'inspect', `${PROJECT}-agent`, '--format', '{{.Id}}'], { encoding: 'utf8' }), 'image inspect');
must(compose('up', '-d', '--wait'), 'up');
await ready();
console.log(`PASS: built from revision ${revision} and ready (image ${image.slice(0, 19)})`);

assert.equal((await fetch(`${base}/ready`)).status, 200);
assert.equal((await call('/api/agent/threads', {}, randomUUID(), 'not-a-token')).status, 401, 'an unknown bearer is refused');
assert.equal(must(compose('exec', '-T', 'agent', 'id', '-u'), 'id'), '1001', 'the process is not root');
must(compose('exec', '-T', 'agent', 'sh', '-c', 'touch /app/.data/qualify && rm /app/.data/qualify'), 'write to the data volume');
console.log('PASS: probes answer, a bad credential is refused, the process runs as uid 1001 and writes its volume');

const thread = (await call('/api/agent/threads', {})).data.threadId as string;
const root = `/api/agent/threads/${thread}`;
const asked = await call(`${root}/messages`, { message: 'Retrieve my fines and pay them' });
assert.equal(asked.data.status, 'awaiting_approval');
const approval = asked.data.approval as { id: string; quote: { amountMinor: number } };
assert.equal(approval.quote.amountMinor, 45000);

// A restart must neither lose the pending approval nor change it.
must(compose('restart', 'agent'), 'restart');
await ready();
const resumed = await call(root);
assert.equal(resumed.data.status, 'awaiting_approval');
assert.equal(resumed.data.approval.id, approval.id, 'the same approval survives the restart');
console.log('PASS: the pending approval survived a restart with the same identity');

// Approve once; replay the approval with the same key and with a new key: one payment, one receipt.
const key = randomUUID();
const paid = await call(`${root}/resume`, { approvalId: approval.id, decision: 'approve' }, key);
assert.equal(paid.status, 200);
const receipt = paid.data.receipt;
assert.ok(receipt, 'a receipt exists after approval');
const same = await call(`${root}/resume`, { approvalId: approval.id, decision: 'approve' }, key);
const fresh = await call(`${root}/resume`, { approvalId: approval.id, decision: 'approve' }, randomUUID());
assert.deepEqual(same.data?.receipt ?? receipt, receipt, 'the same key returns the same receipt');
assert.ok(fresh.status >= 400 || JSON.stringify(fresh.data?.receipt ?? receipt) === JSON.stringify(receipt), 'a second approval is refused or returns the same receipt, never a second payment');
must(compose('restart', 'agent'), 'second restart');
await ready();
const after = await call(root);
assert.deepEqual(after.data.receipt, receipt, 'the receipt is the same after another restart');
console.log(`PASS: one payment however often the approval is replayed (same key: HTTP ${same.status}, new key: HTTP ${fresh.status}), and the receipt survives a restart`);

// A stop is clean and inside the grace period.
const started = Date.now();
const stop = compose('stop', 'agent');
assert.equal(stop.status, 0);
const seconds = (Date.now() - started) / 1000;
assert.ok(seconds < 35, `stopped in ${seconds}s`);
const exit = must(spawnSync('docker', ['inspect', '--format', '{{.State.ExitCode}}', compose('ps', '-aq', 'agent').stdout.trim()], { encoding: 'utf8' }), 'inspect exit code');
assert.equal(exit, '0', 'the container exits cleanly on SIGTERM');
console.log(`PASS: clean stop in ${seconds.toFixed(1)}s with exit code 0`);
must(compose('up', '-d', '--wait'), 'start again');
await ready();
assert.deepEqual((await call(root)).data.receipt, receipt, 'the volume kept the settled interaction');
console.log('PASS: restarted from the persistent volume with the interaction intact. No Redis, PostgreSQL, external simulator or model download was needed.');
must(compose('down', '-v'), 'remove the qualification project and its volume');
