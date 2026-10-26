/** Resident intent: stop an automation rule, and see that a rule cannot outlive its funding (QA-05). Real Keycloak sign-in; the rule is
 *  made through the API and then paused, resumed and revoked on the page. Beside the page the journey asserts the stored rule state and
 *  history, that nothing in the rule moves money (no journal entry, hold, order or issuer row), and that a card a rule depends on can
 *  neither be removed nor quietly used again until the rule is revoked. */
import { billRulePolicy } from '../../../packages/protocol-core/src/bill-rule.ts';
import { expect, isolatedTest as test } from '../stack.ts';

test('a paused rule keeps its consent, a rule cannot outlive its card, and a revoked rule stays revoked', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  const count = (sql: string) => (payments.prepare(sql).get(accountId) as { n: number }).n;
  const effects = () => ({
    journal: count("SELECT count(*) AS n FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING'"),
    holds: count('SELECT count(*) AS n FROM payment_wallet_holds WHERE account_id=?'),
    issuer: count('SELECT count(*) AS n FROM payment_card_authorizations WHERE account_id=?'),
  });
  const rules = async () => (await call('mandates')).data.mandates as Array<{ id: string; state: string; version: number; executionEnabled: boolean; approvalDigest: string; policy: any }>;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();

  // Setup: a linked biller, a card, and an approved rule that pays from that card.
  const dewa = (await call('overview')).data.candidates.find((c: { provider: string }) => c.provider === 'dewa');
  await call('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  const billing = (await call('overview')).data.billingAccounts.find((b: { provider: string; status: string }) => b.provider === 'dewa' && b.status === 'ACTIVE');
  const card = (await call('methods', { preset: 'approved', nickname: 'Rule card' })).data.method as { id: string; version: number };
  const policy = billRulePolicy({ billing: { id: billing.id, version: billing.version, provider: 'dewa', reference: billing.reference }, source: { methodId: card.id, version: card.version }, perPaymentMinor: 50000, now: Date.now() });
  const made = await call('mandates', { policy });
  expect(made.status, JSON.stringify(made.data)).toBe(200);
  const rule = made.data.mandate as { id: string; version: number; approvalDigest: string };
  expect((await call('mandates/approve', { mandateId: rule.id, expectedVersion: rule.version, approvalDigest: rule.approvalDigest })).status).toBe(200);
  const baseline = effects();

  await panel.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  const item = () => panel.getByRole('listitem').filter({ hasText: `Rule ${rule.id}` });
  await item().waitFor();
  expect((await rules())[0]).toMatchObject({ id: rule.id, state: 'APPROVED', executionEnabled: false });

  // Pause: the consent is kept, the page offers resume instead of pause, and nothing moves.
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  let response = responseFor('mandates/pause');
  await item().getByRole('button', { name: 'Pause rule', exact: true }).click();
  expect((await response).status()).toBe(200);
  await resident.getByRole('status').filter({ hasText: 'Rule paused' }).waitFor();
  await item().getByRole('button', { name: 'Resume rule', exact: true }).waitFor();
  expect(await item().getByRole('button', { name: 'Pause rule', exact: true }).count()).toBe(0);
  expect((await rules())[0]).toMatchObject({ id: rule.id, state: 'PAUSED', executionEnabled: false });
  expect(effects(), 'pausing is not a payment').toEqual(baseline);

  // The card is disabled while the rule is paused: resuming revalidates the sources, so the rule does not come back on a dead card.
  const disabled = await call('methods/status', { methodId: card.id, expectedVersion: card.version, status: 'DISABLED' });
  expect(disabled.status, 'a card can be disabled while a rule depends on it').toBe(200);
  response = responseFor('mandates/resume');
  await item().getByRole('button', { name: 'Resume rule', exact: true }).click();
  const resumed = await response;
  expect([resumed.status(), (await resumed.json()).code]).toEqual([409, 'MANDATE_SOURCE_CHANGED']);
  await resident.getByText(/approved source is missing, disabled or changed/i).first().waitFor();
  expect((await rules())[0].state, 'the rule stays paused; nothing re-enabled it').toBe('PAUSED');
  expect(await item().getByRole('button', { name: 'Resume rule', exact: true }).count(), 'the page still offers only the paused actions').toBe(1);
  const removal = await call('methods/status', { methodId: card.id, expectedVersion: disabled.data.method.version, status: 'REMOVED' });
  expect([removal.status, removal.data.code], 'a card a rule depends on cannot be removed').toEqual([409, 'RESOURCE_IN_USE']);
  expect((await call('overview')).data.methods.find((m: { id: string }) => m.id === card.id)).toMatchObject({ status: 'DISABLED' });
  const sourceless = await call('mandates', { policy: { ...policy, purpose: 'Second rule on the disabled card' } });
  expect(sourceless.status, 'no new rule can be drafted on a disabled card').toBe(409);
  expect(effects(), 'none of this moved money').toEqual(baseline);

  // Revoke on the page: the consent and binds are released, history is kept, and a revoked rule cannot be brought back.
  response = responseFor('mandates/revoke');
  await item().getByRole('button', { name: 'Revoke rule', exact: true }).click();
  expect((await response).status()).toBe(200);
  await resident.getByRole('status').filter({ hasText: 'Rule revoked' }).waitFor();
  expect((await rules())[0]).toMatchObject({ id: rule.id, state: 'REVOKED', executionEnabled: false });
  for (const name of ['Pause rule', 'Resume rule', 'Revoke rule', 'Skip next occurrence']) expect(await item().getByRole('button', { name, exact: true }).count(), `no "${name}" on a revoked rule`).toBe(0);
  const current = (await rules())[0];
  for (const action of ['mandates/resume', 'mandates/pause', 'mandates/approve']) {
    const refused = await call(action, { mandateId: rule.id, expectedVersion: current.version, approvalDigest: current.approvalDigest });
    expect(refused.status, `${action} on a revoked rule`).toBeGreaterThanOrEqual(400);
  }
  expect((await rules())[0].state).toBe('REVOKED');
  const history = { data: await (await fetch(`${stack.coreUrl}/api/payments/mandates/history?accountId=${accountId}&mandateId=${rule.id}`, { headers: { Authorization: `Bearer ${residentApi.token}` } })).json() as { history: Array<{ state: string }> } };
  expect((history.data.history as Array<{ state: string }>).map(entry => entry.state).slice(-3), 'history keeps the whole story').toEqual(['APPROVED', 'PAUSED', 'REVOKED']);
  const removed = await call('methods/status', { methodId: card.id, expectedVersion: disabled.data.method.version, status: 'REMOVED' });
  expect(removed.status, 'with the rule revoked the card can go').toBe(200);
  expect(effects(), 'a rule that never ran never paid').toEqual(baseline);
  await resident.reload();
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  expect((await rules())[0].state).toBe('REVOKED');
});
