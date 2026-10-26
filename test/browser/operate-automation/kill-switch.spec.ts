/** Operator intent: stop automation, then let it run again (AUTO-15). An allowlisted operator stops and releases the worker's
 *  kill switch from the payments panel; another signed-in account is refused. Real Keycloak sign-in; the job store is a scratch
 *  file for this worker only. Ported from scripts/e2e/kill-switch-panel.ts. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keycloakIssuerUrl } from '../../../scripts/endpoints.ts';
import { startEnvironment } from '../../../scripts/e2e/environment.ts';
import { JobStore } from '../../../services/automation-worker/src/jobs.ts';
import { removeTemp } from '../../support/temp-cleanup.ts';
import { expect, test as base } from '../fixtures.ts';

const tokenFor = async (username: string) => {
  const response = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
  expect(response.status).toBe(200);
  return (await response.json() as { access_token: string }).access_token;
};
const subOf = (bearer: string) => JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub as string;

type Run = { coreUrl: string; appUrl: string; jobsPath: string; otherToken: string };
const test = base.extend<object, { run: Run }>({
  run: [async ({ }, use) => {
    const scratch = mkdtempSync(join(tmpdir(), 'cityside-killswitch-panel-'));
    const operator = await tokenFor('demo-commuter');
    // The operator is the signed-in demo commuter, allowlisted for this run only; the other account is not.
    process.env.AUTOMATION_OPERATOR_SUBS = subOf(operator);
    const jobsPath = join(scratch, 'jobs.sqlite');
    new JobStore(jobsPath).close();
    process.env.AUTOMATION_JOBS_DB = jobsPath;
    const environment = await startEnvironment();
    try { await use({ coreUrl: environment.coreUrl, appUrl: environment.appUrl, jobsPath, otherToken: await tokenFor('bassem') }); }
    finally {
      delete process.env.AUTOMATION_OPERATOR_SUBS; delete process.env.AUTOMATION_JOBS_DB;
      await environment.cleanup(); removeTemp(scratch);
    }
  }, { scope: 'worker' }],
});

test('an allowlisted operator stops and releases automation; a reason is required and other accounts are refused', async ({ page, run, isMobile }) => {
  test.skip(isMobile, 'QA-06: at phone width the account switcher is not in the header, so this journey cannot reach it yet.');
  await page.goto(run.appUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  const accountId = await page.getByRole('combobox', { name: 'Current account', exact: true }).inputValue();

  // Another signed-in account is refused by the same route.
  const refused = await fetch(`${run.coreUrl}/api/payments/automation-kill-switch?accountId=${accountId}`, { headers: { Authorization: `Bearer ${run.otherToken}` } });
  expect(refused.status, 'an account that is not an operator cannot read the switch').toBe(403);

  await page.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Show kill switch', exact: true }).click();
  await page.getByText('Running', { exact: true }).waitFor();
  expect(new JobStore(run.jobsPath).killSwitch().engaged).toBe(false);

  // Stopping needs a reason, and then the worker's store records the stop.
  await page.getByRole('button', { name: 'Stop automation', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Give a reason before engaging' }).waitFor();
  expect(new JobStore(run.jobsPath).killSwitch().engaged, 'no stop without a reason').toBe(false);
  await page.getByLabel('Reason for stopping').fill('journey check');
  const stopped = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/automation-kill-switch' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Stop automation', exact: true }).click();
  expect((await stopped).status()).toBe(200);
  await page.getByRole('status').filter({ hasText: 'Automation is stopped' }).waitFor();
  const engaged = new JobStore(run.jobsPath).killSwitch();
  expect(engaged.engaged, 'the worker\'s store records the stop').toBe(true);
  expect(engaged.reason).toBe('journey check');

  // Releasing lets automation run again, and the panel shows it.
  const released = page.waitForResponse(res => new URL(res.url()).pathname === '/api/payments/automation-kill-switch' && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Let automation run again', exact: true }).click();
  expect((await released).status()).toBe(200);
  await page.getByRole('status').filter({ hasText: 'Automation may run again' }).waitFor();
  expect(new JobStore(run.jobsPath).killSwitch().engaged, 'the worker\'s store records the release').toBe(false);
});
