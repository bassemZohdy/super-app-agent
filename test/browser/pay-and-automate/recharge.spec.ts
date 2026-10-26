/** Resident intent: top up my prepaid mobile line from the wallet and my toll tag from a saved card (QA-04). Everything is done on the
 *  page. Beside it the journey asserts, for each recharge, the exact ledger journal entry, the settlement claim and the provider's own
 *  balance, so a recharge receipt cannot hide a missing, doubled or misdirected credit. */
import { expect, isolatedTest as test } from '../stack.ts';
import { login } from '../stack.ts';

test('a wallet recharge and a card recharge each credit the provider exactly once', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  type Entry = { id: string; kind: string; reference: string; wallet_delta: number; finalized: number };
  const journal = () => payments.prepare("SELECT id, kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Entry[];
  const postings = (entry: Entry) => payments.prepare('SELECT line, ledger_account, amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(entry.id);
  const claims = () => payments.prepare('SELECT payment_id, provider, state, body FROM payment_settlement_claims WHERE account_id=? ORDER BY rowid').all(accountId) as Array<{ payment_id: string; provider: string; state: string; body: string }>;
  const holds = () => payments.prepare('SELECT reference, amount_minor, status FROM payment_wallet_holds WHERE account_id=? ORDER BY rowid').all(accountId);
  const lines = (provider: string) => stack.stores.get(provider)!.db.prepare("SELECT kind, body FROM resources WHERE account_id=? ORDER BY rowid").all(accountId).map(row => ({ kind: (row as { kind: string }).kind, ...JSON.parse(String((row as { body: string }).body)) }));

  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  for (const name of [/^Link Salik/, /^Link du · Prepaid mobile/]) { const linked = responseFor('billing-accounts'); await panel.getByRole('button', { name }).click(); await linked; }
  await panel.getByRole('textbox', { name: 'Card nickname', exact: true }).fill('My recharge card');
  await panel.getByRole('combobox', { name: 'Demo card preset', exact: true }).selectOption('challenge');
  const added = responseFor('methods');
  await panel.getByRole('button', { name: 'Add demo card', exact: true }).click();
  const card = (await (await added).json()).method as { id: string };
  const prepaid = () => lines('du').find(line => line.kind === 'prepaid-line') as { balanceMinor: number };
  const salik = () => lines('rta').find(line => line.kind === 'salik') as { balance: number };
  const start = { wallet: (await call('overview')).data.wallet.balanceMinor as number, journal: journal().length, claims: claims().length, prepaid: prepaid().balanceMinor, salik: salik().balance };
  expect(start.wallet).toBe(150000);

  const recharge = async (provider: 'du' | 'rta', source: string, withChallenge: boolean) => {
    const target = (await call('overview')).data.rechargeTargets.find((t: { provider: string }) => t.provider === provider) as { reference: string; denominationsMinor: number[]; balanceMinor: number };
    const minor = target.denominationsMinor[0], section = panel.getByRole('region', { name: 'Toll and mobile recharge', exact: true });
    await section.getByRole('combobox', { name: 'Recharge target', exact: true }).selectOption(`${provider}:${target.reference}`);
    await section.getByRole('combobox', { name: 'Recharge denomination', exact: true }).selectOption(String(minor));
    await section.getByRole('combobox', { name: 'Recharge funding source', exact: true }).selectOption(source);
    let response = responseFor('recharge-preview');
    await section.getByRole('button', { name: 'Review provider recharge', exact: true }).click();
    const preview = (await (await response).json()).preview as { totalMinor: number; payable: { kind: string; reference: string } };
    expect([preview.totalMinor, preview.payable.kind, preview.payable.reference]).toEqual([minor, 'RECHARGE', target.reference]);
    response = responseFor('orders');
    await panel.getByRole('article', { name: 'Payment quote preview', exact: true }).getByRole('button', { name: 'Create authorization review', exact: true }).click();
    const order = (await (await response).json()).order as { id: string; version: number; approvalDigest: string };
    const article = panel.getByRole('article', { name: `Authorization review ${order.id}`, exact: true });
    expect((await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest }, await login('bassem'))).status).toBe(403);
    response = responseFor('orders/approve');
    await article.getByRole('button', { name: `Approve authorization for AED ${(minor / 100).toFixed(2)}`, exact: true }).click();
    await response;
    if (withChallenge) {
      await article.getByText('State: REQUIRES_ACTION', { exact: true }).waitFor();
      response = responseFor('orders/challenge');
      await article.getByRole('button', { name: 'Approve demo card challenge', exact: true }).click();
      await response;
    }
    await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
    response = responseFor('orders/execute');
    await article.getByRole('button', { name: `Pay AED ${(minor / 100).toFixed(2)}`, exact: true }).click();
    const executed = await response, paid = (await executed.json()).order as { id: string; state: string; paymentId: string; receipt: { providerBalanceMinor: number } };
    expect([executed.status(), paid.state, paid.receipt.providerBalanceMinor]).toEqual([200, 'SETTLED', target.balanceMinor + minor]);
    await article.getByRole('region', { name: 'Confirmed recharge receipt', exact: true }).waitFor();
    return { order, paid, minor, target, executed };
  };

  // 1. A prepaid line from the wallet: the funds are held, then one balanced PAYMENT replaces the hold, and the line is credited once.
  const first = await recharge('du', 'wallet', false);
  expect(await call('overview').then(r => r.data.wallet)).toEqual({ balanceMinor: start.wallet - first.minor, heldMinor: 0, availableMinor: start.wallet - first.minor, currency: 'AED' });
  expect(holds(), 'the hold for this order was released').toEqual([{ reference: first.order.id, amount_minor: first.minor, status: 'VOIDED' }]);
  let entries = journal();
  expect(entries, 'exactly one new journal entry').toHaveLength(start.journal + 1);
  expect([entries[start.journal].kind, entries[start.journal].wallet_delta, entries[start.journal].finalized]).toEqual(['PAYMENT', -first.minor, 1]);
  expect(entries[start.journal].reference).toBe(`charge:${first.paid.paymentId}`);
  expect(postings(entries[start.journal])).toEqual([{ line: 0, ledger_account: 'wallet', amount_minor: -first.minor }, { line: 1, ledger_account: 'merchant-clearing', amount_minor: first.minor }]);
  let settled = claims();
  expect(settled).toHaveLength(start.claims + 1);
  expect([settled[start.claims].payment_id, settled[start.claims].provider, settled[start.claims].state]).toEqual([first.paid.paymentId, 'du', 'APPLIED']);
  expect(JSON.parse(settled[start.claims].body)).toMatchObject({ amountMinor: first.minor, orderId: first.order.id });
  expect(prepaid().balanceMinor, "the provider's own balance rose by exactly the recharge").toBe(start.prepaid + first.minor);

  // 2. A toll tag from a challenged card: the wallet is untouched, the entry is balanced against external clearing, the tag is credited once.
  const second = await recharge('rta', card.id, true);
  expect((await call('overview')).data.wallet.balanceMinor, 'a card recharge does not touch the wallet').toBe(start.wallet - first.minor);
  entries = journal();
  expect(entries, 'exactly one more journal entry').toHaveLength(start.journal + 2);
  expect([entries[start.journal + 1].kind, entries[start.journal + 1].wallet_delta, entries[start.journal + 1].finalized]).toEqual(['PAYMENT', 0, 1]);
  expect(entries[start.journal + 1].reference).toBe(`charge:${second.paid.paymentId}`);
  expect(postings(entries[start.journal + 1])).toEqual([{ line: 0, ledger_account: 'external-clearing', amount_minor: -second.minor }, { line: 1, ledger_account: 'merchant-clearing', amount_minor: second.minor }]);
  settled = claims();
  expect(settled).toHaveLength(start.claims + 2);
  expect([settled[start.claims + 1].payment_id, settled[start.claims + 1].provider, settled[start.claims + 1].state]).toEqual([second.paid.paymentId, 'rta', 'APPLIED']);
  expect(salik().balance, "the toll provider's own balance rose by exactly the recharge").toBe(start.salik + second.minor / 100);
  const cardBalance = (await call('overview')).data.cardBalances.find((b: { sourceId: string }) => b.sourceId === card.id);
  expect([cardBalance.spentMinor, cardBalance.heldMinor], 'the card spent exactly the recharge').toEqual([second.minor, 0]);
  expect(entries.reduce((sum, entry) => sum + entry.wallet_delta, 0), 'the journal moved the wallet only by the wallet recharge').toBe(-first.minor);

  // Retries and a reload are not effects.
  for (const done of [first, second]) {
    expect((await call('orders/execute', done.executed.request().postDataJSON())).data.order.paymentId).toBe(done.paid.paymentId);
    expect((await call('orders/recover', { orderId: done.paid.id })).data.order.paymentId).toBe(done.paid.paymentId);
  }
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1475.00', { exact: true }).waitFor();
  expect(journal(), 'retries and a reload added nothing').toHaveLength(start.journal + 2);
  expect(claims()).toHaveLength(start.claims + 2);
  expect([prepaid().balanceMinor, salik().balance]).toEqual([start.prepaid + first.minor, start.salik + second.minor / 100]);
});
