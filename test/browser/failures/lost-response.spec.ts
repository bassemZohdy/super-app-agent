/** Resident intent: I paid, the answer never came back (QA-05). The operator of an isolated run arms the named failpoint that loses the
 *  response after the capture commits; the resident pays two fines from the wallet on the page. The journey asserts what the ledger and
 *  the agency actually hold at each step: the unknown outcome blocks a replacement payment, recovery completes the original order once,
 *  and nothing is debited, settled or marked paid twice. */
import { expect, scenarioTest as test } from '../stack.ts';

test('a response lost after the capture is recovered on the original order, once', async ({ resident, residentApi, stack, scenario }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, police = stack.stores.get('police')!.db;
  type Entry = { id: string; kind: string; reference: string; wallet_delta: number; finalized: number };
  const journal = () => payments.prepare("SELECT id, kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Entry[];
  const holds = () => payments.prepare('SELECT reference, amount_minor, status FROM payment_wallet_holds WHERE account_id=? ORDER BY rowid').all(accountId);
  const claims = () => payments.prepare('SELECT payment_id, provider, state FROM payment_settlement_claims WHERE account_id=? ORDER BY rowid').all(accountId);
  const fines = () => police.prepare("SELECT body FROM resources WHERE account_id=? AND kind='fine' ORDER BY rowid").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as { status: string; paidAmount?: number });
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');

  let response = responseFor('billing-accounts');
  await panel.getByRole('button', { name: /^Link Traffic fines/ }).click();
  await response;
  const unpaid = ((await call('overview')).data.payables as Array<{ id: string; obligationId: string; kind: string; status: string; revision: string }>).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  expect(unpaid).toHaveLength(2);
  const group = panel.getByRole('group', { name: 'Select traffic fines to pay together', exact: true });
  for (const fine of unpaid) await group.getByRole('checkbox', { name: new RegExp(fine.obligationId) }).check();
  await panel.getByRole('combobox', { name: 'Payment source', exact: true }).selectOption('wallet');
  response = responseFor('fine-selection-preview');
  await group.getByRole('button', { name: 'Review selected fines', exact: true }).click();
  await response;
  response = responseFor('orders');
  await panel.getByRole('button', { name: 'Create authorization review', exact: true }).click();
  const created = await response, order = (await created.json()).order as { id: string; version: number; approvalDigest: string };
  const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
  response = responseFor('orders/approve');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).click();
  await response;
  await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
  expect(holds()).toEqual([{ reference: order.id, amount_minor: 42000, status: 'ACTIVE' }]);

  // The operator arms the named failpoint; the resident pays; the response is lost after the capture commits.
  await scenario.controls.arm('checkout.after-capture-commit', 1, `arm_${crypto.randomUUID().slice(0, 12)}`);
  response = responseFor('orders/execute');
  await article.getByRole('button', { name: 'Pay AED 420.00', exact: true }).click();
  const lost = await response;
  const unknown = (await lost.json()).order as { id: string; state: string; failureCode?: string; reconciliation?: unknown };
  expect(lost.status(), 'the answer is an unknown outcome on the order, not an error the page could mistake for a failure').toBe(200);
  expect(unknown.id).toBe(order.id);
  expect(unknown.state).toBe('RECONCILIATION_REQUIRED');
  await article.getByText(/State: RECONCILIATION_REQUIRED · PROVIDER_OUTCOME_UNKNOWN/).waitFor();
  await article.getByText('Funds captured; this is not yet a confirmed payment receipt.').waitFor();
  expect(await article.getByRole('region', { name: /Confirmed .* receipt/ }).count(), 'no receipt is shown for an unconfirmed payment').toBe(0);

  // What actually exists now: the capture is real, nothing is settled with the agency, and the failpoint is spent.
  const afterLoss = journal();
  expect(afterLoss, 'one sealed payment for the reviewed total').toHaveLength(1);
  expect([afterLoss[0].kind, afterLoss[0].wallet_delta, afterLoss[0].finalized]).toEqual(['PAYMENT', -42000, 1]);
  expect(holds(), 'the hold was consumed by the capture').toEqual([{ reference: order.id, amount_minor: 42000, status: 'VOIDED' }]);
  expect(claims(), 'no settlement has been applied yet').toEqual([]);
  expect(fines().map(fine => fine.status), 'the agency still shows both fines unpaid').toEqual(['UNPAID', 'UNPAID']);
  expect((await scenario.controls.status()).armed!.find(point => point.name === 'checkout.after-capture-commit')).toMatchObject({ fired: 1, remaining: 0 });
  expect((await call('overview')).data.wallet).toMatchObject({ balanceMinor: 108000, heldMinor: 0 });

  // Not a blind retry: executing the same order again, or paying the same fines on a new order, is refused and changes nothing.
  const replay = await call('orders/execute', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
  expect([replay.status, replay.data.order?.state ?? replay.data.code], 'a replay does not charge again').not.toEqual([200, 'SETTLED']);
  expect(journal(), 'no second debit').toHaveLength(1);
  const replacement = await call('orders', { provider: 'police', payableId: unpaid[0].id, expectedPayableRevision: unpaid[0].revision, methodId: 'wallet', expectedMethodVersion: 1 });
  expect(replacement.status, 'a replacement order for work that may already be paid is blocked').toBeGreaterThanOrEqual(400);
  expect(journal()).toHaveLength(1);
  expect((await call('overview')).data.wallet.balanceMinor).toBe(108000);

  // Recovery on the original order: the resident resumes it on the page.
  response = responseFor('orders/recover');
  await article.getByRole('button', { name: 'Inspect or resume payment', exact: true }).click();
  const recovered = await response, settled = (await recovered.json()).order as { id: string; state: string; paymentId: string; receipt: { amountMinor: number } };
  expect([recovered.status(), settled.id, settled.state, settled.receipt.amountMinor], 'the same order completes').toEqual([200, order.id, 'SETTLED', 42000]);
  await article.getByText('State: SETTLED', { exact: true }).waitFor();
  await article.getByText('Fines paid · AED 420.00', { exact: true }).waitFor();
  await article.getByText(`Receipt ${settled.paymentId}`, { exact: true }).waitFor();

  // Exactly one of everything: the debit that already existed, one settlement, both fines paid once against the one receipt.
  const entries = journal();
  expect(entries, 'recovery wrote no second journal entry').toHaveLength(1);
  expect(entries[0].reference).toBe(`charge:${settled.paymentId}`);
  expect(holds()).toEqual([{ reference: order.id, amount_minor: 42000, status: 'VOIDED' }]);
  expect(claims()).toEqual([{ payment_id: settled.paymentId, provider: 'police', state: 'APPLIED' }]);
  expect(fines().map(fine => [fine.status, fine.paidAmount])).toEqual([['PAID', 270], ['PAID', 150]]);
  expect(await call('overview').then(r => r.data.wallet)).toEqual({ balanceMinor: 108000, heldMinor: 0, availableMinor: 108000, currency: 'AED' });

  // Recovering again, or replaying the payment, is the same result and changes nothing.
  expect((await call('orders/recover', { orderId: order.id })).data.order.paymentId).toBe(settled.paymentId);
  const again = await call('orders/execute', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest });
  expect([200, 409]).toContain(again.status);
  expect(journal()).toHaveLength(1);
  expect(claims()).toHaveLength(1);
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1080.00', { exact: true }).waitFor();
  expect(journal(), 'a reload is not an effect').toHaveLength(1);
});
