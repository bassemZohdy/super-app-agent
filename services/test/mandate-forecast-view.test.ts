import test from 'node:test';
import assert from 'node:assert/strict';
import { describeForecast } from '../../packages/protocol-core/src/mandate-forecast-view.ts';

test('AUTO-07: the forecast view states the outcome, reasons, amounts and the preview-only guarantee in plain language', () => {
  const view = describeForecast({
    wouldRun: true, blockers: [], source: { id: 'wallet', kind: 'wallet', usable: true }, nextRun: { key: 'INV:2026-11-15', runAt: '2026-11-12T05:00:00.000Z' },
    budget: { period: { usedMinor: 15000, limitMinor: 100000, usedCount: 1, limitCount: 5 }, lifetime: { usedMinor: 15000, limitMinor: 200000, usedCount: 1, limitCount: 20 }, cooldownEndsAt: '2026-11-12T05:01:00.000Z' },
    candidates: [
      { payableId: 'a', label: 'DEWA bill', amountMinor: 15000, dueDate: '2026-11-15', scheduledRunAt: '2026-11-12T05:00:00.000Z', decision: 'DUE_NOW', reasons: [], warnings: ['WALLET_BALANCE_LOW'] },
      { payableId: 'b', label: 'Big bill', amountMinor: 70000, dueDate: '2026-11-20', scheduledRunAt: '2026-11-17T05:00:00.000Z', decision: 'SKIP', reasons: ['OVER_PER_PAYMENT_CAP', 'COOLDOWN'], warnings: [] },
    ],
  });
  assert.equal(view.headline, 'This rule would pay when its run time arrives.');
  assert.equal(view.source, 'Wallet wallet · usable');
  assert.match(view.nextRun, /2026-11-12 05:00 UTC \(INV:2026-11-15\)/);
  assert.equal(view.budget[0], 'This period: AED 150.00 of AED 1000.00 used, 1 of 5 payments');
  assert.ok(view.budget[2]!.startsWith('Cooldown until'));
  assert.deepEqual(view.candidates.map(c => [c.amount, c.outcome]), [['AED 150.00', 'Would be paid at the next run'], ['AED 700.00', 'Would be skipped']]);
  assert.deepEqual(view.candidates[1]!.reasons, ['Above the per-payment cap.', 'Waiting for the cooldown between payments.']);
  assert.deepEqual(view.candidates[0]!.warnings, ['The wallet balance is below this amount; the payment would need your attention.']);
  assert.match(view.note, /nothing was reserved, charged or changed/);
});

test('AUTO-07: blockers, a missing forecast and unknown codes never read as ready to pay', () => {
  const blocked = describeForecast({ wouldRun: false, blockers: ['MANDATE_PAUSED', 'SOMETHING_NEW'], source: { id: 'card_1', kind: 'card', usable: false, reason: 'SOURCE_EXPIRED' }, nextRun: null, candidates: [] });
  assert.equal(blocked.headline, 'This rule would not pay right now.');
  assert.deepEqual(blocked.blockers, ['The rule is paused.', 'Something new.']);
  assert.equal(blocked.source, 'Saved card card_1 · The funding card has expired.');
  assert.equal(blocked.nextRun, 'No further run is scheduled.');
  const empty = describeForecast(undefined);
  assert.equal(empty.headline, 'This rule would not pay right now.');
  assert.deepEqual(empty.candidates, []);
});
