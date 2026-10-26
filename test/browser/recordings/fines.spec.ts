import { recordedTest as test, expect } from './recorder.ts';

test('fines-paid-from-wallet: two traffic fines are reviewed, authorized and paid from the wallet', async ({ resident, residentApi, stack, rec }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db, police = stack.stores.get('police')!.db;
  const journal = () => payments.prepare("SELECT kind, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId).map(row => ({ ...row }));
  const holds = () => payments.prepare('SELECT amount_minor, status FROM payment_wallet_holds WHERE account_id=? ORDER BY rowid').all(accountId).map(row => ({ ...row }));
  const fines = () => police.prepare("SELECT body FROM resources WHERE account_id=? AND kind='fine' ORDER BY rowid").all(accountId).map(row => JSON.parse(String((row as { body: string }).body)) as { status: string });
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();

  await rec.chapter({ id: 'start', kind: 'state', title: 'Before paying', caption: 'The wallet holds AED 1500.00 and the ledger has no payment yet.' }, async () => {
    await rec.assert('wallet is AED 1500.00', async () => expect((await call('overview')).data.wallet.balanceMinor).toBe(150000));
    await rec.assert('no journal entry', () => expect(journal()).toEqual([]));
  });

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
  await article.scrollIntoViewIfNeeded();

  await rec.chapter({ id: 'review', kind: 'review', title: 'The review', caption: 'Both fines, the exact total and the wallet as the source. Nothing has moved yet.' }, async () => {
    await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).waitFor();
    await rec.assert('review quotes AED 420.00', async () => expect((await call('overview')).data.orders.find((o: { id: string }) => o.id === order.id).quote.totalMinor).toBe(42000));
    await rec.assert('no journal entry and no hold yet', () => { expect(journal()).toEqual([]); expect(holds()).toEqual([]); });
    await rec.assert('both fines still unpaid at the agency', () => expect(fines().map(f => f.status)).toEqual(['UNPAID', 'UNPAID']));
  });

  response = responseFor('orders/approve');
  await article.getByRole('button', { name: 'Approve authorization for AED 420.00', exact: true }).click();
  await response;
  await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
  await rec.chapter({ id: 'authorized', kind: 'state', title: 'Authorized', caption: 'The wallet holds AED 420.00 for this payment. It is reserved, not spent.' }, async () => {
    await rec.assert('one active hold of 42000', () => expect(holds()).toEqual([{ amount_minor: 42000, status: 'ACTIVE' }]));
    await rec.assert('still no journal entry', () => expect(journal()).toEqual([]));
  });

  response = responseFor('orders/execute');
  await article.getByRole('button', { name: 'Pay AED 420.00', exact: true }).click();
  await response;
  await article.getByText('State: SETTLED', { exact: true }).waitFor();
  await article.getByText('Fines paid · AED 420.00', { exact: true }).waitFor();
  await rec.chapter({ id: 'receipt', kind: 'receipt', title: 'The receipt', caption: 'One payment of AED 420.00 in the ledger, the hold released, both fines paid at the agency.' }, async () => {
    await rec.assert('one sealed PAYMENT of -42000', () => expect(journal()).toEqual([{ kind: 'PAYMENT', wallet_delta: -42000, finalized: 1 }]));
    await rec.assert('the hold is consumed', () => expect(holds()).toEqual([{ amount_minor: 42000, status: 'VOIDED' }]));
    await rec.assert('both fines PAID', () => expect(fines().map(f => f.status)).toEqual(['PAID', 'PAID']));
    await rec.assert('wallet is AED 1080.00', async () => expect((await call('overview')).data.wallet.balanceMinor).toBe(108000));
  });
});
