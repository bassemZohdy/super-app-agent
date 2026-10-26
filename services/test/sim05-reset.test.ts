import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { scenarioResetSchema } from '../provider-simulator/src/scenario-controls.ts';
import { armFailpoint, failpointFirings, FAILPOINTS } from '../provider-simulator/src/failpoints.ts';
import { RUN_DATABASE_FILES, RUN_RESET_LOG, resetRunDatabase } from '../provider-simulator/src/run-reset.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-issuer-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'reset-operator', runId: `simrun_${randomUUID()}` };
  const db = new AccountDatabase(path), actor = actorFor({ sub: 'reset-customer' }, undefined, 'Bearer customer');
  const engine = new ProviderEngine('payments', db, { issuerScenario: context });
  db.accounts(actor.sub); engine.seed(actor);
  let closed = false;
  t.after(() => { if (!closed) db.close(); removeTemp(root); });
  return { root, path, context, db, controls: db.scenarioControls!, close: () => { closed = true; db.close(); } };
}

test('SIM-05: only the run operator can request a reset, with a bounded replayable key', t => {
  const f = fixture(t), key = `reset_${randomUUID()}`;
  assert.throws(() => f.controls.reset('reset-customer', key), (e: any) => e.code === 'SCENARIO_OPERATOR_REQUIRED');
  assert.throws(() => f.controls.reset('reset-operator', 'short'), (e: any) => e.code === 'SCENARIO_CONTROL_INVALID');
  const first = f.controls.reset('reset-operator', key);
  assert.deepEqual([first.resetRequested, first.runId, first.fresh], [true, f.context.runId, true]);
  assert.equal(f.controls.reset('reset-operator', key).fresh, false, 'an exact retry replays and does not trigger the host again');
  assert.equal(f.db.db.prepare("SELECT COUNT(*) n FROM scenario_control_audit WHERE body LIKE '%RESET_REQUESTED%'").get()!.n, 1);
});

test('SIM-05: a reset request drops armed failpoints and deletes no rows', t => {
  const f = fixture(t), name = FAILPOINTS[0];
  armFailpoint(name, 3);
  const before = f.db.db.prepare('SELECT COUNT(*) n FROM payment_journal_entries').get()!.n;
  f.controls.reset('reset-operator', `reset_${randomUUID()}`);
  assert.equal(failpointFirings(name), 0);
  assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM payment_journal_entries').get()!.n, before, 'sealed journals are never edited in place');
});

test('SIM-05: the reset HTTP body accepts only a bounded operator key', () => {
  const ajv = new Ajv({ strict: false });
  assert.equal(ajv.validate(scenarioResetSchema, { requestKey: 'reset_abcdef12' }), true);
  for (const bad of [{}, { requestKey: 'x' }, { requestKey: 'reset_abcdef12', path: '/etc' }, { requestKey: 'bad key!!' }]) assert.equal(ajv.validate(scenarioResetSchema, bad), false);
});

test('SIM-05: the host removes only the run database files, keeps other files and logs the reset outside the database', t => {
  const f = fixture(t);
  f.close();
  writeFileSync(join(f.root, 'issuer-run.sqlite'), 'run anchor stays');
  writeFileSync(join(f.root, 'notes.txt'), 'unrelated stays');
  const removed = resetRunDatabase(f.root, f.context.runId, 'reset-operator');
  assert.deepEqual(removed, [...RUN_DATABASE_FILES]);
  for (const name of RUN_DATABASE_FILES) assert.equal(existsSync(join(f.root, name)), false);
  assert.equal(readFileSync(join(f.root, 'issuer-run.sqlite'), 'utf8'), 'run anchor stays');
  assert.equal(readFileSync(join(f.root, 'notes.txt'), 'utf8'), 'unrelated stays');
  const log = readFileSync(join(f.root, RUN_RESET_LOG), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(log.map(entry => [entry.runId, entry.operatorSub]), [[f.context.runId, 'reset-operator']]);
});

test('SIM-05: a fresh store opens on the same run and reseeds the account', t => {
  const f = fixture(t);
  f.close();
  resetRunDatabase(f.root, f.context.runId, 'reset-operator');
  const reopened = new AccountDatabase(f.path), actor = actorFor({ sub: 'reset-customer' }, undefined, 'Bearer customer');
  t.after(() => reopened.close());
  const engine = new ProviderEngine('payments', reopened, { issuerScenario: f.context });
  reopened.accounts(actor.sub);
  assert.equal(reopened.get(actor.accountId, 'seed'), undefined, 'the previous run state is gone');
  engine.seed(actor);
  assert.equal(engine.ledger!.summary(actor.accountId).balanceMinor, 150000, 'the seeded wallet is restored');
});

test('SIM-05: the host never resets a normal demo directory', t => {
  const ordinary = mkdtempSync(join(tmpdir(), 'cityside-demo-'));
  t.after(() => removeTemp(ordinary));
  writeFileSync(join(ordinary, 'payments.sqlite'), 'normal demo data');
  assert.throws(() => resetRunDatabase(ordinary, `simrun_${randomUUID()}`, 'op'), /dedicated isolated run directory/);
  assert.equal(readFileSync(join(ordinary, 'payments.sqlite'), 'utf8'), 'normal demo data');
  assert.equal(existsSync(join(ordinary, RUN_RESET_LOG)), false);
});

test('SIM-05: the host refuses a relative root or a malformed run identity', () => {
  assert.throws(() => resetRunDatabase('relative/root', `simrun_${randomUUID()}`, 'op'), /absolute/);
  assert.throws(() => resetRunDatabase(tmpdir(), 'not-a-run', 'op'), /run ID/);
  assert.throws(() => resetRunDatabase(tmpdir(), `simrun_${randomUUID()}`, ''), /run ID/);
});

test('SIM-05: run-wide inspection is authorized for the run operator alone', t => {
  const f = fixture(t);
  assert.doesNotThrow(() => f.controls.authorizeInspection('reset-operator'));
  for (const subject of ['reset-customer', 'someone-else', '']) assert.throws(() => f.controls.authorizeInspection(subject), (e: any) => e.code === 'SCENARIO_OPERATOR_REQUIRED', JSON.stringify(subject));
});

test('SIM-05: the provider has no network route that moves shared time, so the business clock stays with the local CLI', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('services/provider-simulator/src/index.ts', 'utf8');
  const prefixes = [...new Set([...source.matchAll(/\/internal\/([a-z-]+)/g)].map(m => m[1]))].sort();
  assert.deepEqual(prefixes, ['automation-runs', 'issuer-scenarios', 'payment-events', 'scenario-controls'], 'a new internal route needs this list, and a review of whether it can move time, updated');
  assert.equal(/\b(?:advance|setClock|set-clock|businessAt)\b/i.test(source), false, 'no provider route advances time');
});
