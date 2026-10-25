import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { automationInbox } from '../agent-core/src/automation-inbox.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// AUTO-14 step 3: the owner's inbox feed returns only entries for rules the signed-in owner holds, with the
// request's correlation id. Polling replaces streaming for the demo; a missing job store is an empty inbox.
const owner = { sub: 'owner_1', username: 'owner_1', name: 'Owner', accountId: 'acct_1', requestId: 'req_feed_1' } as any;
const rule = (mandateId: string, occurrenceKey = 'occ_2026_11') => ({ mandateId, policyVersion: 1, occurrenceKey, target: 'dewa:home' });
const cleanup = (dir: string) => { try { removeTemp(dir); } catch { /* Windows may briefly hold the directory */ } };
const provider = (mandates: string[]) => async (_p: string, _a: unknown, _m: string, path: string) => {
  assert.equal(path, '/payment-mandates', 'the owned set comes from the owner-scoped mandate list');
  return { mandates: mandates.map(id => ({ id })) };
};

test('AUTO-14: the inbox returns only the signed-in owner\'s rules, with the request correlation id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-inbox-feed-')), path = join(dir, 'jobs.sqlite');
  try {
    const store = new JobStore(path);
    store.enqueueSkipped(rule('mandate_mine'), 'FINE_REQUIRES_REVIEW');
    store.enqueueSkipped(rule('mandate_other'), 'FINE_REQUIRES_REVIEW');
    store.close();
    const feed = await automationInbox(owner, provider(['mandate_mine']), path);
    assert.equal(feed.requestId, 'req_feed_1');
    assert.deepEqual(feed.entries.map(e => e.mandateId), ['mandate_mine']);
    assert.equal(feed.entries[0].kind, 'SKIPPED');
    assert.equal(feed.entries[0].reason, 'FINE_REQUIRES_REVIEW');
  } finally { cleanup(dir); }
});

test('AUTO-14: an account with no rules, or no job store yet, sees an empty inbox and creates no store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-inbox-empty-')), path = join(dir, 'jobs.sqlite');
  try {
    assert.deepEqual((await automationInbox(owner, provider([]), path)).entries, []);
    assert.deepEqual((await automationInbox(owner, provider(['mandate_mine']), path)).entries, []);
    assert.equal(existsSync(path), false, 'reading the inbox never creates the worker\'s store');
  } finally { cleanup(dir); }
});

test('AUTO-14: switching account changes the owned set, so another owner\'s entries never appear', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-inbox-switch-')), path = join(dir, 'jobs.sqlite');
  try {
    const store = new JobStore(path);
    store.enqueueSkipped(rule('mandate_a'), 'FINE_REQUIRES_REVIEW');
    store.enqueueSkipped(rule('mandate_b'), 'OVER_PER_PAYMENT_CAP');
    store.close();
    const asA = await automationInbox(owner, provider(['mandate_a']), path);
    const asB = await automationInbox(owner, provider(['mandate_b']), path);
    assert.deepEqual(asA.entries.map(e => e.mandateId), ['mandate_a']);
    assert.deepEqual(asB.entries.map(e => e.mandateId), ['mandate_b']);
  } finally { cleanup(dir); }
});

test('AUTO-14: the inbox route accepts only the account query and rejects anything else', () => {
  assert.equal(validateRequest('agent-core', 'GET', '/api/payments/automation-inbox', { accountId: 'acct_1' }, {}), undefined);
  assert.equal(validateRequest('agent-core', 'GET', '/api/payments/automation-inbox', { accountId: 'acct_1', mandateId: 'x' }, {})?.status, 400);
});

test('AUTO-14: a held challenge entry names its order, so the owner can answer it from the inbox', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-inbox-order-')), path = join(dir, 'jobs.sqlite');
  try {
    const store = new JobStore(path);
    store.enqueue(rule('mandate_mine'));
    const claim = store.claim('worker-a', 30_000)!;
    store.transition(claim, 'HELD', { reason: 'REQUIRES_ACTION' }, { kind: 'REQUIRES_ACTION', body: { reason: 'REQUIRES_ACTION', orderId: 'order_held_1' } });
    store.close();
    const [entry] = (await automationInbox(owner, provider(['mandate_mine']), path)).entries;
    assert.equal(entry.kind, 'REQUIRES_ACTION');
    assert.equal(entry.orderId, 'order_held_1');
  } finally { cleanup(dir); }
});
