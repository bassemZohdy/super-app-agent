/** Resident intent: pay my electricity bill from the wallet, keep the receipt, and get a full refund to the original source (QA-04).
 *  The bill is paid from the API (the page flow for paying is covered by the fines journey); the refund is reviewed and approved on the
 *  page. Beside the page the journey asserts the exact ledger journal, the refund record and the utility's own bill record before the
 *  payment, after it, and after the refund, so a receipt on screen cannot hide a missing, doubled or unbalanced effect. */
import { expect, isolatedTest as test } from '../stack.ts';
import { login } from '../stack.ts';

test('a wallet-paid bill is refunded in full to the wallet, and each step leaves exactly its own records', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, dewa = stack.stores.get('dewa')!.db;
  type Entry = { id: string; kind: string; reference: string; wallet_delta: number; finalized: number };
  const journal = () => payments.prepare("SELECT id, kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Entry[];
  const postings = (entry: Entry) => payments.prepare('SELECT line, ledger_account, amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(entry.id);
  const wallet = async () => (await call('overview')).data.wallet as { balanceMinor: number; heldMinor: number; availableMinor: number };
  const currentBill = () => dewa.prepare("SELECT body FROM resources WHERE account_id=? AND kind='bill' ORDER BY rowid").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as Record<string, unknown>).find(bill => String(bill.billId).startsWith('DEWA-'))!;
  const decision = (o: { id: string; version: number; approvalDigest: string }) => ({ orderId: o.id, expectedVersion: o.version, approvalDigest: o.approvalDigest });

  const overview = (await call('overview')).data;
  for (const candidate of overview.candidates) expect((await call('billing-accounts', { provider: candidate.provider, reference: candidate.reference, nickname: String(candidate.label).slice(0, 64) })).status).toBe(200);
  const bill = (await call('overview')).data.payables.find((p: { provider: string; status: string }) => p.provider === 'dewa' && p.status === 'UNPAID');
  expect(bill, 'a linked DEWA bill is unpaid').toBeTruthy();
  const start = { wallet: (await wallet()).balanceMinor, journal: journal().length };
  expect(start.wallet).toBe(150000);
  expect(currentBill()).toMatchObject({ status: 'UNPAID', totalAmount: 420.4, currency: 'AED' });

  // Pay: one sealed, balanced PAYMENT; the utility's bill is PAID against that receipt.
  let order = (await call('orders', { provider: 'dewa', payableId: bill.id, expectedPayableRevision: bill.revision, methodId: 'wallet', expectedMethodVersion: 1 })).data.order;
  order = (await call('orders/approve', decision(order))).data.order;
  order = (await call('orders/execute', decision(order))).data.order;
  expect(order.state).toBe('SETTLED');
  expect(await wallet()).toEqual({ balanceMinor: 107960, heldMinor: 0, availableMinor: 107960, currency: 'AED' } as never);
  let entries = journal();
  expect(entries).toHaveLength(start.journal + 1);
  const payment = entries[start.journal];
  expect([payment.kind, payment.wallet_delta, payment.finalized]).toEqual(['PAYMENT', -42040, 1]);
  expect(postings(payment)).toEqual([{ line: 0, ledger_account: 'wallet', amount_minor: -42040 }, { line: 1, ledger_account: 'merchant-clearing', amount_minor: 42040 }]);
  const paymentId = payment.reference.slice('charge:'.length);
  expect(currentBill()).toMatchObject({ status: 'PAID', receiptNumber: paymentId, payableVersion: 2 });
  const claim = payments.prepare('SELECT provider, state, body FROM payment_settlement_claims WHERE account_id=? AND payment_id=?').all(accountId, paymentId) as Array<{ provider: string; state: string; body: string }>;
  expect(claim).toHaveLength(1);
  expect([claim[0].provider, claim[0].state, JSON.parse(claim[0].body).amountMinor]).toEqual(['dewa', 'APPLIED', 42040]);

  // Review the refund on the page: it moves nothing.
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  const refunds = panel.getByRole('region', { name: 'Payment refunds', exact: true });
  await refunds.waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  await refunds.getByRole('combobox', { name: 'Original payment', exact: true }).selectOption(`PAYMENT:${order.id}`);
  let response = responseFor('refunds');
  await refunds.getByRole('button', { name: 'Review original-source refund', exact: true }).click();
  const created = await response, refund = (await created.json()).refund as { id: string; version: number; approvalDigest: string; quote: { amountMinor: number; source: { id: string } } };
  expect([created.status(), refund.quote.amountMinor, refund.quote.source.id], 'the full amount, back to the original source').toEqual([200, 42040, 'wallet']);
  expect(journal(), 'a refund review writes nothing').toHaveLength(start.journal + 1);
  expect((await wallet()).balanceMinor).toBe(107960);

  // Someone else cannot approve it; the owner approves on the page.
  const article = refunds.getByRole('article', { name: `Refund review ${refund.id}`, exact: true });
  expect((await call('refunds/execute', decision(refund), await login('bassem'))).status, 'another account cannot approve').toBe(403);
  expect(journal()).toHaveLength(start.journal + 1);
  response = responseFor('refunds/execute');
  await article.getByRole('button', { name: /^Approve refund of AED 420\.40$/ }).click();
  const executed = await response;
  expect(executed.status()).toBe(200);
  await article.getByRole('region', { name: 'Confirmed refund receipt', exact: true }).waitFor();

  // The refund: the wallet is whole again, with one sealed, balanced REFUND that mirrors the payment.
  expect(await wallet()).toEqual({ balanceMinor: 150000, heldMinor: 0, availableMinor: 150000, currency: 'AED' } as never);
  entries = journal();
  expect(entries, 'exactly one more journal entry').toHaveLength(start.journal + 2);
  const reversal = entries[start.journal + 1];
  expect([reversal.kind, reversal.reference, reversal.wallet_delta, reversal.finalized]).toEqual(['REFUND', `order-refund:${refund.id}`, 42040, 1]);
  expect(postings(reversal)).toEqual([{ line: 0, ledger_account: 'merchant-clearing', amount_minor: -42040 }, { line: 1, ledger_account: 'wallet', amount_minor: 42040 }]);
  expect(entries.reduce((sum, entry) => sum + entry.wallet_delta, 0), 'payment and refund net to zero').toBe(0);
  expect(payments.prepare("SELECT coalesce(sum(p.amount_minor),0) AS n FROM payment_journal_postings p JOIN payment_journal_entries e ON e.id=p.entry_id WHERE e.account_id=? AND e.finalized=1 AND p.ledger_account='wallet'").get(accountId), 'the journal sums to the wallet').toEqual({ n: 150000 });
  const row = payments.prepare('SELECT origin, order_id, state FROM payment_refunds WHERE id=?').get(refund.id);
  expect(row).toEqual({ origin: 'PAYMENT', order_id: order.id, state: 'REFUNDED' });
  expect(currentBill(), "the utility's bill is cancelled with the reversed amount").toMatchObject({ status: 'CANCELLED', reversedAmountMinor: 42040, refundId: refund.id, receiptNumber: paymentId, payableVersion: 3 });

  // A retry and a reload are not effects, and the refunded payment cannot be refunded again.
  expect((await call('refunds/execute', executed.request().postDataJSON())).data.refund.id).toBe(refund.id);
  expect((await call('refunds/recover', { orderId: refund.id })).data.refund.state).toBe('REFUNDED');
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  expect(journal(), 'a retry and a reload added nothing').toHaveLength(start.journal + 2);
  expect((await wallet()).balanceMinor).toBe(150000);
  const again = await call('refunds', { origin: 'PAYMENT', orderId: order.id, reason: 'Demo service cancellation' });
  expect(again.status, 'a fully refunded payment cannot be refunded twice').toBeGreaterThanOrEqual(400);
  expect(journal()).toHaveLength(start.journal + 2);
});
