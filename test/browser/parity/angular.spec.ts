import { mergeTests } from 'playwright/test';
import { test as angularTest, expect } from '../angular.ts';
import { test as focusedTest } from '../focused-agent/fixtures.ts';
const test = mergeTests(angularTest, focusedTest);

test('Angular keeps conversation, details and composer clear of book and clamshell hinges', async ({ angular }) => {
  const cdp = await angular.context().newCDPSession(angular);
  const chat = angular.getByRole('region', { name: 'conversation pane', exact: true });
  const details = angular.getByRole('region', { name: 'service details pane', exact: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 824, height: 900, screenWidth: 824, screenHeight: 900, deviceScaleFactor: 1, mobile: true, displayFeature: { orientation: 'vertical', offset: 400, maskLength: 24 }, devicePosture: { type: 'folded' } });
  await expect.poll(async () => (await chat.boundingBox())!.x + (await chat.boundingBox())!.width, { timeout: 5000 }).toBeLessThanOrEqual(400);
  expect((await details.boundingBox())!.x).toBeGreaterThanOrEqual(424);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, screenWidth: 600, screenHeight: 900, deviceScaleFactor: 1, mobile: true, displayFeature: { orientation: 'horizontal', offset: 438, maskLength: 24 }, devicePosture: { type: 'folded' } });
  await expect.poll(async () => (await chat.boundingBox())!.y + (await chat.boundingBox())!.height, { timeout: 5000 }).toBeLessThanOrEqual(438);
  expect((await details.boundingBox())!.y).toBeGreaterThanOrEqual(462);
  await expect(angular.getByRole('textbox', { name: 'Chat message' })).toBeInViewport({ ratio: 1 });
  await cdp.send('Emulation.clearDisplayFeaturesOverride'); await cdp.send('Emulation.clearDevicePostureOverride'); await cdp.detach();
});

test('Angular names the shared provider and preserves drafts through pane controls', async ({ angular }) => {
  await angular.route('http://localhost:4000/health', route => route.fulfill({ json: { llm: { provider: 'litellm', model: 'glm-5.3', enabled: true, configured: true, ready: true } }, headers: { 'access-control-allow-origin': 'http://localhost:3001' } }));
  await angular.reload(); await expect(angular.getByRole('status').filter({ hasText: 'LiteLLM ready' })).toBeVisible();
  await angular.setViewportSize({ width: 1280, height: 900 });
  const chat = angular.getByRole('region', { name: 'conversation pane', exact: true });
  const details = angular.getByRole('region', { name: 'service details pane', exact: true });
  expect(Math.abs((await chat.boundingBox())!.width - (await details.boundingBox())!.width)).toBeLessThan(2);
  const draft = angular.getByRole('textbox', { name: 'Chat message' }); await draft.fill('Preserve this draft');
  const separator = angular.getByRole('separator'); await separator.focus(); await separator.press('ArrowLeft'); await expect(separator).toHaveAttribute('aria-valuenow', '45'); await separator.press('Enter');
  await angular.getByRole('button', { name: 'Swap panes', exact: true }).click();
  expect((await chat.boundingBox())!.x).toBeGreaterThan((await details.boundingBox())!.x);
  await angular.getByRole('button', { name: 'Maximize conversation', exact: true }).click(); await expect(details).toBeHidden();
  await angular.getByRole('button', { name: 'Restore conversation', exact: true }).click(); await expect(details).toBeVisible(); await expect(draft).toHaveValue('Preserve this draft');
  await angular.setViewportSize({ width: 390, height: 800 }); await angular.getByRole('button', { name: 'Service details', exact: true }).click(); await expect(details).toBeVisible(); await angular.getByRole('button', { name: 'Chat', exact: true }).click(); await expect(draft).toHaveValue('Preserve this draft');
});

test('Angular focused fines use the same exact approval and restart recovery contract', async ({ page, angularUrl, focused }) => {
  await page.route('**/api/agent/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(url.pathname, focused.url).href });
    await route.fulfill({ response });
  });
  await page.goto(`${angularUrl}/services/fines`);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines', exact: true }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  const details = page.getByRole('region', { name: 'service details pane', exact: true });
  await expect(details.getByText('AED 450.00', { exact: true })).toBeVisible(); expect(focused.payments()).toBe(0);
  await focused.restart(); await page.reload(); await page.getByLabel('Access token', { exact: true }).fill(focused.token); await page.getByRole('button', { name: 'Open my fines', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await expect(details.getByRole('heading', { name: 'Your simulated receipt', exact: true })).toBeVisible(); expect(focused.payments()).toBe(1);
  await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toBeHidden();
});
