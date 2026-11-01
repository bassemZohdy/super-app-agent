/** Resident intent: use the Angular shell the way the React shell is used (QA-06). Signs in through Keycloak with the authorization
 *  code, switches account without carrying a conversation across, reads the Connections view and starts in Arabic. These run against
 *  the real gateway and Keycloak on the Compose stack, not the stubbed one, on the phone and desktop projects. */
import type { Page } from 'playwright/test';
import { expect, test } from '../angular.ts';
import { controlsBelowTarget } from '../accessibility/measures.ts';

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function signIn(page: Page, angularUrl: string) {
  const grants: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/token')) grants.push(new URLSearchParams(request.postData() || '').get('grant_type') || '');
  });
  await page.goto(angularUrl);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === angularUrl);
  await page.getByRole('combobox', { name: 'Current account', exact: true }).waitFor({ timeout: 60000 });
  return grants;
}

test('Angular signs in with the Keycloak authorization code, never a password grant', async ({ page, angularUrl }) => {
  const grants = await signIn(page, angularUrl);
  expect(grants).toContain('authorization_code');
  expect(grants).not.toContain('password');
  await expect(page.getByRole('combobox', { name: 'Current account', exact: true })).toBeVisible();
  expect(await controlsBelowTarget(page), 'every control reaches 44px').toEqual([]);
});

test('Angular account switch leaves nothing of the old conversation on screen', async ({ page, angularUrl }) => {
  await signIn(page, angularUrl);
  const message = 'Show my wallet balance please';
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  const accounts = page.getByRole('combobox', { name: 'Current account', exact: true });
  const other = await accounts.locator('option').evaluateAll(options => (options as HTMLOptionElement[]).filter(option => !option.selected).map(option => option.value)[0]);
  expect(other, 'the resident has a second account to switch to').toBeTruthy();
  await accounts.selectOption(other);
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
});

test('Angular Connections lists the providers and fits the screen', async ({ page, angularUrl }) => {
  await signIn(page, angularUrl);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  // On a phone only one pane shows; the Connections view is in Service details.
  const views = page.getByRole('group', { name: 'Workspace views', exact: true });
  if (await views.isVisible()) await views.getByRole('button', { name: 'Service details', exact: true }).click();
  const view = page.getByRole('region', { name: 'Connections', exact: true });
  // One line per provider, each reachable with the operations it advertises.
  const reachable = view.getByText(/^Reachable · \d+ operations advertised$/);
  await expect(reachable).toHaveCount(7, { timeout: 60000 });
  expect(await controlsBelowTarget(page), 'every control reaches 44px').toEqual([]);
  expect(await sideways(page), 'nothing scrolls sideways').toBe(false);
});

test('Angular main shell starts in Arabic from a saved choice and still fits', async ({ page, angularUrl }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cityside.locale', 'ar'); } catch { /* the browser language still applies */ } });
  await page.goto(angularUrl);
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['ar', 'rtl']);
  await expect(page.getByRole('heading', { name: 'مدينتك. حسابك.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تسجيل الدخول عبر Keycloak', exact: true })).toBeVisible();
  expect(await controlsBelowTarget(page), 'every control reaches 44px').toEqual([]);
  expect(await sideways(page), 'nothing scrolls sideways').toBe(false);
});
