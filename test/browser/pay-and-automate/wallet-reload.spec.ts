/** Resident intent: top up my wallet from a saved card (QA-04). Real Keycloak sign-in, a card that needs a challenge, review, bound
 *  authorization, challenge approval, capture and receipt. The journey asserts the API outcome and, beside it, the exact ledger
 *  journal entry and the issuer's own record, so a receipt on screen cannot hide a missing, doubled or unbalanced effect. */
import { expect, isolatedTest as test } from '../stack.ts';
import { login } from '../stack.ts';
import { withAccountSwitcher } from '../layout.ts';

test('a saved card tops the wallet up once, with a challenge, and every effect is exact', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, db = stack.payments.db;
  const journal = (reference?: string) => db.prepare(`SELECT e.id, e.kind, e.reference, e.wallet_delta, e.finalized FROM payment_journal_entries e WHERE e.account_id=? AND e.kind<>'OPENING' ${reference ? 'AND e.reference=?' : ''} ORDER BY e.rowid`).all(...(reference ? [accountId, reference] : [accountId])) as Array<{ id: string; kind: string; reference: string; wallet_delta: number; finalized: number }>;
  const postings = (entryId: string) => db.prepare('SELECT line, ledger_account, amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(entryId) as Array<{ line: number; ledger_account: string; amount_minor: number }>;
  const postedWallet = () => Number((db.prepare("SELECT coalesce(sum(p.amount_minor),0) AS n FROM payment_journal_postings p JOIN payment_journal_entries e ON e.id=p.entry_id WHERE e.account_id=? AND e.finalized=1 AND p.ledger_account='wallet'").get(accountId) as { n: number }).n);

  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const before = { api: (await call('overview')).data.wallet.balanceMinor as number, journal: journal().length, posted: postedWallet() };
  expect(before.api, 'the wallet starts at its seed').toBe(150000);
  expect(before.posted, 'the journal agrees with the wallet before the top-up').toBe(before.api);

  // A saved demo card that asks for a challenge.
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  await panel.getByRole('textbox', { name: 'Card nickname', exact: true }).fill('My wallet funding card');
  await panel.getByRole('combobox', { name: 'Demo card preset', exact: true }).selectOption('challenge');
  let response = responseFor('methods');
  await panel.getByRole('button', { name: 'Add demo card', exact: true }).click();
  const card = (await (await response).json()).method as { id: string };

  // Review.
  const funding = panel.getByRole('region', { name: 'Add wallet funds', exact: true });
  await funding.getByRole('spinbutton', { name: 'Wallet top-up amount (AED)', exact: true }).fill('50.00');
  await funding.getByRole('combobox', { name: 'Wallet top-up card', exact: true }).selectOption(card.id);
  response = responseFor('wallet-funding-orders');
  await funding.getByRole('button', { name: 'Review wallet top-up', exact: true }).click();
  const requested = await response, order = (await requested.json()).order as { id: string; approvalDigest: string };
  const article = funding.getByRole('article', { name: `Wallet funding review ${order.id}`, exact: true });
  await article.getByText('State: AWAITING_APPROVAL', { exact: true }).waitFor();
  expect((await call('overview')).data.wallet.balanceMinor, 'a review moves no money').toBe(before.api);
  expect(journal().length, 'a review writes nothing to the journal').toBe(before.journal);
  expect((await call('wallet-funding-orders', requested.request().postDataJSON())).data.order.id, 'an exact retry returns the same review').toBe(order.id);

  // Someone else cannot approve it, and nothing changes.
  const otherToken = await login('bassem');
  expect((await call('wallet-funding-orders/approve', { orderId: order.id, expectedVersion: 1, approvalDigest: order.approvalDigest }, otherToken)).status).toBe(403);
  expect((await call('wallet-funding-orders/approve', { orderId: order.id, expectedVersion: 1, approvalDigest: 'a'.repeat(64) })).status, 'a wrong digest').toBe(409);
  expect(journal().length).toBe(before.journal);

  // Authorize, then the challenge: still no money moves.
  response = responseFor('wallet-funding-orders/approve');
  await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
  await response;
  await article.getByText('State: REQUIRES_ACTION', { exact: true }).waitFor();
  expect((await call('overview')).data.wallet.balanceMinor, 'a pending challenge moves no money').toBe(before.api);
  expect(journal().length).toBe(before.journal);
  response = responseFor('wallet-funding-orders/challenge');
  await article.getByRole('button', { name: 'Approve wallet top-up challenge', exact: true }).click();
  await response;
  await article.getByText('State: AUTHORIZED', { exact: true }).waitFor();
  expect(journal().length, 'an authorization alone writes nothing to the journal').toBe(before.journal);

  // Capture and credit.
  response = responseFor('wallet-funding-orders/execute');
  await article.getByRole('button', { name: 'Add AED 50.00 to wallet', exact: true }).click();
  const executed = await response, settled = (await executed.json()).order as { id: string; state: string };
  expect([executed.status(), settled.state]).toEqual([200, 'SETTLED']);
  await article.getByRole('region', { name: 'Confirmed wallet funding receipt', exact: true }).waitFor();

  // The API outcome.
  const overview = (await call('overview')).data;
  expect(overview.wallet.balanceMinor).toBe(155000);
  const cardBalance = overview.cardBalances.find((b: { sourceId: string }) => b.sourceId === card.id);
  expect([cardBalance.spentMinor, cardBalance.heldMinor]).toEqual([5000, 0]);

  // The exact ledger effect: one sealed TOPUP, balanced, tied to this order, and nothing else new.
  const entries = journal();
  expect(entries.length, 'exactly one new journal entry').toBe(before.journal + 1);
  const topup = journal(`wallet-funding:${order.id}`);
  expect(topup).toHaveLength(1);
  expect([topup[0].kind, topup[0].wallet_delta, topup[0].finalized]).toEqual(['TOPUP', 5000, 1]);
  expect(postings(topup[0].id)).toEqual([{ line: 0, ledger_account: 'external-clearing', amount_minor: -5000 }, { line: 1, ledger_account: 'wallet', amount_minor: 5000 }]);
  expect(postedWallet(), 'the journal sums to the wallet the API reports').toBe(155000);

  // The exact provider effect: one issuer record for this order, for this card and amount.
  const issuer = db.prepare('SELECT order_id, source_id, state, body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').all(accountId, order.id) as Array<{ order_id: string; source_id: string; state: string; body: string }>;
  expect(issuer).toHaveLength(1);
  expect([issuer[0].source_id, issuer[0].state]).toEqual([card.id, 'CAPTURED']);
  const record = JSON.parse(issuer[0].body) as { amountMinor: number; currency: string; challengeId?: string };
  expect([record.amountMinor, record.currency], 'the issuer captured the reviewed amount').toEqual([5000, 'AED']);
  expect(record.challengeId, 'the capture is bound to the challenge the resident approved').toBeTruthy();

  // A retry is the same order and the same single effect.
  expect((await call('wallet-funding-orders/execute', executed.request().postDataJSON())).data.order.id).toBe(settled.id);
  expect((await call('overview')).data.wallet.balanceMinor).toBe(155000);
  expect(journal(`wallet-funding:${order.id}`), 'the retry added no entry').toHaveLength(1);
  expect(journal().length).toBe(before.journal + 1);

  // Reload keeps the receipt without a second effect.
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByRole('region', { name: 'Confirmed wallet funding receipt', exact: true }).getByText('Wallet credited · AED 50.00', { exact: true }).waitFor();
  expect(journal().length, 'a reload is not an effect').toBe(before.journal + 1);

  // The household wallet is another account: no receipt, and no journal entry for it from this order.
  await withAccountSwitcher(resident, async switcher => { const household = await switcher.locator('option').filter({ hasText: 'Household account' }).getAttribute('value'); expect(household).toBeTruthy(); await switcher.selectOption(household!); });
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  expect(await panel.getByRole('region', { name: 'Confirmed wallet funding receipt', exact: true }).count()).toBe(0);
  expect(db.prepare('SELECT count(*) AS n FROM payment_journal_entries WHERE reference=? AND account_id<>?').get(`wallet-funding:${order.id}`, accountId)).toEqual({ n: 0 });
});
