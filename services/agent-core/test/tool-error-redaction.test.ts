import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AgentError, digest, quoteFor, type Principal } from '../src/orchestrator/contracts.ts';
import { harness } from './support.ts';

for (const kind of ['payment', 'renewal'] as const) test(`unrecognized ${kind} tool errors do not leak into responses or checkpoints`, async () => {
  const identity = { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as Array<'fines:read' | 'fines:pay' | 'vehicles:read' | 'vehicles:renew'>, expiresAt: Date.now() + 600000 };
  const h = await harness({ identities: [identity] });
  try {
    if (kind === 'renewal') {
      const principal: Principal = { subject: identity.subject, workload: 'super-app-agent', permissions: identity.permissions, expiresAt: identity.expiresAt };
      const quote = quoteFor(h.store.fines(identity.subject)), key = digest({ subject: identity.subject, operation: 'fines.pay.v1', quote }), consentId = randomUUID();
      h.store.consent(consentId, principal, key, quote, Date.now() + 60000);
      h.store.simulatePayment(principal, key, quote, consentId);
    }
    const root = `/api/agent/threads/${await h.thread()}`;
    const review = await h.req(`${root}/messages`, { message: kind === 'payment' ? 'pay fines' : 'renew my car registration' });
    const approval = kind === 'payment' ? review.data.approval : review.data.renewalApproval;
    const secret = `private_${randomBytes(32).toString('hex')}`;
    const fail = async () => { throw new AgentError(secret, 502); };
    if (kind === 'payment') h.tools.pay.invoke = fail; else h.vehicles.renew.invoke = fail;
    const result = await h.req(`${root}/resume`, { approvalId: approval.id, decision: 'approve' });
    assert.equal(result.data.status, 'unknown');
    assert.equal(JSON.stringify(result.data).includes(secret), false);
    assert.equal(JSON.stringify((await h.req(root)).data).includes(secret), false);
    assert.match(result.data.reply, kind === 'payment' ? /PAYMENT_OUTCOME_UNKNOWN/ : /RENEWAL_OUTCOME_UNKNOWN/);
    const other = `/api/agent/threads/${await h.thread()}`;
    assert.equal((await h.req(`${other}/messages`, { message: kind === 'payment' ? 'pay fines' : 'renew my car registration' })).data.status, 'reconciliation_required');
    const tables = h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const rows = h.store.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>;
      for (const row of rows) for (const value of Object.values(row)) {
        if (typeof value === 'string' || Buffer.isBuffer(value)) assert.equal(value.toString().includes(secret), false);
      }
    }
  } finally { await h.close(); }
});
