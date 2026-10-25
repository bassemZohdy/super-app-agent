import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { setKillSwitch } from '../agent-core/src/automation-kill-switch.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

// AUTO-15 step 3a: an allowlisted operator sign-in engages or releases the worker's kill switch. Anyone else is refused
// and nothing changes. A missing job store is an error, and the route accepts only the fields it names.
const operator = { sub: 'ops-admin', username: 'ops-admin', name: 'Operator', accountId: 'acct_ops', requestId: 'req_kill_1' } as any;
const member = { sub: 'owner_1', username: 'owner_1', name: 'Owner', accountId: 'acct_1', requestId: 'req_kill_2' } as any;
const env = { AUTOMATION_OPERATOR_SUBS: 'ops-admin' } as NodeJS.ProcessEnv;

function storeIn(dir: string) {
  const path = join(dir, 'jobs.sqlite');
  new JobStore(path).close();
  return path;
}

test('AUTO-15: only an allowlisted operator can engage the kill switch, and the reason is required', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-killsw-'));
  try {
    const path = storeIn(dir);
    const refused = setKillSwitch(member, { engaged: true, reason: 'owner tries it' }, path, env);
    assert.equal(refused.status, 403);
    assert.equal(refused.data.code, 'OPERATOR_REQUIRED');
    assert.equal(new JobStore(path).killSwitch().engaged, false, 'a refused request changes nothing');

    assert.equal(setKillSwitch(operator, { engaged: true }, path, env).status, 400, 'engaging needs a reason');
    const engaged = setKillSwitch(operator, { engaged: true, reason: 'suspected bad source' }, path, env);
    assert.equal(engaged.status, 200);
    assert.equal((engaged.data.killSwitch as { engaged: boolean }).engaged, true);
    assert.equal(engaged.data.requestId, 'req_kill_1');

    const released = setKillSwitch(operator, { engaged: false }, path, env);
    assert.equal(released.status, 200);
    assert.equal((released.data.killSwitch as { engaged: boolean }).engaged, false);
  } finally { removeTemp(dir); }
});

test('AUTO-15: with no allowlist nobody can change the switch, and a missing job store is an error rather than a new file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-killsw-none-'));
  try {
    const path = storeIn(dir);
    assert.equal(setKillSwitch(operator, { engaged: true, reason: 'x' }, path, {} as NodeJS.ProcessEnv).status, 403);
    const missing = join(dir, 'absent.sqlite');
    assert.equal(setKillSwitch(operator, { engaged: true, reason: 'x' }, missing, env).status, 404);
    assert.equal(existsSync(missing), false, 'a missing store is never created by the route');
  } finally { removeTemp(dir); }
});

test('AUTO-15: the kill-switch route accepts only the switch, its reason and the account', () => {
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/automation-kill-switch', {}, { accountId: 'acct_1', requestKey: 'kill-0001', engaged: true, reason: 'stop' }), undefined);
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/automation-kill-switch', {}, { accountId: 'acct_1', requestKey: 'kill-0002', engaged: true, mandateId: 'x' })?.status, 400);
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/automation-kill-switch', {}, { accountId: 'acct_1', requestKey: 'kill-0003' })?.status, 400, 'engaged is required');
});
