import { keycloakIssuerUrl } from '../endpoints.ts';
/** Browser journey (AUTO-04): an owner creates an automatic bill rule in the panel. Reviewing it creates a draft that is not yet
 *  active; only the explicit approval of the reviewed terms makes it run. Real Keycloak sign-in and provider consent records. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';

let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
try {
  environment = await startEnvironment();
  const base = environment.coreUrl;
  const r = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123' }) });
  assert.equal(r.status, 200);
  const owner = (await r.json() as { access_token: string }).access_token;

  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.setDefaultTimeout(45000);
  await page.goto(environment.appUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  const accountId = await page.getByRole('combobox', { name: 'Current account', exact: true }).inputValue();

  const api = async (path: string, body?: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/payments/${path}${body ? '' : `?accountId=${accountId}`}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ accountId, requestKey: randomUUID(), ...body }) } : {}) });
    return { status: res.status, data: await res.json() as any };
  };
  // A linked DEWA biller is the owner's own prerequisite; the rule is created through the panel, not through this setup.
  const dewa = (await api('overview')).data.candidates.find((c: any) => c.provider === 'dewa');
  assert.ok(dewa, 'a DEWA account is available to the owner');
  await api('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  const billing = (await api('overview')).data.billingAccounts.find((b: any) => b.provider === 'dewa' && b.reference === dewa.reference && b.status === 'ACTIVE');
  assert.ok(billing, 'the DEWA biller is linked');
  const before = (await api('mandates')).data.mandates.map((m: any) => m.id);

  // The owner drafts the rule in the panel and reviews it.
  await page.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new rule', exact: true }).click();
  await page.getByLabel('Pay this linked biller').selectOption(billing.id);
  await page.getByLabel('Pay from').selectOption('wallet');
  await page.getByLabel('Most one payment may take, in AED').fill('150');
  const reviewed = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/mandates' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Review rule', exact: true }).click();
  assert.equal((await reviewed).status(), 200);
  await page.getByText('Up to AED 150.00 per payment', { exact: false }).waitFor();
  await page.getByText('Nothing is consented until you approve these terms.', { exact: false }).waitFor();
  await page.getByText('Revocation', { exact: true }).waitFor();

  // Reviewing created a draft that is not active yet.
  const drafts = (await api('mandates')).data.mandates.filter((m: any) => !before.includes(m.id));
  assert.equal(drafts.length, 1, 'the review created exactly one rule');
  assert.equal(drafts[0].state, 'AWAITING_APPROVAL', 'a reviewed draft is not active');
  assert.equal(drafts[0].policy.limits.perPaymentMinor, 15000);

  // Only the explicit approval of the reviewed terms consents to the rule.
  const approved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/mandates/approve' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Approve these terms', exact: true }).click();
  assert.equal((await approved).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Rule approved' }).waitFor();
  const active = (await api('mandates')).data.mandates.find((m: any) => m.id === drafts[0].id);
  assert.equal(active.state, 'APPROVED', 'the approved rule is active');
  assert.equal(active.policy.limits.perPaymentMinor, 15000, 'it runs under the cap the owner reviewed');
  console.log('PASS: the owner creates a bill rule in the browser; reviewing it creates a draft that is not active, and only approving the reviewed terms makes it run under the reviewed cap.');
} finally {
  await browser?.close();
  await environment?.cleanup();
}
