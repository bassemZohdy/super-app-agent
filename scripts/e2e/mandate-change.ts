import { keycloakIssuerUrl } from '../endpoints.ts';
/** Browser journey (AUTO-04): an owner raises an approved rule's cap and changes its funding source in the panel. Each change
 *  is a new review: the rule is not active under the new terms until the owner approves them. Lowering through this control is refused. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
import { billRulePolicy } from '../../packages/protocol-core/src/bill-rule.ts';

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
  // Setup through the provider: a linked biller, an approved rule at AED 120, and a card the owner can change to.
  const dewa = (await api('overview')).data.candidates.find((c: any) => c.provider === 'dewa');
  assert.ok(dewa, 'a DEWA account is available to the owner');
  await api('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  const billing = (await api('overview')).data.billingAccounts.find((b: any) => b.provider === 'dewa' && b.reference === dewa.reference && b.status === 'ACTIVE');
  const card = (await api('methods', { preset: 'approved', nickname: 'Change card' })).data.method;
  const policy = billRulePolicy({ billing: { id: billing.id, version: billing.version, provider: 'dewa', reference: billing.reference }, source: { methodId: 'wallet', version: 1 }, perPaymentMinor: 12000, now: Date.now() });
  const made = await api('mandates', { policy: { ...policy, purpose: `Change journey ${randomUUID().slice(0, 8)}` } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const rule = made.data.mandate;
  assert.equal((await api('mandates/approve', { mandateId: rule.id, expectedVersion: rule.version, approvalDigest: rule.approvalDigest })).status, 200);

  await page.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  const item = page.getByRole('listitem').filter({ hasText: `Rule ${rule.id}` });
  await item.waitFor();

  // Lowering through this control is refused with no request.
  let revisions = 0;
  page.on('request', request => { if (request.url().includes('/api/payments/mandates/revise')) revisions++; });
  await item.getByRole('button', { name: 'Change cap or funding source', exact: true }).click();
  await item.getByLabel('Raise the per-payment cap in AED (optional)').fill('50');
  await item.getByRole('button', { name: 'Send changed terms for review', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Expanding raises the cap' }).waitFor();
  assert.equal(revisions, 0, 'a lowered cap is not sent');

  // Raising the cap and changing to the card is a new review; the rule is not active under the new terms yet.
  await item.getByLabel('Raise the per-payment cap in AED (optional)').fill('300');
  await item.getByLabel('Pay from').selectOption(card.id);
  const revised = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/mandates/revise' && res.request().method() === 'POST');
  await item.getByRole('button', { name: 'Send changed terms for review', exact: true }).click();
  const revisedResponse = await revised;
  assert.equal(revisedResponse.status(), 200, await revisedResponse.text());
  await page.getByRole('status').filter({ hasText: 'Terms changed' }).waitFor();
  const reviewing = (await api('mandates')).data.mandates.find((m: any) => m.id === rule.id);
  assert.equal(reviewing.state, 'AWAITING_APPROVAL', 'the changed terms are not active until approved');
  assert.equal(reviewing.policy.limits.perPaymentMinor, 30000);
  assert.deepEqual(reviewing.policy.sources.map((s: any) => s.methodId), [card.id]);

  // The owner approves the reviewed terms; the rule then runs under the new cap and source.
  await page.getByRole('button', { name: 'Load automation rules', exact: true }).click();
  const approved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/mandates/approve' && res.request().method() === 'POST');
  await page.getByRole('listitem').filter({ hasText: `Rule ${rule.id}` }).getByRole('button', { name: 'Approve reviewed terms', exact: true }).click();
  assert.equal((await approved).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Rule approved' }).waitFor();
  const active = (await api('mandates')).data.mandates.find((m: any) => m.id === rule.id);
  assert.equal(active.state, 'APPROVED');
  assert.equal(active.policy.limits.perPaymentMinor, 30000);
  assert.deepEqual(active.policy.sources.map((s: any) => s.methodId), [card.id]);
  console.log('PASS: the owner raises an approved rule\'s cap and changes its source in the browser; each change waits for approval, and lowering through this control is refused.');
} finally {
  await browser?.close();
  await environment?.cleanup();
}
