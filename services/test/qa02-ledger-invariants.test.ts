import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

// QA-02: holds, captures and voids keep available = posted - held at every step, a refused hold changes nothing, and
// a capture moves exactly its amount out of the wallet.
const actor = actorFor({ sub: 'qa02-owner' });

test('QA-02: holds, captures and voids keep available = posted - held and never overdraw the wallet', t => {
  const db = new AccountDatabase(':memory:');
  t.after(() => db.close());
  const engine = new ProviderEngine('payments', db);
  db.accounts(actor.sub);
  engine.seed(actor);
  const ledger = engine.ledger!;
  const account = actor.accountId;
  const expiry = Date.now() + 3_600_000;
  const snap = () => ledger.summary(account);
  const start = snap().balanceMinor;

  ledger.record(account, 'TOPUP', 'qa02-topup', 10000, 'external');
  assert.equal(snap().balanceMinor, start + 10000);

  ledger.reserve(account, 'qa02-hold-1', 3000, expiry);
  ledger.reserve(account, 'qa02-hold-2', 2000, expiry);
  let s = snap();
  assert.equal(s.heldMinor, 5000);
  assert.equal(s.availableMinor, s.balanceMinor - s.heldMinor);

  assert.throws(() => ledger.reserve(account, 'qa02-hold-3', s.availableMinor + 1, expiry), /Insufficient/);
  assert.deepEqual(snap(), s, 'a refused hold changes nothing');

  ledger.captureHold(account, 'qa02-hold-1', 'qa02-payment-1', 3000);
  s = snap();
  assert.equal(s.balanceMinor, start + 7000, 'the capture moved exactly its amount');
  assert.equal(s.heldMinor, 2000);
  assert.equal(s.availableMinor, s.balanceMinor - s.heldMinor);

  ledger.voidHold(account, 'qa02-hold-2');
  s = snap();
  assert.equal(s.heldMinor, 0);
  assert.equal(s.balanceMinor, start + 7000, 'a void moves no money');
  assert.equal(s.availableMinor, s.balanceMinor);
});
