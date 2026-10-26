/** QA-08: the controls that keep automation and money-moving features off until someone selects them, and keep the demo local.
 *  These read the real startup gates and the real compose and package files, so a change that quietly turns something on fails here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerFromEnv, workerEnabled } from '../automation-worker/src/index.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

const text = (path: string) => readFileSync(path, 'utf8');
const composeFiles = readdirSync('.').filter(name => /^(docker-)?compose.*\.ya?ml$/.test(name));

test('QA-08: the worker is off by default, off in production, and scheduling is a second opt-in', t => {
  assert.equal(workerEnabled({}), false);
  assert.equal(workerEnabled({ AUTOMATION_WORKER_ENABLED: 'yes' }), false, 'only the exact value true enables it');
  assert.equal(workerEnabled({ AUTOMATION_WORKER_ENABLED: 'true' }), true);
  assert.equal(workerEnabled({ AUTOMATION_WORKER_ENABLED: 'true', NODE_ENV: 'production' }), false, 'never in production');
  assert.throws(() => createWorkerFromEnv({}), /disabled/);
  assert.throws(() => createWorkerFromEnv({ AUTOMATION_WORKER_ENABLED: 'true' }), /RUN_ID|secret/, 'enabling alone is not enough: a run and a credential are required');

  const scratch = mkdtempSync(join(tmpdir(), 'qa08-worker-'));
  t.after(() => removeTemp(scratch));
  const base = { AUTOMATION_WORKER_ENABLED: 'true', AUTOMATION_RUN_ID: `autorn_${crypto.randomUUID()}`, AUTOMATION_WORKER_CLIENT_SECRET: 'x'.repeat(32), AUTOMATION_JOBS_DB: join(scratch, 'jobs.sqlite') };
  const plain = createWorkerFromEnv(base);
  assert.equal(plain.scheduler, undefined, 'without AUTOMATION_SCHEDULE_ENABLED nothing enqueues work');
  plain.store.close();
  const scheduled = createWorkerFromEnv({ ...base, AUTOMATION_SCHEDULE_ENABLED: 'true', AUTOMATION_JOBS_DB: join(scratch, 'jobs2.sqlite') });
  assert.ok(scheduled.scheduler);
  scheduled.store.close();
});

test('QA-08: no compose file or example environment starts the worker or its schedule', () => {
  assert.ok(composeFiles.length >= 2, 'the compose files were found');
  for (const file of composeFiles) {
    const body = text(file);
    assert.doesNotMatch(body, /automation-worker/, `${file} must not define or start the automation worker`);
    assert.doesNotMatch(body, /AUTOMATION_(WORKER|SCHEDULE)_ENABLED\s*[:=]\s*["']?true/, `${file} must not switch automation on`);
  }
  for (const file of ['.env.example', '.env.demo.example'].filter(existsSync)) {
    assert.doesNotMatch(text(file), /AUTOMATION_(WORKER|SCHEDULE)_ENABLED\s*=\s*true/, `${file} must leave automation off`);
  }
});

test('QA-08: no payment-provider SDK or paid hosted service is a dependency anywhere in the workspace', () => {
  const manifests = ['package.json', ...['apps', 'services', 'packages', 'mini-apps'].flatMap(dir => existsSync(dir) ? readdirSync(dir).map(name => join(dir, name, 'package.json')).filter(existsSync) : [])];
  const banned = /^(stripe|@stripe\/.*|adyen.*|@adyen\/.*|paypal.*|@paypal\/.*|braintree|razorpay|checkout-sdk-node|@checkout\.com\/.*|square|squareup|plaid|@plaid\/.*|twilio|@sentry\/.*|@datadog\/.*|newrelic|launchdarkly-.*)$/;
  for (const file of manifests) {
    const manifest = JSON.parse(text(file)) as Record<string, Record<string, string> | undefined>;
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(manifest[group] ?? {})) assert.doesNotMatch(name, banned, `${file} depends on ${name}`);
    }
  }
});
