/** Resident intent: use the Flutter web shell in Arabic (QA-06). A saved Arabic choice translates the tool controls and the send
 *  control, and they stay at least 44px with nothing scrolling sideways, on the phone and desktop projects. The gateway is stubbed so
 *  the page is measured as laid out. Build the Flutter web app first (`npm run build:flutter`). */
import { test, expect } from '../flutter.ts';

test('the Flutter web shell follows a saved Arabic choice and keeps its controls reachable', async ({ page, flutterUrl }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cityside.locale', 'ar'); } catch { /* the browser language still applies */ } });
  await page.route('http://localhost:4000/**', route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': flutterUrl, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const value = path === '/api/auth/config' ? { enabled: false }
      : path === '/api/accounts' ? { accounts: [{ id: 'test-account', label: 'Personal account' }], user: { name: 'Demo resident' } }
      : path === '/health' ? { llm: { enabled: false } }
      : path === '/api/connections' ? { providers: [], calls: [] }
      : { success: true };
    return route.fulfill({ json: value, headers });
  });
  await page.goto(flutterUrl);
  await page.locator('flt-semantics-placeholder').waitFor();
  await page.locator('flt-semantics-placeholder').evaluate((element: HTMLElement) => element.click());

  const send = page.getByRole('button', { name: 'إرسال', exact: true });
  await expect(send).toBeVisible({ timeout: 30000 });
  const box = await send.boundingBox();
  expect(box!.width, 'the send control is at least 44px wide').toBeGreaterThanOrEqual(44);
  expect(box!.height, 'the send control is at least 44px tall').toBeGreaterThanOrEqual(44);

  if (page.viewportSize()!.width < 900) {
    await page.getByRole('button', { name: 'Workspace tools' }).click();
    await expect(page.getByRole('menuitem', { name: 'روابط الخدمات', exact: true })).toBeVisible();
  } else {
    const connections = page.getByRole('button', { name: 'روابط الخدمات', exact: true });
    await expect(connections).toBeVisible();
    const tool = await connections.boundingBox();
    expect(Math.min(tool!.width, tool!.height), 'the Connections tool is at least 44px').toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), 'nothing scrolls sideways').toBe(false);
});
