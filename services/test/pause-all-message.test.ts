import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseAllMessage } from '../../apps/shell-react/src/pause-all-message.ts';

test('pause-all feedback distinguishes confirmed pauses and uncertain outcomes', () => {
  assert.match(pauseAllMessage({ success: true, paused: ['a'], notPaused: [] }), /^Paused 1 rule\./);
  const partial = pauseAllMessage({ success: true, paused: ['a'], notPaused: [{ mandateId: 'b', code: 'PAUSE_UNCONFIRMED' }] });
  assert.match(partial, /1 rule.*could not be confirmed/i);
  assert.match(partial, /may already be paused/i);
  assert.match(partial, /check.*current.*state/i);
  assert.doesNotMatch(partial, /unchanged/i);
  const refused = pauseAllMessage({ success: true, paused: [], notPaused: [{ mandateId: 'b', code: 'MANDATE_CHANGED' }] });
  assert.match(refused, /could not be confirmed/i);
  for (const value of [undefined, {}, { success: false, paused: [], notPaused: [] }, { success: true, paused: [], notPaused: 'bad' }, { success: true, paused: [null], notPaused: [] }]) {
    assert.match(pauseAllMessage(value), /could not be confirmed/i);
    assert.doesNotMatch(pauseAllMessage(value), /^Paused 0 rules\./);
  }
});
