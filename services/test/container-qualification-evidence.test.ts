import test from 'node:test';
import assert from 'node:assert/strict';
import { assertApprovalReplay, assertPaymentCount, describeBuildSource } from '../../scripts/qualification-evidence.ts';

test('container qualification requires an actual replay receipt and a rejected new approval', () => {
  const receipt = { id: 'receipt-1', amountMinor: 45000 };
  const same = { status: 200, data: { receipt } }, fresh = { status: 409, data: { code: 'APPROVAL_USED' } };
  assert.doesNotThrow(() => assertApprovalReplay(receipt, same, fresh));
  for (const invalid of [
    { ...same, status: 503 }, { ...same, data: {} }, { ...same, data: { receipt: null } },
    { ...same, data: { receipt: { ...receipt, id: 'other' } } },
  ]) assert.throws(() => assertApprovalReplay(receipt, invalid, fresh));
  for (const invalid of [{ ...fresh, status: 200 }, { ...fresh, status: 400 }, { ...fresh, status: 500 }]) assert.throws(() => assertApprovalReplay(receipt, same, invalid));
  assert.throws(() => assertApprovalReplay(undefined, same, fresh));
});


test('container qualification requires an exact stored payment count', () => {
  assert.doesNotThrow(() => assertPaymentCount('0', 0));
  assert.doesNotThrow(() => assertPaymentCount('1', 1));
  for (const invalid of ['0', '2', '', '1\n2', '01']) assert.throws(() => assertPaymentCount(invalid, 1));
});


test('container qualification describes dirty or changing checkout state without exposing paths', () => {
  const revision = 'a'.repeat(40), other = 'b'.repeat(40);
  const clean = { revision, dirty: false }, changed = { revision, dirty: true };
  assert.match(describeBuildSource(clean, clean), /clean before and after/);
  assert.match(describeBuildSource(changed, changed), /uncommitted changes/);
  assert.match(describeBuildSource(clean, changed), /uncommitted changes/);
  assert.match(describeBuildSource(clean, { revision: other, dirty: false }), /changed during the build/);
  assert.throws(() => describeBuildSource({ revision: 'not-a-revision', dirty: false }, clean));
});
