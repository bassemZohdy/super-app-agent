/** A signed-in resident on the local stack for journeys that only need the app (QA-09, P2-14). One environment per worker;
 *  every test still gets its own browser context, signed in through the real Keycloak login. */
import { startEnvironment } from '../../scripts/e2e/environment.ts';
import { expect, test as base } from './fixtures.ts';
import { withAccountSwitcher } from './layout.ts';

type Stack = { appUrl: string; coreUrl: string };
export const test = base.extend<{ resident: import('playwright/test').Page }, { stack: Stack }>({
  stack: [async ({ }, use) => {
    const environment = await startEnvironment();
    try { await use({ appUrl: environment.appUrl, coreUrl: environment.coreUrl }); } finally { await environment.cleanup(); }
  }, { scope: 'worker' }],
  resident: async ({ page, stack }, use) => {
    await page.goto(stack.appUrl);
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill('demo-commuter');
    await page.locator('#password').fill('demo123');
    await page.locator('#kc-login').click();
    await withAccountSwitcher(page, async () => {});
    await use(page);
  },
});

export { expect };
