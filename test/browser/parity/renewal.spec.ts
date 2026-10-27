import { mergeTests } from 'playwright/test';
import { test as angularTest, expect } from '../angular.ts';
import { test as flutterTest, enterFlutterAccessToken } from '../flutter.ts';
import { test as focusedTest } from '../focused-agent/fixtures.ts';
const test = mergeTests(angularTest, flutterTest, focusedTest);

for (const shell of ['react', 'angular', 'flutter'] as const) {
  test(`${shell} requires separate exact approvals for fines and vehicle renewal`, async ({ page, angularUrl, flutterUrl, focused }) => {
    if (shell !== 'react') {
      const pattern = shell === 'flutter' ? 'http://127.0.0.1:4300/api/agent/**' : '**/api/agent/**';
      const origin = shell === 'flutter' ? flutterUrl : angularUrl;
      await page.route(pattern, async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        const response = await route.fetch({ url: new URL(new URL(route.request().url()).pathname, focused.url).href });
        await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } });
      });
    }
    await page.goto(shell === 'react' ? focused.url : `${shell === 'angular' ? angularUrl : flutterUrl}/services/fines`);
    if (shell === 'flutter') { await page.locator('flt-semantics-placeholder').waitFor(); await page.locator('flt-semantics-placeholder').evaluate((element: HTMLElement) => element.click()); }
    if (shell === 'flutter') await enterFlutterAccessToken(page, focused.renewalToken);
    else await page.getByLabel('Access token', { exact: true }).fill(focused.renewalToken);
    await page.getByRole('button', { name: 'Open my fines', exact: true }).click();
    await page.getByRole('button', { name: 'Renew vehicle registration', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toBeVisible();
    expect(focused.payments()).toBe(0); expect(focused.renewals()).toBe(0);
    await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm simulated renewal', exact: true })).toBeVisible();
    expect(focused.payments()).toBe(1); expect(focused.renewals()).toBe(0);
    await focused.restart();
    await page.getByRole('button', { name: 'Inspect saved conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm simulated renewal', exact: true }).click();
    expect(focused.payments()).toBe(1);
    await expect.poll(() => focused.renewals()).toBe(1);
    await expect(page.getByRole('button', { name: 'Confirm simulated renewal', exact: true })).toBeHidden();
  });
}
