import test from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { inboxFor, runHistory } from '../automation-worker/src/inbox.ts';

// AUTO-14: a held run states what it did to money. An outcome that is not confirmed is never described as "None".
const rule = (occurrenceKey: string) => ({ mandateId: 'mandate_1', policyVersion: 1, occurrenceKey, target: 'dewa:home' });
const owned = new Set(['mandate_1']);

test('AUTO-14: a held unknown outcome says money may have moved, a challenge says nothing moved yet, a skip says None', () => {
  const store = new JobStore(':memory:');
  const unknown = store.enqueue(rule('occ-unknown'), 100), challenge = store.enqueue(rule('occ-challenge'), 200), skipped = store.enqueue(rule('occ-skipped'), 300);
  const claimUnknown = store.claim('w', 30_000, 1_000)!;
  store.transition(claimUnknown, 'HELD', { reason: 'OUTCOME_UNKNOWN' }, { kind: 'HELD', body: { reason: 'OUTCOME_UNKNOWN' } }, 1_000);
  const claimChallenge = store.claim('w', 30_000, 2_000)!;
  store.transition(claimChallenge, 'HELD', { reason: 'REQUIRES_ACTION' }, { kind: 'REQUIRES_ACTION', body: { reason: 'REQUIRES_ACTION' } }, 2_000, 60_000);
  store.enqueueSkipped(rule('occ-skipped'), 'MANDATE_NOT_ACTIVE', 3_000);
  assert.ok(skipped.id);

  const effects = Object.fromEntries(inboxFor(store, owned).map(e => [e.kind, e.effect]));
  assert.match(effects.HELD, /may have moved/, 'an unconfirmed outcome is not described as no effect');
  assert.doesNotMatch(effects.HELD, /^None$/);
  assert.equal(effects.REQUIRES_ACTION, 'Nothing moved yet; waiting for your answer');
  assert.equal(effects.SKIPPED, 'None');

  const history = Object.fromEntries(runHistory(store, 'mandate_1', owned).map(r => [r.occurrenceKey, r.effect]));
  assert.match(history['occ-unknown'], /may have moved/);
  assert.equal(history['occ-skipped'], 'None');
  assert.ok(unknown.id && challenge.id);
  store.close();
});
