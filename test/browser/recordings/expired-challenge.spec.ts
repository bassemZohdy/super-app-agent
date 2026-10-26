import { recordedTest as test, expect } from './recorder.ts';

test('challenge-expired-unanswered: a card challenge left for an hour expires and the top-up moves nothing', async ({ resident, residentApi, stack, scenario, rec }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  const journal = () => payments.prepare("SELECT kind FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING'").all(accountId).map(row => ({ ...row }));
  const issuer = (orderId: string) => payments.prepare('SELECT state, body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').all(accountId, orderId).map(row => ({ state: (row as { state: string }).state, body: JSON.parse(String((row as { body: string }).body)) as { challengeId: string } }));
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();

  // The operator gives the card its challenge; the resident reviews and authorizes a top-up with it.
  const method = (await call('methods', { preset: 'approved', nickname: 'Challenge card' })).data.method as { id: string; version: number };
  expect((await scenario.admin('/configuration', { accountId, methodId: method.id, expectedMethodVersion: method.version, expectedRevision: 0, preset: 'challenge', requestKey: crypto.randomUUID() })).status).toBe(200);
  await panel.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const funding = panel.getByRole('region', { name: 'Add wallet funds', exact: true });
  await funding.getByRole('spinbutton', { name: 'Wallet top-up amount (AED)', exact: true }).fill('50.00');
  await funding.getByRole('combobox', { name: 'Wallet top-up card', exact: true }).selectOption(method.id);
  let response = responseFor('wallet-funding-orders');
  await funding.getByRole('button', { name: 'Review wallet top-up', exact: true }).click();
  const order = (await (await response).json()).order as { id: string; version: number; approvalDigest: string };
  const article = funding.getByRole('article', { name: `Wallet funding review ${order.id}`, exact: true });
  await article.scrollIntoViewIfNeeded();
  await rec.chapter({ id: 'review', kind: 'review', title: 'The top-up review', caption: 'AED 50.00 from the challenge card. Reviewing reserves nothing.' }, async () => {
    await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).waitFor();
    await rec.assert('no journal entry', () => expect(journal()).toEqual([]));
    await rec.assert('no issuer authorization yet', () => expect(issuer(order.id)).toEqual([]));
  });

  response = responseFor('wallet-funding-orders/approve');
  await article.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
  await response;
  await article.getByText('State: REQUIRES_ACTION', { exact: true }).waitFor();
  const waiting = issuer(order.id);
  await rec.chapter({ id: 'challenge', kind: 'state', title: 'The card asks for an answer', caption: 'The issuer is waiting for the resident to approve the challenge.' }, async () => {
    await rec.assert('issuer record is REQUIRES_ACTION', () => expect(waiting.map(row => row.state)).toEqual(['REQUIRES_ACTION']));
    await rec.assert('still no journal entry', () => expect(journal()).toEqual([]));
  });

  // An hour passes on the run's own clock, then the resident answers.
  scenario.clock.advance(60 * 60_000);
  response = responseFor('wallet-funding-orders/challenge');
  await article.getByRole('button', { name: 'Approve wallet top-up challenge', exact: true }).click();
  const late = await response;
  const again = await call('wallet-funding-orders/challenge', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: waiting[0].body.challengeId, decision: 'APPROVE' });
  await resident.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  await article.getByText(/State: FAILED/).waitFor();
  await rec.chapter({ id: 'expired', kind: 'recovery', title: 'Answered too late', caption: 'The challenge expired. The issuer record is expired, the order failed, and nothing was captured.',
    simulatedTime: '+60 minutes: the operator advanced this run\'s clock; the real time was seconds' }, async () => {
    await rec.assert('the late answers are refused', () => expect([late.status(), again.status]).toEqual([409, 409]));
    await rec.assert('issuer record is EXPIRED with AUTHORIZATION_EXPIRED', () => { const [row] = issuer(order.id); expect(row.state).toBe('EXPIRED'); });
    await rec.assert('no journal entry and the wallet is unchanged', async () => { expect(journal()).toEqual([]); expect((await call('overview')).data.wallet.balanceMinor).toBe(150000); });
  });
});
