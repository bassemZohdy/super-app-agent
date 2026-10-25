import { keycloakIssuerUrl } from '../endpoints.ts';
/** Browser journey (AUTO-15, step 3b-iii): an allowlisted automation operator stops and releases the worker's kill switch from the
 *  payments panel. Another account is refused. Real Keycloak sign-in; the job store is a scratch file for this run only. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
import { JobStore } from '../../services/automation-worker/src/jobs.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

const tokenFor = async (username: string) => {
  const r = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
  assert.equal(r.status, 200);
  return (await r.json() as { access_token: string }).access_token;
};
const subOf = (bearer: string) => JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub as string;

let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const scratch = mkdtempSync(join(tmpdir(), 'cityside-killswitch-panel-'));
try {
  const operator = await tokenFor('demo-commuter');
  // The journey's operator is the signed-in demo commuter, allowlisted for this run only; the other account is not.
  process.env.AUTOMATION_OPERATOR_SUBS = subOf(operator);
  const jobsPath = join(scratch, 'jobs.sqlite');
  new JobStore(jobsPath).close();
  process.env.AUTOMATION_JOBS_DB = jobsPath;
  environment = await startEnvironment();
  const other = await tokenFor('bassem');

  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.setDefaultTimeout(45000);
  await page.goto(environment.appUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  const accountId = await page.getByRole('combobox', { name: 'Current account', exact: true }).inputValue();

  // Another signed-in account is refused by the same route.
  const refused = await fetch(`${environment.coreUrl}/api/payments/automation-kill-switch?accountId=${accountId}`, { headers: { Authorization: `Bearer ${other}` } });
  assert.equal(refused.status, 403, 'an account that is not an operator cannot read the switch');

  await page.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Show kill switch', exact: true }).click();
  await page.getByText('Running', { exact: true }).waitFor();
  assert.equal(new JobStore(jobsPath).killSwitch().engaged, false);

  // Stopping needs a reason, and then the worker's store records the stop.
  await page.getByRole('button', { name: 'Stop automation', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Give a reason before engaging' }).waitFor();
  assert.equal(new JobStore(jobsPath).killSwitch().engaged, false, 'no stop without a reason');
  await page.getByLabel('Reason for stopping').fill('journey check');
  const stopped = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/automation-kill-switch' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Stop automation', exact: true }).click();
  assert.equal((await stopped).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Automation is stopped' }).waitFor();
  const engaged = new JobStore(jobsPath).killSwitch();
  assert.equal(engaged.engaged, true, 'the worker\'s store records the stop');
  assert.equal(engaged.reason, 'journey check');

  // Releasing lets automation run again, and the panel shows it.
  const released = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/automation-kill-switch' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Let automation run again', exact: true }).click();
  assert.equal((await released).status(), 200);
  await page.getByRole('status').filter({ hasText: 'Automation may run again' }).waitFor();
  assert.equal(new JobStore(jobsPath).killSwitch().engaged, false, 'the worker\'s store records the release');
  console.log('PASS: an allowlisted automation operator stops and releases the worker from the payments panel; a reason is required and other accounts are refused.');
} finally {
  delete process.env.AUTOMATION_OPERATOR_SUBS;
  delete process.env.AUTOMATION_JOBS_DB;
  await browser?.close();
  await environment?.cleanup();
  removeTemp(scratch);
}
