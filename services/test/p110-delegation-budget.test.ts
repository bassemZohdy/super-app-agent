import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantStore } from '../delegation/src/store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { brokerClient, digest, tokenHash, type GrantInput } from '../delegation/src/policy.ts';
const owner = 'budget-owner';
/** The approved synthetic wallet credit: AED 1–10 per operation. A budget bounds the total across its operations. */
const credit = (amountMinor: number, extra: Partial<GrantInput> = {}): GrantInput => ({
  accountId: accountIdFor(owner), provider: 'payments', method: 'POST', path: '/topups',
  body: { amountMinor, source: 'demo_approved' }, purpose: 'Top up the wallet under a budget',
  expiresInSeconds: 300, maxOperations: 1, ...extra,
});
function admit(store: GrantStore, grant: ReturnType<GrantStore['create']>, fingerprint: string) {
  const { job } = store.start(grant.id, `request-${fingerprint}`);
  store.bind(tokenHash(fingerprint), { grantId: grant.id, version: grant.version, sub: grant.owner, actor: brokerClient, exp: Math.floor(Date.now() / 1000) + 60, operationId: job.id, requestDigest: digest({ provider: grant.provider, method: grant.method, path: grant.path, body: grant.body }) });
  return job;
}
const authorize = (store: GrantStore, grant: ReturnType<GrantStore['create']>, fingerprint: string) =>
  store.authorize(tokenHash(fingerprint), grant.owner, brokerClient, grant.accountId, { provider: grant.provider, method: grant.method, path: grant.path, body: grant.body });

test('P1-10: consent carries an optional spending budget for the approved wallet credit only', () => {
  const s = new GrantStore(':memory:');
  try {
    const made = s.create(owner, credit(300, { maxOperations: 3, budgetMinor: 700 }));
    assert.equal(made.budgetMinor, 700);
    assert.equal(made.spentMinor, 0);
    assert.throws(() => s.create(owner, credit(300, { budgetMinor: 200 })), /budget must cover/, 'one operation above the whole budget is refused at consent time');
    assert.throws(() => s.create(owner, credit(300, { maxOperations: 2, budgetMinor: 10001 })), /budget/, 'the budget stays inside the bounded demo credit scale');
    assert.throws(() => s.create(owner, { ...credit(300, { maxOperations: 2, budgetMinor: 700 }), method: 'GET', path: '/wallet', body: {} } as GrantInput), /budget/, 'a read operation carries no budget');
    assert.throws(() => s.create(owner, { ...credit(300, { maxOperations: 2, budgetMinor: 700 }), provider: 'dewa', path: '/bills' } as GrantInput), /budget/, 'no budget outside the approved credit');
    assert.throws(() => s.create(owner, credit(300, { maxOperations: 2 })), /Only one explicitly approved/, 'repeating the credit still needs an explicit budget');
    assert.throws(() => s.create(owner, credit(300, { budgetMinor: 700 })), /more than one operation/, 'a budget exists to repeat the credit');
  } finally { s.close(); }
});

test('P1-10: authorization enforces the cumulative budget and moves nothing when it is reached', () => {
  const s = new GrantStore(':memory:');
  try {
    const g = s.create(owner, credit(300, { maxOperations: 3, budgetMinor: 700 }));
    for (const [fingerprint, expected] of [['bearer-0001', 300], ['bearer-0002', 600]] as const) {
      const job = admit(s, g, fingerprint);
      authorize(s, g, fingerprint);
      s.finish(job, { success: true }, true);
      assert.equal(s.get(g.id).spentMinor, expected);
    }
    assert.equal(s.get(g.id).used, 2);
    const third = admit(s, g, 'bearer-0003');
    assert.throws(() => authorize(s, g, 'bearer-0003'), /budget/);
    assert.equal(s.get(g.id).spentMinor, 600, 'a refused operation spends nothing');
    assert.equal(s.get(g.id).used, 2, 'a refused operation uses no operation');
    assert.equal(s.db.prepare('SELECT state FROM jobs WHERE id=?').get(third.id)?.state, 'pending', 'the refused operation stays pending for inspection');
    assert.ok(s.history(g.id, owner).some(event => event.event === 'execution.authorized' && event.body.spentMinor === 600), 'the audit names what was spent');
  } finally { s.close(); }
});

test('P1-10: narrowing may lower the budget but never below what was spent, and never upward', () => {
  const s = new GrantStore(':memory:');
  try {
    const g = s.create(owner, credit(300, { maxOperations: 3, budgetMinor: 700 }));
    const job = admit(s, g, 'bearer-0001');
    authorize(s, g, 'bearer-0001'); s.finish(job, { success: true }, true);
    const narrowed = s.narrow(g.id, owner, { maxOperations: 3, expiresAt: Date.now() + 60000, budgetMinor: 600 });
    assert.equal(narrowed.budgetMinor, 600);
    assert.equal(narrowed.version, 2);
    assert.throws(() => s.narrow(g.id, owner, { maxOperations: 3, expiresAt: narrowed.expiresAt, budgetMinor: 250 }), /spent/, 'the budget cannot fall below what was already spent');
    assert.throws(() => s.narrow(g.id, owner, { maxOperations: 3, expiresAt: narrowed.expiresAt, budgetMinor: 700 }), /raised/, 'the budget never grows back');
    const afterNarrow = s.get(g.id);
    const second = admit(s, afterNarrow, 'bearer-0002');
    authorize(s, afterNarrow, 'bearer-0002'); s.finish(second, { success: true }, true);
    assert.equal(s.get(g.id).spentMinor, 600);
    assert.throws(() => { admit(s, s.get(g.id), 'bearer-0003'); authorize(s, s.get(g.id), 'bearer-0003'); }, /budget/);
  } finally { s.close(); }
});

test('P1-10: a grant without a budget behaves exactly as before and tracks nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p110-'));
  const s = new GrantStore(`${dir}/grants.sqlite`);
  try {
    const g = s.create(owner, credit(300));
    assert.equal(g.budgetMinor, undefined);
    const job = admit(s, g, 'bearer-0001');
    authorize(s, g, 'bearer-0001'); s.finish(job, { success: true }, true);
    assert.equal(s.get(g.id).spentMinor, 0, 'no budget means no spent tracking');
    const reread = new GrantStore(`${dir}/grants.sqlite`);
    try { assert.equal(reread.get(g.id).maxOperations, 1); assert.equal(reread.get(g.id).budgetMinor, undefined); }
    finally { reread.close(); }
    assert.ok(s.history(g.id, owner).some(event => event.event === 'consent.created' && event.body.budgetMinor === undefined));
  } finally { s.close(); removeTemp(dir); }
});
