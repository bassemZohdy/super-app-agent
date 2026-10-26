/** A signed-in resident on the local stack for journeys (QA-09, QA-04, P2-14). Every test gets its own browser context, signed in
 *  through the real Keycloak login. `stack.payments` and `stack.stores` are the run's own databases, for journeys that must assert the
 *  ledger journal and the providers' records, not only what the API reports.
 *
 *  Two flavors share the same fixtures: `test` starts one environment per worker (fast, for read-only measures such as the
 *  accessibility specs), and `isolatedTest` starts a fresh environment for every test, so a journey that pays, refunds or links
 *  starts from the seed and cannot disturb the next one. */
import { keycloakIssuerUrl } from '../../scripts/endpoints.ts';
import { startEnvironment } from '../../scripts/e2e/environment.ts';
import type { AccountDatabase } from '../../services/provider-simulator/src/database.ts';
import type { PayableProvider, ProviderPayables } from '../../services/provider-simulator/src/payables.ts';
import { providerRunControls, refreshingToken } from '../../scripts/operator-console/provider-controls.ts';
import type { RunControls } from '../../scripts/operator-console/console.ts';
import { expect, test as base } from './fixtures.ts';
import { withAccountSwitcher } from './layout.ts';

export type Stack = { appUrl: string; coreUrl: string; corePort: number; payments: AccountDatabase; stores: ReadonlyMap<string, AccountDatabase>;
  /** A provider's own bill book, so a journey can change what a provider owes after the resident reviewed it. */
  payableBook: (provider: PayableProvider) => ProviderPayables };
export type ResidentApi = { accountId: string; token: string; call: (path: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; data: any }> };
type Page = import('playwright/test').Page;
/** An isolated run the operator controls: issuer presets for a card, and named failpoints. The resident cannot choose either. */
export type Scenario = {
  /** The authorization clock of this run: it stands still until a journey advances it, so an unattended challenge can expire on demand. */
  clock: { now: () => number; advance: (ms: number) => void };
  runId: string; controlBase: string; controls: RunControls; restartPayments: () => Promise<void>;
  /** The issuer-scenario routes, as the signed operator (or as another bearer, to prove a resident is refused). */
  admin: (path?: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; data: any }>;
};

export const login = async (username: string) => {
  const response = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
  expect(response.status, `sign-in as ${username}`).toBe(200);
  return (await response.json() as { access_token: string }).access_token;
};

async function startStack(options: { isolatedRun?: boolean } = {}): Promise<{ stack: Stack; scenario?: Scenario; stop: () => Promise<void> }> {
  let operatorSub: string | undefined, operatorToken: (() => Promise<string>) | undefined;
  if (options.isolatedRun) {
    process.env.KEYCLOAK_ISSUER = keycloakIssuerUrl;
    process.env.KEYCLOAK_JWKS_URL = `${keycloakIssuerUrl}/protocol/openid-connect/certs`;
    const bearer = await login('bassem');
    operatorSub = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub as string;
    operatorToken = refreshingToken(() => login('bassem'));
  }
  let now = Date.now();
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const environment = await startEnvironment(operatorSub ? { issuerOperatorSub: operatorSub, authorizationClock: clock.now } : {});
  const stack: Stack = { appUrl: environment.appUrl, coreUrl: environment.coreUrl, corePort: environment.corePort, payments: environment.providerStores.get('payments')!, stores: environment.providerStores, payableBook: provider => environment.payableBook(provider) };
  let scenario: Scenario | undefined;
  if (operatorSub && environment.issuerRunId) {
    const controlBase = `http://localhost:${environment.corePort + 107}`, runId = environment.issuerRunId, token = operatorToken!;
    scenario = {
      clock, runId, controlBase, restartPayments: () => environment.restartPayments(), controls: providerRunControls({ base: controlBase, runId, operator: 'bassem', token }),
      admin: async (path = '', body, bearer) => {
        const response = await fetch(`${controlBase}/internal/issuer-scenarios/${runId}${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${bearer ?? await token()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      },
    };
  }
  return { stack, scenario, stop: () => environment.cleanup() };
}

async function signIn(page: Page, stack: Stack) {
  await page.goto(stack.appUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  await withAccountSwitcher(page, async () => {});
  return page;
}

/** The resident's own API view, for asserting outcomes beside the page. Reads and writes carry the account and a fresh request key. */
async function residentApiFor(page: Page, stack: Stack): Promise<ResidentApi> {
  const token = await login('demo-commuter'), accountId = await withAccountSwitcher(page, switcher => switcher.inputValue());
  const call: ResidentApi['call'] = async (path, body, bearer = token) => {
    const response = await fetch(`${stack.coreUrl}/api/payments/${path}${body ? '' : `?accountId=${accountId}`}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ accountId, ...(path === 'fine-selection-preview' ? {} : { requestKey: crypto.randomUUID() }), ...body }) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  return { accountId, token, call };
}

export const test = base.extend<{ resident: Page; residentApi: ResidentApi }, { stack: Stack }>({
  stack: [async ({ }, use) => { const { stack, stop } = await startStack(); try { await use(stack); } finally { await stop(); } }, { scope: 'worker' }],
  resident: async ({ page, stack }, use) => { await use(await signIn(page, stack)); },
  residentApi: async ({ resident, stack }, use) => { await use(await residentApiFor(resident, stack)); },
});

export const isolatedTest = base.extend<{ stack: Stack; resident: Page; residentApi: ResidentApi }>({
  stack: async ({ }, use) => { const { stack, stop } = await startStack(); try { await use(stack); } finally { await stop(); } },
  resident: async ({ page, stack }, use) => { await use(await signIn(page, stack)); },
  residentApi: async ({ resident, stack }, use) => { await use(await residentApiFor(resident, stack)); },
});

/** Like `isolatedTest`, on an isolated run with the operator wired in (issuer presets and failpoints), for failure journeys. */
export const scenarioTest = base.extend<{ run: Awaited<ReturnType<typeof startStack>>; stack: Stack; scenario: Scenario; resident: Page; residentApi: ResidentApi }>({
  run: async ({ }, use) => { const started = await startStack({ isolatedRun: true }); try { await use(started); } finally { await started.stop(); } },
  stack: async ({ run }, use) => { await use(run.stack); },
  scenario: async ({ run }, use) => { await use(run.scenario!); },
  resident: async ({ page, stack }, use) => { await use(await signIn(page, stack)); },
  residentApi: async ({ resident, stack }, use) => { await use(await residentApiFor(resident, stack)); },
});

export { expect };
