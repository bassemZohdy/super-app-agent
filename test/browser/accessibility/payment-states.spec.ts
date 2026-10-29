/** Resident intent: read and operate the payment screens in their hardest states on a phone and a desktop (QA-06). One run holds a
 *  masked card, a rule that is paused and one that is approved, a top-up waiting on a card challenge and a payment whose outcome
 *  is unknown. On that crowded screen the journey measures what the resident meets: no card number beyond its last digits, every
 *  control named and at least 44px, nothing wider than the screen, the paused/unknown/challenge states said in words and reachable
 *  with the keyboard, a revoked rule left with nothing to run or resume, and the account switch leaving none of it behind. */
import { billRulePolicy } from '../../../packages/protocol-core/src/bill-rule.ts';
import { scenarioTest as test, expect } from '../stack.ts';
import { withAccountSwitcher } from '../layout.ts';
import { controlsBelowTarget } from './measures.ts';

test('masked cards, a paused rule, a challenge and an unknown outcome are readable, named and reachable', async ({ resident, residentApi, scenario }) => {
  test.setTimeout(180_000);
  const { accountId, call } = residentApi;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();

  // A card the operator makes challenge, a rule that is paused and one that stays approved, a top-up waiting on the challenge,
  // and a bill payment whose answer is lost after the capture.
  const card = (await call('methods', { preset: 'approved', nickname: 'Phone card' })).data.method as { id: string; version: number };
  expect((await scenario.admin('/configuration', { accountId, methodId: card.id, expectedMethodVersion: card.version, expectedRevision: 0, preset: 'challenge', requestKey: crypto.randomUUID() })).status).toBe(200);
  const overview = (await call('overview')).data;
  const dewa = overview.candidates.find((c: { provider: string }) => c.provider === 'dewa');
  await call('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  const billing = (await call('overview')).data.billingAccounts.find((b: { provider: string; status: string }) => b.provider === 'dewa' && b.status === 'ACTIVE');
  const makeRule = async (purpose: string) => {
    const policy = billRulePolicy({ billing: { id: billing.id, version: billing.version, provider: 'dewa', reference: billing.reference }, source: { methodId: 'wallet', version: 1 }, perPaymentMinor: 50000, now: Date.now() });
    const created = await call('mandates', { policy: { ...policy, purpose } });
    expect(created.status, JSON.stringify(created.data).slice(0, 300)).toBe(200);
    const made = created.data.mandate;
    return (await call('mandates/approve', { mandateId: made.id, expectedVersion: made.version, approvalDigest: made.approvalDigest })).data.mandate as { id: string; version: number };
  };
  const first = await makeRule('Phone journey one'), second = await makeRule('Phone journey two');
  expect((await call('mandates/pause', { mandateId: first.id, expectedVersion: first.version })).status).toBe(200);
  const bill = (await call('overview')).data.payables.find((p: { provider: string; status: string }) => p.provider === 'dewa' && p.status === 'UNPAID');
  const order = (await call('orders', { provider: 'dewa', payableId: bill.id, expectedPayableRevision: bill.revision, methodId: 'wallet', expectedMethodVersion: 1 })).data.order;
  const approved = (await call('orders/approve', { orderId: order.id, expectedVersion: order.version, approvalDigest: order.approvalDigest })).data.order;
  await scenario.controls.arm('checkout.after-capture-commit', 1, `arm_${crypto.randomUUID().slice(0, 12)}`);
  const lost = await call('orders/execute', { orderId: approved.id, expectedVersion: approved.version, approvalDigest: approved.approvalDigest });
  expect(lost.data.order.state).toBe('RECONCILIATION_REQUIRED');

  await panel.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();
  const funding = panel.getByRole('region', { name: 'Add wallet funds', exact: true });
  await funding.getByRole('spinbutton', { name: 'Wallet top-up amount (AED)', exact: true }).fill('50.00');
  await funding.getByRole('combobox', { name: 'Wallet top-up card', exact: true }).selectOption(card.id);
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  let response = responseFor('wallet-funding-orders');
  await funding.getByRole('button', { name: 'Review wallet top-up', exact: true }).click();
  const topup = (await (await response).json()).order as { id: string };
  const review = funding.getByRole('article', { name: `Wallet funding review ${topup.id}`, exact: true });
  response = responseFor('wallet-funding-orders/approve');
  await review.getByRole('button', { name: 'Authorize wallet top-up of AED 50.00', exact: true }).click();
  await response;
  await review.getByText('State: REQUIRES_ACTION', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  await panel.getByRole('listitem').filter({ hasText: `Rule ${first.id}` }).waitFor({ timeout: 10_000 });

  const rule = (id: string) => panel.getByRole('list', { name: 'Automation rule consent', exact: true }).getByRole('listitem').filter({ hasText: `Rule ${id}` });
  await rule(first.id).waitFor();
  await rule(second.id).waitFor();
  const text = () => resident.evaluate(() => document.body.textContent ?? '');

  // The states are said in words, and the card shows only its last four digits.
  const shown = await text();
  expect(shown).toContain('Phone card ·•••• 4242');
  expect(shown.match(/d{13,19}/g) ?? [], 'no full card number anywhere on the screen').toEqual([]);
  expect(shown).toContain('Reconcile the original capture; do not pay again.');
  expect(shown).toMatch(new RegExp(`${lost.data.order.id} · RECONCILIATION_REQUIRED`));
  expect(shown).toMatch(new RegExp(`${topup.id} · REQUIRES_ACTION`));
  await expect(rule(first.id)).toContainText(/Paused/);
  await expect(rule(second.id)).toContainText(/Approved/);
  await expect(rule(first.id).getByRole('button', { name: 'Resume rule', exact: true })).toBeVisible();
  expect(await rule(first.id).getByRole('button', { name: 'Pause rule', exact: true }).count(), 'a paused rule offers no second pause').toBe(0);

  // Every control is named, at least 44px, and nothing is wider than the screen.
  expect(await controlsBelowTarget(resident)).toEqual([]);
  expect(await resident.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=hidden])')].filter(el => el.checkVisibility({ visibilityProperty: true }))
    .filter(el => !(el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).labels?.[0]?.innerText?.trim() || el.getAttribute('title'))).map(el => el.outerHTML.slice(0, 80))), 'a control with no name').toEqual([]);
  expect(await resident.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing sideways to scroll').toBe(true);

  // The keyboard reaches and operates a rule: focus the second rule's Pause and press Enter.
  const pause = rule(second.id).getByRole('button', { name: 'Pause rule', exact: true });
  await pause.focus();
  await expect(pause).toBeFocused();
  const paused = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/mandates/pause' && r.request().method() === 'POST');
  await resident.keyboard.press('Enter');
  expect((await paused).status()).toBe(200);
  await expect(rule(second.id)).toContainText(/Paused/);
  expect(((await call('mandates')).data.mandates as Array<{ state: string }>).map(r => r.state)).toEqual(['PAUSED', 'PAUSED']);

  // Revoking the paused rule is a keyboard action too, and it leaves the rule with nothing to run, resume or revoke again.
  const revoke = rule(first.id).getByRole('button', { name: 'Revoke rule', exact: true });
  await revoke.focus();
  await expect(revoke).toBeFocused();
  const revoked = resident.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/mandates/revoke' && r.request().method() === 'POST');
  await resident.keyboard.press('Enter');
  expect((await revoked).status()).toBe(200);
  await expect(rule(first.id)).toContainText(/Revoked/);
  expect(await rule(first.id).getByRole('button', { name: 'Resume rule', exact: true }).count(), 'a revoked rule offers no resume').toBe(0);
  expect(await rule(first.id).getByRole('button', { name: 'Revoke rule', exact: true }).count(), 'a revoked rule offers no second revoke').toBe(0);
  await expect(rule(second.id)).toContainText(/Paused/);
  expect(await rule(second.id).getByRole('button', { name: 'Resume rule', exact: true }).count(), 'the untouched paused rule still resumes').toBe(1);
  expect(((await call('mandates')).data.mandates as Array<{ state: string }>).map(r => r.state).sort()).toEqual(['PAUSED', 'REVOKED']);

  // Switching account leaves none of it behind, and switching back finds it as it was.
  await withAccountSwitcher(resident, async switcher => { const value = await switcher.locator('option').filter({ hasText: 'Household account' }).getAttribute('value'); await switcher.selectOption(value!); });
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const other = await text();
  for (const leaked of ['Phone card', first.id, second.id, topup.id, lost.data.order.id]) expect(other, `${leaked} does not follow the resident to another account`).not.toContain(leaked);
  await withAccountSwitcher(resident, async switcher => { await switcher.selectOption(accountId); });
  await panel.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  await expect(rule(first.id)).toContainText(/Revoked/);
  await expect(rule(second.id)).toContainText(/Paused/);
  expect(await text()).toContain('Phone card ·•••• 4242');
});
