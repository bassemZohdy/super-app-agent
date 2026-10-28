import { mergeTests } from 'playwright/test';
import { test as flutterTest, expect, enterFlutterAccessToken } from '../flutter.ts';
import { test as focusedTest } from '../focused-agent/fixtures.ts';
const test = mergeTests(flutterTest, focusedTest);

test('Flutter web completes the same Keycloak authorization-code sign-in as the TypeScript shells', async ({ page, flutterUrl }) => {
  let passwordGrant = false, authorizationCode = false;
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/token')) { const body = new URLSearchParams(request.postData() || ''); passwordGrant ||= body.get('grant_type') === 'password'; authorizationCode ||= body.get('grant_type') === 'authorization_code'; } });
  await page.goto(flutterUrl);
  await page.locator('flt-semantics-placeholder').waitFor(); await page.locator('flt-semantics-placeholder').evaluate((element: HTMLElement) => element.click());
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter'); await page.locator('#password').fill('demo123'); await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === flutterUrl);
  const semantics = page.locator('flt-semantics-placeholder'); await semantics.waitFor(); await semantics.evaluate((element: HTMLElement) => element.click());
  await expect(page.getByText('Alex Commuter', { exact: true })).toBeVisible();
  expect(authorizationCode).toBe(true); expect(passwordGrant).toBe(false);
});

test('Flutter web shows the selected provider and exposes the new workspace tools', async ({ page, flutterUrl }) => {
  await page.route('http://localhost:4000/**', route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': flutterUrl, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const value = path === '/api/auth/config' ? { enabled: false } : path === '/api/accounts' ? { accounts: [{ id: 'test-account', label: 'Personal account' }], user: { name: 'Demo resident' } } : path === '/health' ? { llm: { enabled: true, provider: 'litellm', model: 'glm-5.3', configured: true, ready: true } } : path === '/api/connections' ? { providers: [], calls: [] } : { success: true };
    return route.fulfill({ json: value, headers });
  });
  await page.goto(flutterUrl);
  await page.locator('flt-semantics-placeholder').waitFor(); await page.locator('flt-semantics-placeholder').evaluate((element: HTMLElement) => element.click());
  await expect(page.getByText('LiteLLM ready', { exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 900) { await page.getByRole('button', { name: 'Workspace tools' }).click(); await expect(page.getByRole('menuitem', { name: 'Connections', exact: true })).toBeVisible(); }
  else {
    await expect(page.getByRole('button', { name: 'Connections', exact: true })).toBeVisible();
    const slider = page.getByRole('slider', { name: 'Resize conversation and service details', exact: true });
    await expect(slider).toBeVisible({ timeout: 5000 });
    const container = page.locator('flt-semantics[flt-semantics-identifier^="cityside.workspace-divider."]');
    expect((await container.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const input = container.locator('input[type="range"]');
    await container.evaluate(element => element.setAttribute('aria-label', 'Updated divider label'));
    await expect(page.getByRole('slider', { name: 'Updated divider label', exact: true })).toBeVisible();
    await container.evaluate(element => element.setAttribute('aria-label', 'Resize conversation and service details'));
    await expect(slider).toBeVisible();
    await input.evaluate(element => element.setAttribute('aria-label', 'Engine-provided name'));
    await expect(page.getByRole('slider', { name: 'Engine-provided name', exact: true })).toBeVisible();
    await expect(input).not.toHaveAttribute('aria-labelledby', /.+/);
    await input.evaluate(element => element.removeAttribute('aria-label'));
    await expect(slider).toBeVisible();
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'range'; input.id = 'unrelated-slider'; document.body.appendChild(input); });
    await expect(page.locator('#unrelated-slider')).not.toHaveAttribute('aria-labelledby', /.+/);
    await expect(slider).toHaveAttribute('aria-valuetext', '50% conversation');
    await slider.focus(); await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', '55% conversation');
    await page.getByRole('button', { name: 'Maximize conversation', exact: true }).click();
    await expect(slider).toHaveCount(0);
    await page.getByRole('button', { name: 'Restore conversation', exact: true }).click();
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('aria-valuetext', '55% conversation');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(slider).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(slider).toBeVisible();
  }
});

test('Flutter web uses the same exact focused approval before making a simulated payment', async ({ page, flutterUrl, focused }) => {
  await page.route('http://127.0.0.1:4300/api/agent/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': flutterUrl, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(url.pathname, focused.url).href });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': flutterUrl } });
  });
  await page.goto(`${flutterUrl}/services/fines`);
  await page.locator('flt-semantics-placeholder').waitFor(); await page.locator('flt-semantics-placeholder').evaluate((element: HTMLElement) => element.click());
  await enterFlutterAccessToken(page, focused.token);
  await page.getByRole('button', { name: 'Open my fines', exact: true }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await expect(page.getByText('Simulated total: AED 450.00', { exact: true })).toBeVisible(); expect(focused.payments()).toBe(0);
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await expect(page.getByText('Your simulated receipt', { exact: true })).toBeVisible(); expect(focused.payments()).toBe(1);
});
