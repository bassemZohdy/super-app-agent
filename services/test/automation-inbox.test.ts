import test from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { inboxFor, runHistory, inboxHeadline } from '../automation-worker/src/inbox.ts';

// AUTO-14: every outcome is explained once, with its reason, rule version and effect, and only owned rules are visible.
const rule = { mandateId: 'mandate_mine', policyVersion: 2, occurrenceKey: 'CAL:2026-11', target: 'du-home' };
const others = { mandateId: 'mandate_theirs', policyVersion: 1, occurrenceKey: 'CAL:2026-11', target: 'du-other' };

test('AUTO-14: a settled run and a skipped run each appear once, with reason, version and effect', () => {
  const store = new JobStore(':memory:');
  const settled = store.enqueue(rule, 1000);
  const claim = store.claim('w1', 30_000, 2000)!;
  store.transition(claim, 'PREPARING', {}, undefined, 2000);
  store.transition(claim, 'PREPARED', { runId: 'r', executionId: 'e', orderId: 'o' }, { kind: 'PREPARED', body: { orderId: 'o' } }, 2100);
  store.transition(claim, 'SETTLED', {}, { kind: 'SETTLED', body: { orderId: 'o' } }, 2200);
  store.enqueueSkipped({ ...rule, occurrenceKey: 'CAL:2026-10' }, 'MISSED_CATCH_UP', 500);
  const owned = new Set(['mandate_mine']);
  const inbox = inboxFor(store, owned);
  assert.deepEqual(inbox.map(e => [e.kind, e.occurrenceKey, e.policyVersion, e.reason ?? null]), [
    ['SKIPPED', 'CAL:2026-10', 2, 'MISSED_CATCH_UP'],
    ['PREPARED', 'CAL:2026-11', 2, null],
    ['SETTLED', 'CAL:2026-11', 2, null],
  ]);
  assert.equal(inbox.find(e => e.kind === 'SETTLED')!.effect, 'Money moved once, as approved');
  assert.equal(inbox.find(e => e.kind === 'SKIPPED')!.effect, 'None');
  assert.equal(inboxHeadline('SETTLED'), 'Payment completed');
  assert.ok(settled.id);
});

test('AUTO-14: re-deriving the inbox never duplicates a notification', () => {
  const store = new JobStore(':memory:');
  store.enqueue(rule, 1000);
  const claim = store.claim('w1', 30_000, 2000)!;
  store.transition(claim, 'PREPARING', {}, undefined, 2000);
  store.transition(claim, 'HELD', { reason: 'CREDENTIAL_UNKNOWN' }, { kind: 'HELD', body: { reason: 'CREDENTIAL_UNKNOWN' } }, 2100);
  store.recordNotice(rule.mandateId, 'CAL:2026-12', 'UPCOMING_RUN', { policyVersion: 2, runAt: '2026-12-31T05:00:00.000Z' }, 2200);
  store.recordNotice(rule.mandateId, 'CAL:2026-12', 'UPCOMING_RUN', { policyVersion: 2, runAt: '2026-12-31T05:00:00.000Z' }, 2300);
  const owned = new Set([rule.mandateId]);
  const first = inboxFor(store, owned), second = inboxFor(store, owned);
  assert.deepEqual(second, first);
  assert.equal(first.filter(e => e.kind === 'UPCOMING_RUN').length, 1, 'a repeated reminder is one notification');
  assert.equal(first.filter(e => e.kind === 'HELD').length, 1);
  assert.equal(first.find(e => e.kind === 'HELD')!.reason, 'CREDENTIAL_UNKNOWN');
});

test('AUTO-14: only the owner\'s rules are visible, in the inbox and in run history', () => {
  const store = new JobStore(':memory:');
  store.enqueue(rule, 1000);
  store.enqueue(others, 1000);
  store.recordNotice(others.mandateId, 'CAL:2026-12', 'UPCOMING_RUN', { policyVersion: 1 }, 1100);
  const owned = new Set([rule.mandateId]);
  const inbox = inboxFor(store, owned);
  assert.ok(inbox.every(e => e.mandateId === rule.mandateId), 'no other account\'s entries');
  assert.deepEqual(inboxFor(store, new Set()), [], 'no owned rules, no entries');
  assert.deepEqual(runHistory(store, others.mandateId, owned), [], 'another owner\'s history is not readable');
  assert.equal(runHistory(store, rule.mandateId, owned).length, 1);
});
