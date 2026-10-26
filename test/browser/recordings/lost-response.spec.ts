import { recordedTest as test, expect } from './recorder.ts';

test('lost-response-recovered: the answer is lost after the capture and the original payment is recovered once', async ({ resident, residentApi, stack, scenario, rec }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, police = stack.stores.get('police')!.db;
  const journal = () => payments.prepare("SELECT kind, wallet_delta FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId).map(row => ({ ...row }));
  const claims = () => payments.prepare('SELECT provider, state FROM payment_settlement_claims WHERE account_id=? ORDER BY rowid').all(accountId).map(row => ({ ...row }));
  const fines = () => police.prepare("SELECT body FROM resources WHERE account_id=? AND kind='fine' ORDER BY rowid").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as { status: string });
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  let response = responseFor('billing-accounts');
  await panel.getByRole('button', { name: /^Link Traffic fines/ }).click();
  await response;
  const unpaid = ((await call('overview')).data.payables as Array<{ obligationId: string; kind: string; status: string }>).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  const group = panel.getByRole('group', { name: 'Select traffic fines to pay together', exact: true });
  for (const fine of unpaid) await group.getByRole('checkbox', { name: new RegExp(fine.obligationId) }).check();
  await panel.getByRole('combobox', { name: 'Payment source', exact: true }).selectOption('wallet');
  response = responseFor('fine-selection-preview');
  await group.getByRole('button', { name: 'Review selected fines', exact: true }).click();
  await response;
  response = responseFor('orders');
  await panel.getByRole('button', { name: 'Create authorization review', exact: true }).click();
  const order = (await (await response).json()).order as { id: string };
  const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
  response = responseFor('orders/approve');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).click();
  await response;
  await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
  await article.scrollIntoViewIfNeeded();

  // The operator arms the failpoint; the resident pays; the response never arrives.
  await scenario.controls.arm('checkout.after-capture-commit', 1, `arm_${crypto.randomUUID().slice(0, 12)}`);
  response = responseFor('orders/execute');
  await article.getByRole('button', { name: 'Pay AED 420.00', exact: true }).click();
  await response;
  await article.getByText(/State: RECONCILIATION_REQUIRED · PROVIDER_OUTCOME_UNKNOWN/).waitFor();
  await rec.chapter({ id: 'unknown', kind: 'recovery', title: 'The answer was lost', caption: 'The money was captured but the agency has not confirmed. This is not a receipt, and paying again is blocked.',
    failure: 'the response was lost after the capture committed' }, async () => {
    await rec.assert('one sealed PAYMENT of -42000 already exists', () => expect(journal()).toEqual([{ kind: 'PAYMENT', wallet_delta: -42000 }]));
    await rec.assert('no settlement applied and both fines unpaid at the agency', () => { expect(claims()).toEqual([]); expect(fines().map(f => f.status)).toEqual(['UNPAID', 'UNPAID']); });
    await rec.assert('no confirmed receipt is shown', async () => expect(await article.getByRole('region', { name: /Confirmed .* receipt/ }).count()).toBe(0));
  });

  response = responseFor('orders/recover');
  await article.getByRole('button', { name: 'Inspect or resume payment', exact: true }).click();
  await response;
  await article.getByText('State: SETTLED', { exact: true }).waitFor();
  await article.getByText('Fines paid · AED 420.00', { exact: true }).waitFor();
  await rec.chapter({ id: 'recovered', kind: 'receipt', title: 'Recovered on the original payment', caption: 'The same payment completes once: no second debit, one settlement, both fines paid.' }, async () => {
    await rec.assert('still one PAYMENT of -42000', () => expect(journal()).toEqual([{ kind: 'PAYMENT', wallet_delta: -42000 }]));
    await rec.assert('one applied settlement', () => expect(claims()).toEqual([{ provider: 'police', state: 'APPLIED' }]));
    await rec.assert('both fines PAID', () => expect(fines().map(f => f.status)).toEqual(['PAID', 'PAID']));
    await rec.assert('wallet is AED 1080.00', async () => expect((await call('overview')).data.wallet.balanceMinor).toBe(108000));
  });
});
