/** Operator intent: run a failure scenario on an isolated run, then start over (SIM-05). A real isolated payment run starts with the
 *  local scenario console beside it. The operator arms and clears failpoints, exports the run and resets it from the page; a resident
 *  signed in with real Keycloak cannot choose outcomes, reset funds or reach the console. */
import { keycloakIssuerUrl, providerPaymentsUrl } from '../../../scripts/endpoints.ts';
import { startEnvironment } from '../../../scripts/e2e/environment.ts';
import { startOperatorConsole, type RunningConsole } from '../../../scripts/operator-console/console.ts';
import { describedFailpoints } from '../../../scripts/operator-console/failpoints.ts';
import { providerRunControls, refreshingToken } from '../../../scripts/operator-console/provider-controls.ts';
import { verifyJwt } from '../../../packages/backend-kit/src/jwt.ts';
import { accountIdFor } from '../../../packages/backend-kit/src/context.ts';
import { expect, test as base } from '../fixtures.ts';
import { controlsBelowTarget, unseenFocusStops } from '../accessibility/measures.ts';

const login = async (username: string) => {
  const response = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
  expect(response.status).toBe(200);
  return (await response.json() as { access_token: string }).access_token;
};

type Scenario = { run: ReturnType<typeof providerRunControls>; console: RunningConsole; coreUrl: string; controlBase: string; resident: { token: string; accountId: string } };
const test = base.extend<object, { scenario: Scenario }>({
  scenario: [async ({ }, use) => {
    process.env.KEYCLOAK_ISSUER = keycloakIssuerUrl;
    process.env.KEYCLOAK_JWKS_URL = `${keycloakIssuerUrl}/protocol/openid-connect/certs`;
    const token = refreshingToken(() => login('bassem'));
    const operator = await verifyJwt(`Bearer ${await token()}`, 'provider-api');
    const environment = await startEnvironment({ issuerOperatorSub: operator.sub });
    const controlBase = `http://localhost:${environment.corePort + 107}`;
    const run = providerRunControls({ base: controlBase, runId: environment.issuerRunId!, operator: 'bassem', token });
    const console_ = await startOperatorConsole({ controls: run, failpoints: describedFailpoints() });
    const residentToken = await login('demo-commuter'), resident = await verifyJwt(`Bearer ${residentToken}`, 'agent-core');
    try { await use({ run, console: console_, coreUrl: environment.coreUrl, controlBase, resident: { token: residentToken, accountId: accountIdFor(resident.sub, 'personal') } }); }
    finally { await console_.close(); await environment.cleanup(); }
  }, { scope: 'worker' }],
});

test.describe.configure({ mode: 'serial' });

test('the console opens only from the launch link', async ({ page, scenario }) => {
  await page.goto(scenario.console.url);
  await expect(page.getByText('Open the link printed by the launcher.')).toBeVisible();
  const withoutCookie = await page.evaluate(async () => (await fetch('/api/state', { headers: { 'X-Console-Request': '1' } })).status);
  expect(withoutCookie).toBe(401);
  await page.goto(scenario.console.launchUrl);
  await expect(page.getByRole('heading', { name: 'Scenario console' })).toBeVisible();
  expect(page.url(), 'the secret is gone from the address bar').toBe(scenario.console.url);
  await expect(page.getByText('Ready.')).toBeVisible();
});

test('the operator arms and clears a failpoint, and the run itself confirms it', async ({ page, scenario }) => {
  await page.goto(scenario.console.launchUrl);
  await expect(page.getByRole('definition').filter({ hasText: /^simrun_/ })).toBeVisible();
  await page.getByLabel('Failpoint', { exact: true }).selectOption('checkout.after-admission');
  await page.getByLabel('Next hits (1 to 100)').fill('2');
  await page.getByRole('button', { name: 'Arm failpoint' }).click();
  await expect(page.getByRole('status')).toHaveText('Armed checkout.after-admission for its next 2 hits.');
  await expect(page.getByText('checkout.after-admission: armed, 2 hits left; fired 0 times')).toBeVisible();
  await expect(page.getByText(/ARMED · checkout\.after-admission ×2/)).toBeVisible();
  const armed = (await scenario.run.status()).armed!.find(point => point.name === 'checkout.after-admission')!;
  expect(armed.remaining, 'the provider agrees, not only the page').toBe(2);
  await page.getByRole('button', { name: 'Clear all failpoints' }).click();
  await expect(page.getByRole('status')).toHaveText('All failpoints are cleared.');
  await expect(page.getByText('checkout.after-admission: not armed; fired 0 times')).toBeVisible();
  expect((await scenario.run.status()).armed!.every(point => point.remaining === 0)).toBe(true);
});

