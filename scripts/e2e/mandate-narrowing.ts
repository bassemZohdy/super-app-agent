import { keycloakIssuerUrl } from '../endpoints.ts';
/** Browser journey (AUTO-04): an owner narrows an approved rule's per-payment cap in the rules panel, is refused a raise,
 *  and approves the narrowed review. Real Keycloak sign-in, real provider consent records; isolated synthetic funds only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
import { MANDATE_ACTOR, type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';

let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
try {
  environment = await startEnvironment();
  const base = environment.coreUrl;
  const login = async (username: string) => {
    const r = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
    assert.equal(r.status, 200);
    return (await r.json() as { access_token: string }).access_token;
  };
  const owner = await login('demo-commuter');
  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.setDefaultTimeout(45000);
  await page.goto(environment.appUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  const accountId = await page.getByRole('combobox', { name: 'Current account', exact: true }).inputValue();

  // Owner consent set up through the provider API: a linked DEWA biller, one due bill and an approved rule with a 500 AED cap.
  const api = async (path: string, body?: Record<string, unknown>) => {
    const r = await fetch(`${base}/api/payments/${path}${body ? '' : `?accountId=${accountId}`}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ accountId, requestKey: randomUUID(), ...body }) } : {}) });
    return { status: r.status, data: await r.json() as any };
  };
  const overview = (await api('overview')).data;
  const dewa = overview.candidates.find((c: any) => c.provider === 'dewa');
  assert.ok(dewa, 'a DEWA account is available to the owner');
  const link = await api('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  const billing = link.data.billingAccount ?? (await api('overview')).data.billingAccounts.find((b: any) => b.reference === dewa.reference);
  const policy: MandatePolicy = {
    actorClientId: MANDATE_ACTOR, audience: 'provider-api', operation: 'BILL_PAYMENT', purpose: 'Pay my DEWA bill automatically', currency: 'AED',
    target: { kind: 'BILLER', billingAccountId: billing.id, expectedVersion: billing.version, provider: 'dewa', reference: dewa.reference },
    sources: [{ methodId: 'wallet', expectedVersion: 1 }], fallback: { mode: 'NONE' }, trigger: { type: 'INVOICE_DUE', daysBefore: 3 }, timezone: 'Asia/Dubai',
    startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH', perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 },
  };
  const made = await api('mandates', { policy: { ...policy, purpose: `Narrowing journey ${randomUUID().slice(0, 8)}` } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const rule = made.data.mandate;
  const approved = await api('mandates/approve', { mandateId: rule.id, expectedVersion: rule.version, approvalDigest: rule.approvalDigest });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.mandate.state, 'APPROVED');

  // The owner narrows the cap in the rules panel.
  await page.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  const item = page.getByRole('listitem').filter({ hasText: `Rule ${rule.id}` });
  await item.waitFor();
  // A raise is refused in the panel and sends no revision.
  let revisions = 0;
  page.on('request', request => { if (request.url().includes('/api/payments/mandates/revise')) revisions++; });
  await item.getByLabel('Per-payment cap in AED (lower only)').fill('600');
  await item.getByRole('button', { name: 'Narrow per-payment cap', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Narrowing lowers the cap' }).waitFor();
  assert.equal(revisions, 0, 'a raise is not sent');
  // A real narrowing revises the rule, and it then waits for the owner's approval.
  await item.getByLabel('Per-payment cap in AED (lower only)').fill('120');
  const revised = page.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/mandates/revise' && r.request().method() === 'POST');
  await item.getByRole('button', { name: 'Narrow per-payment cap', exact: true }).click();
  assert.equal((await revised).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Cap narrowed' }).waitFor();
  const waiting = await api('mandates');
  const narrowed = waiting.data.mandates.find((m: any) => m.id === rule.id);
  assert.equal(narrowed.state, 'AWAITING_APPROVAL', 'the narrowed rule waits for approval');
  assert.equal(narrowed.policy.limits.perPaymentMinor, 12000, 'the revised cap is AED 120');
  // The owner approves the reviewed terms; the rule runs again under the narrower cap.
  await page.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  const reviewed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/mandates/approve' && r.request().method() === 'POST');
  await page.getByRole('listitem').filter({ hasText: `Rule ${rule.id}` }).getByRole('button', { name: 'Approve reviewed terms', exact: true }).click();
  assert.equal((await reviewed).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Narrowed rule approved' }).waitFor();
  const after = (await api('mandates')).data.mandates.find((m: any) => m.id === rule.id);
  assert.equal(after.state, 'APPROVED');
  assert.equal(after.policy.limits.perPaymentMinor, 12000);
  console.log('PASS: the owner narrows an approved rule in the browser, a raise is refused without a request, and the narrowed review is approved before the rule runs again.');
} finally {
  await browser?.close();
  await environment?.cleanup();
}
