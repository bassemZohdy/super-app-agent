/** Resident intent: pay my traffic fines (QA-04). Link the fines account, select both unpaid fines, review one order from the wallet,
 *  authorize, pay. Beside the page, the journey asserts the exact wallet hold, the ledger journal, the settlement claims and the
 *  police provider's own fine records, so "paid" on screen is proved against the money and the agency's books. */
import { expect, isolatedTest as test } from '../stack.ts';
import { login } from '../stack.ts';

test('both unpaid fines are paid once from the wallet, and every effect is exact', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, police = stack.stores.get('police')!.db;
  const journal = () => payments.prepare("SELECT id, kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Array<{ id: string; kind: string; reference: string; wallet_delta: number; finalized: number }>;
  const holds = () => payments.prepare('SELECT reference, amount_minor, status FROM payment_wallet_holds WHERE account_id=? ORDER BY rowid').all(accountId) as Array<{ reference: string; amount_minor: number; status: string }>;
  const claims = () => payments.prepare('SELECT * FROM payment_settlement_claims WHERE account_id=? ORDER BY rowid').all(accountId);
  const fines = () => police.prepare("SELECT body FROM resources WHERE account_id=? AND kind='fine' ORDER BY rowid").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as { fineId: string; payableAmount: number; status: string; paidAmount?: number; receiptNumber?: string });

  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');

  let response = responseFor('billing-accounts');
  await panel.getByRole('button', { name: /^Link Traffic fines/ }).click();
  await response;
  const unpaid = ((await call('overview')).data.payables as Array<{ id: string; obligationId: string; kind: string; status: string; revision: string }>).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  expect(unpaid).toHaveLength(2);
  const before = { journal: journal().length, holds: holds().length, claims: claims().length, fines: fines() };
  expect(before.fines.filter(fine => fine.status === 'UNPAID')).toHaveLength(2);

  const group = panel.getByRole('group', { name: 'Select traffic fines to pay together', exact: true });
  for (const fine of unpaid) await group.getByRole('checkbox', { name: new RegExp(fine.obligationId) }).check();
  await panel.getByRole('combobox', { name: 'Payment source', exact: true }).selectOption('wallet');
  response = responseFor('fine-selection-preview');
  await group.getByRole('button', { name: 'Review selected fines', exact: true }).click();
  const preview = (await (await response).json()).preview as { totalMinor: number; payable: { items: unknown[] } };
  expect([preview.totalMinor, preview.payable.items.length]).toEqual([42000, 2]);
  expect(journal().length, 'a preview writes nothing').toBe(before.journal);

  // A duplicate or stale selection is refused and changes nothing.
  expect((await call('fine-selection-preview', { items: [{ payableId: unpaid[0].id, expectedRevision: unpaid[0].revision }, { payableId: unpaid[0].id, expectedRevision: unpaid[0].revision }], methodId: 'wallet', expectedMethodVersion: 1 })).status).toBe(400);
  expect((await call('fine-selection-preview', { items: [{ payableId: unpaid[0].id, expectedRevision: 'a'.repeat(64) }], methodId: 'wallet', expectedMethodVersion: 1 })).status).toBe(409);

  response = responseFor('orders');
  await panel.getByRole('button', { name: 'Create authorization review', exact: true }).click();
  const created = await response, order = (await created.json()).order as { id: string; version: number; approvalDigest: string };
  const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
  expect((await call('orders', created.request().postDataJSON())).data.order.id, 'an exact retry returns the same review').toBe(order.id);
  expect((await call('orders', { ...created.request().postDataJSON(), requestKey: crypto.randomUUID() })).status, 'a second review of the same fines is refused').toBe(409);
  expect((await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest }, await login('bassem'))).status, 'another account cannot approve').toBe(403);
  expect((await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: 'a'.repeat(64) })).status, 'a wrong digest').toBe(409);

  response = responseFor('orders/approve');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).click();
  await response;
  await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
  expect((await call('overview')).data.wallet.balanceMinor, 'an authorization alone does not debit').toBe(150000);
  // Authorized: the funds are held for this order, and nothing is in the journal, with the agency, or settled yet.
  expect(holds(), 'one active hold for exactly the reviewed total').toEqual([{ reference: order.id, amount_minor: 42000, status: 'ACTIVE' }]);
  expect(journal().length).toBe(before.journal);
  expect(claims()).toHaveLength(before.claims);
  expect(fines().every(fine => fine.status === 'UNPAID'), 'the agency still shows both fines unpaid').toBe(true);

  response = responseFor('orders/execute');
  await article.getByRole('button', { name: 'Pay AED 420.00', exact: true }).click();
  const executed = await response, paid = (await executed.json()).order as { state: string; receipt: { amountMinor: number } };
  expect([executed.status(), paid.state, paid.receipt.amountMinor]).toEqual([200, 'SETTLED', 42000]);

  // The API outcome.
  expect((await call('overview')).data.wallet).toEqual({ balanceMinor: 108000, heldMinor: 0, availableMinor: 108000, currency: 'AED' });

  // The exact wallet and ledger effect: the hold is released, and one sealed, balanced PAYMENT replaces it.
  expect(holds(), 'the hold is voided, not left active').toEqual([{ reference: order.id, amount_minor: 42000, status: 'VOIDED' }]);
  const entries = journal();
  expect(entries, 'exactly one new journal entry').toHaveLength(before.journal + 1);
  expect([entries[0].kind, entries[0].wallet_delta, entries[0].finalized]).toEqual(['PAYMENT', -42000, 1]);
  expect(entries[0].reference).toMatch(/^charge:payment_/);
  expect(payments.prepare('SELECT line, ledger_account, amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(entries[0].id))
    .toEqual([{ line: 0, ledger_account: 'wallet', amount_minor: -42000 }, { line: 1, ledger_account: 'merchant-clearing', amount_minor: 42000 }]);
  const paymentId = entries[0].reference.slice('charge:'.length);

  // The exact provider effect: one applied settlement claim for the reviewed total, and the agency's own records show both fines paid.
  const settled = claims() as Array<{ payment_id: string; provider: string; state: string; body: string }>;
  expect(settled).toHaveLength(before.claims + 1);
  expect([settled[0].payment_id, settled[0].provider, settled[0].state]).toEqual([paymentId, 'police', 'APPLIED']);
  expect(JSON.parse(settled[0].body)).toMatchObject({ amountMinor: 42000, currency: 'AED', orderId: order.id });
  const agency = fines();
  expect(agency.map(fine => [fine.status, fine.paidAmount])).toEqual([['PAID', 270], ['PAID', 150]]);
  expect(new Set(agency.map(fine => fine.receiptNumber)), 'both fines name the same receipt').toEqual(new Set([paymentId]));

  // A retry is the same order and the same single effect; a reload is not an effect.
  expect((await call('orders/execute', executed.request().postDataJSON())).data.order.state).toBe('SETTLED');
  expect(journal()).toHaveLength(before.journal + 1);
  expect(claims()).toHaveLength(before.claims + 1);
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1080.00', { exact: true }).waitFor();
  expect(journal(), 'a reload writes nothing').toHaveLength(before.journal + 1);

  // A paid fine cannot be paid again.
  expect((await call('fine-selection-preview', { items: [{ payableId: unpaid[0].id, expectedRevision: unpaid[0].revision }], methodId: 'wallet', expectedMethodVersion: 1 })).status, 'a paid fine is no longer payable').toBeGreaterThanOrEqual(400);
  expect(journal()).toHaveLength(before.journal + 1);
});