test('the export downloads the run as read-only JSON with no secrets', async ({ page, scenario }) => {
  await page.goto(scenario.console.launchUrl);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this run' }).click();
  const file = await download, path = await file.path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  expect(file.suggestedFilename()).toMatch(/^scenario-run-simrun_/);
  expect(JSON.parse(text).runId).toMatch(/^simrun_/);
  expect(text).not.toMatch(/Bearer|eyJ[A-Za-z0-9_-]{10,}/);
});

test('a reset asks twice, can be cancelled, and then replaces the run with a fresh one', async ({ page, scenario }) => {
  // Give the run some state: a resident's first look seeds their wallet, so the run has an account to lose.
  const seeded = await fetch(`${scenario.coreUrl}/api/payments/overview?accountId=${scenario.resident.accountId}`, { headers: { Authorization: `Bearer ${scenario.resident.token}` } });
  expect(seeded.status).toBe(200);
  expect((await scenario.run.inspect()).accounts!.length, 'the run now has an account').toBeGreaterThan(0);
  await scenario.run.arm('funding.after-commit', 1, 'seed_key_00001');

  await page.goto(scenario.console.launchUrl);
  await expect(page.getByRole('rowheader').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset this run…' }).click();
  await expect(page.getByText("This deletes the run's funds, orders and history.")).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status')).toHaveText('The reset was cancelled.');
  expect((await scenario.run.inspect()).accounts!.length, 'cancelling changed nothing').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Reset this run…' }).click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByRole('status')).toHaveText('The run was reset. Accounts are created again, with fresh funds, on first use.', { timeout: 60_000 });
  await expect(page.getByText('No account has been used in this run yet.')).toBeVisible();
  expect((await scenario.run.inspect()).accounts, 'the previous run state is gone').toEqual([]);
  expect((await scenario.run.status()).armed!.every(point => point.remaining === 0), 'armed failpoints are dropped').toBe(true);

  // The same run identity, reseeded on first use: the resident's wallet is back to its starting balance.
  const again = await fetch(`${scenario.coreUrl}/api/payments/overview?accountId=${scenario.resident.accountId}`, { headers: { Authorization: `Bearer ${scenario.resident.token}` } });
  expect(again.status).toBe(200);
  expect((await scenario.run.inspect()).accounts![0].walletMinor).toBe(150000);
});

test('a signed-in resident cannot choose outcomes, reset funds or reach the console', async ({ page, scenario }) => {
  const control = `${scenario.controlBase}/internal/scenario-controls/${(await scenario.run.status(), scenario.run.runId)}`;
  const headers = { Authorization: `Bearer ${scenario.resident.token}`, 'Content-Type': 'application/json' };
  for (const [method, path, body] of [['GET', '', undefined], ['GET', '/inspect', undefined], ['GET', '/export', undefined], ['POST', '/arm', { name: 'funding.after-commit', times: 1, requestKey: 'resident_key_001' }], ['POST', '/clear', {}], ['POST', '/reset', { requestKey: 'resident_key_002' }]] as const) {
    const response = await fetch(`${control}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(response.status, `${method} ${path || '/'} as a resident`).toBe(403);
  }
  const normal = await fetch(`${providerPaymentsUrl}/internal/scenario-controls/${scenario.run.runId}`, { headers });
  expect([403, 404], 'the normal demo provider exposes no controls').toContain(normal.status);
  expect((await scenario.run.status()).armed!.every(point => point.remaining === 0), 'nothing the resident tried changed the run').toBe(true);
  // A resident's own browser has no cookie for the console, whatever it sends.
  await page.goto(scenario.console.url);
  const attempts = await page.evaluate(async () => (await Promise.all(['/api/state', '/api/export'].map(path => fetch(path, { headers: { 'X-Console-Request': '1' } }))) ).map(response => response.status));
  expect(attempts).toEqual([401, 401]);
});

test('the console page meets the touch and focus floor', async ({ page, scenario }) => {
  await page.goto(scenario.console.launchUrl);
  await expect(page.getByText('Ready.')).toBeVisible();
  expect(await controlsBelowTarget(page)).toEqual([]);
  await page.getByRole('heading', { name: 'Scenario console' }).click();
  await page.keyboard.press('Tab');
  expect(await unseenFocusStops(page, 10)).toEqual([]);
});
