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

test('QA-02: every journal entry nets to zero, and the clearing accounts match the money that moved', t => {
  const db = new AccountDatabase(':memory:');
  t.after(() => db.close());
  const engine = new ProviderEngine('payments', db);
  db.accounts(actor.sub);
  engine.seed(actor);
  const ledger = engine.ledger!;
  const account = actor.accountId;
  const expiry = Date.now() + 3_600_000;
  ledger.record(account, 'TOPUP', 'qa02-recon-topup', 10000, 'external');
  ledger.reserve(account, 'qa02-recon-hold', 3000, expiry);
  ledger.captureHold(account, 'qa02-recon-hold', 'qa02-recon-payment', 3000);
  ledger.record(account, 'PAYMENT', 'qa02-recon-wallet-payment', 1000, 'wallet');

  const perEntry = db.db.prepare('SELECT e.id AS id, sum(p.amount_minor) AS total FROM payment_journal_postings p JOIN payment_journal_entries e ON e.id=p.entry_id WHERE e.account_id=? GROUP BY e.id').all(account) as { id: string; total: number }[];
  assert.ok(perEntry.length > 0);
  for (const row of perEntry) assert.equal(row.total, 0, `journal ${row.id} nets to zero`);

  const byAccount = Object.fromEntries((db.db.prepare('SELECT p.ledger_account AS account, sum(p.amount_minor) AS total FROM payment_journal_postings p JOIN payment_journal_entries e ON e.id=p.entry_id WHERE e.account_id=? GROUP BY p.ledger_account').all(account) as { account: string; total: number }[]).map(r => [r.account, r.total]));
  const summary = ledger.summary(account);
  assert.equal(byAccount.wallet, summary.balanceMinor, 'the wallet postings are the posted balance');
  assert.equal(byAccount['merchant-clearing'], 3000 + 1000, 'the merchant clearing account holds what was paid out');
  assert.equal(Object.values(byAccount).reduce((a, b) => a + b, 0), 0, 'across all accounts the journal nets to zero');
});
