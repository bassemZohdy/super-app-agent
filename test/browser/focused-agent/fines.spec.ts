import type { Page } from 'playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.ts';
import { controlsBelowTarget, focusIsVisible, injectMotionCanary, stillMoving } from '../accessibility/measures.ts';

test('retrieve fines, resume the exact review after restart, pay once and reject duplicate/stale/cross-owner approvals', async ({ page, focused }, info) => {
  await page.goto(focused.url);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  await page.getByRole('button', { name: 'Show outstanding fines', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'fine-1', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message about fines' }).fill('Pay fine-1');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('heading', { name: 'Review before you pay' })).toBeVisible();
  await expect(page.getByText('Simulated total: AED 150.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'fine-2', exact: true })).toHaveCount(0);
  expect(focused.payments()).toBe(0);
  await page.screenshot({ path: info.outputPath('review.png'), fullPage: true });
  const thread = await page.evaluate(() => sessionStorage.getItem('cityside.fines.thread.v1'));
  const root = `${new URL(focused.url).origin}/api/agent/threads/${thread}`;
  const inspect = async (token = focused.token) => page.request.get(root, { headers: { Authorization: `Bearer ${token}` } });
  const review = await (await inspect()).json();
  await focused.restart();
  await page.getByRole('button', { name: 'Inspect saved conversation' }).click();
  await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toBeEnabled();
  expect((await (await inspect()).json()).approval).toEqual(review.approval);
  const request = page.waitForRequest(req => req.url() === `${root}/resume` && req.method() === 'POST');
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  const confirmation = await request;
  await expect(page.getByRole('heading', { name: 'Your simulated receipt' })).toBeVisible();
  expect(focused.payments()).toBe(1);
  await page.screenshot({ path: info.outputPath('receipt.png'), fullPage: true });
  const headers = await confirmation.allHeaders();
  const body = confirmation.postDataJSON();
  const replay = await page.request.post(`${root}/resume`, { headers: { Authorization: `Bearer ${focused.token}`, 'Idempotency-Key': headers['idempotency-key'] }, data: body });
  expect(replay.status()).toBe(200);
  const paid = await replay.json();
  for (const [token, approvalId, status] of [[focused.token, body.approvalId, 409], [focused.token, randomUUID(), 409], [focused.otherToken, body.approvalId, 404]] as const) {
    const refused = await page.request.post(`${root}/resume`, { headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() }, data: { approvalId, decision: 'approve' } });
    expect(refused.status()).toBe(status);
    expect(focused.payments()).toBe(1);
  }
  expect((await inspect(focused.otherToken)).status()).toBe(404);
  await page.reload();
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  await expect(page.getByText(paid.receipt.id, { exact: true })).toBeVisible();
  expect(await page.evaluate(token => [...Object.values(sessionStorage), ...Object.values(localStorage)].some(value => String(value).includes(token)), focused.token)).toBe(false);
});

test('reject and cancel leave payment records unchanged and allow a new conversation', async ({ page, focused }) => {
  await page.goto(focused.url);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  for (const decision of ['Reject payment', 'Cancel review', 'Cancel conversation']) {
    await page.getByRole('button', { name: 'Review payment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toBeVisible();
    await page.getByRole('button', { name: decision, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toHaveCount(0);
    expect(focused.payments()).toBe(0);
    await page.getByRole('button', { name: 'Start a new conversation' }).click();
    await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeEnabled();
  }
});

test('a lost payment result blocks new commands until the original operation is recovered', async ({ page, focused }) => {
  await page.goto(focused.url);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm simulated payment', exact: true })).toBeVisible();
  await page.route('**/api/agent/threads/*/resume', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(focused.payments()).toBe(1);
  await expect(page.getByRole('button', { name: 'Start a new conversation' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message about fines' })).toBeDisabled();
  await page.getByRole('button', { name: 'Recover saved operation' }).click();
  await expect(page.getByRole('heading', { name: 'Your simulated receipt' })).toBeVisible();
  expect(focused.payments()).toBe(1);
});

test('the fines route has labelled controls, touch targets, keyboard focus and no sideways overflow', async ({ page, focused }) => {
  await page.goto(focused.url);
  await page.getByLabel('Access token', { exact: true }).focus();
  expect(await focusIsVisible(page)).toBe(true);
  expect(await controlsBelowTarget(page)).toEqual([]);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review before you pay' })).toBeFocused();
  expect(await controlsBelowTarget(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('icon controls swap panes and toggle maximize/restore without losing the draft', async ({ page, focused }, info) => {
  await page.goto(focused.url);
  await page.getByLabel('Access token', { exact: true }).fill(focused.token);
  await page.getByRole('button', { name: 'Open my fines' }).click();
  const draft = page.getByRole('textbox', { name: 'Message about fines' });
  await draft.fill('Show outstanding fines');
  await page.getByRole('button', { name: 'Swap panes', exact: true }).click();
  expect(await page.locator('[data-pane]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane')))).toEqual(['details', 'conversation']);
  const conversation = page.getByRole('region', { name: 'conversation pane', exact: true });
  const details = page.getByRole('region', { name: 'service details pane', exact: true });
  const first = await details.boundingBox(), second = await conversation.boundingBox();
  expect(info.project.name === 'mobile' ? first!.y < second!.y : first!.x < second!.x).toBe(true);
  await page.getByRole('button', { name: 'Maximize conversation', exact: true }).click();
  await expect(details).toBeHidden(); await expect(draft).toHaveValue('Show outstanding fines');
  await page.screenshot({ path: info.outputPath('conversation-maximized.png'), fullPage: true });
  await page.getByRole('button', { name: 'Restore conversation size', exact: true }).click();
  await expect(draft).toHaveValue('Show outstanding fines');
  await expect(details).toBeVisible();
  await page.getByRole('button', { name: 'Maximize service details', exact: true }).click();
  await expect(conversation).toBeHidden();
  await page.getByRole('button', { name: 'Restore service details size', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review before you pay' })).toBeVisible();
  expect(await controlsBelowTarget(page)).toEqual([]);
  expect(focused.payments()).toBe(0);
});

test('the main concierge also exposes the shared pane layout controls', async ({ page, focused }, info) => {
  const originalViewport = page.viewportSize()!;
  await stubConcierge(page, focused.url);
  await page.goto(new URL('/', focused.url).href);
  await expect(page.getByRole('heading', { name: 'Chat with Rashid', exact: true })).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
  const skip = page.getByRole('link', { name: 'Skip to workspace', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('link', { name: /Review your fines/ })).toHaveAttribute('href', '/services/fines');
  expect(await controlsBelowTarget(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).focus();
  expect(await focusIsVisible(page)).toBe(true);
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).blur();
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.conversation-scroll')?.scrollTo(0, 0); });
  await page.screenshot({ path: info.outputPath('concierge-home.png'), fullPage: true });
  if (info.project.name === 'mobile') {
    const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
    await opener.click();
    const close = page.getByRole('button', { name: 'Close navigation menu', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: /Demo resident/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'Main navigation', exact: true })).toBeHidden();
    await opener.click();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true, includeHidden: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('main')).not.toHaveAttribute('inert');
  }
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
    if (width >= 680) {
      const details = await page.getByRole('region', { name: 'service details pane', exact: true }).boundingBox();
      const chat = await page.getByRole('region', { name: 'conversation pane', exact: true }).boundingBox();
      expect(Math.abs(details!.width - chat!.width)).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize(originalViewport);
  const swap = page.getByRole('button', { name: 'Swap panes', exact: true });
  await expect(swap).toHaveText('');
  await expect(page.getByRole('button', { name: 'Restore split view', exact: true })).toHaveCount(0);
  await expect(page.locator('summary[aria-label="Workspace layout"]')).toHaveCount(0);
  if (info.project.name === 'desktop') {
    const chatBox = await page.getByRole('region', { name: 'conversation pane', exact: true }).boundingBox();
    const detailsBox = await page.getByRole('region', { name: 'service details pane', exact: true }).boundingBox();
    expect(Math.abs(chatBox!.width - detailsBox!.width)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Maximize conversation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'service details pane', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Restore conversation size', exact: true }).click();
  await page.getByRole('button', { name: 'Swap panes', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) < 680) {
    await expect(page.getByRole('button', { name: /Service details/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
  } else {
    expect(await page.locator('[data-pane]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane')))).toEqual(['details', 'conversation']);
  }
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Show test service');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Here are your service details. You can review them in the service workspace.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Keep this draft');
  await page.screenshot({ path: info.outputPath('concierge-conversation.png'), fullPage: true });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Service details/ }).click();
  await expect(page.getByText('Your saved service details', { exact: true })).toBeVisible();
  const pane = await page.getByRole('region', { name: 'service details pane', exact: true }).boundingBox();
  const panel = await page.getByRole('complementary', { name: 'Service details', exact: true }).boundingBox();
  expect(panel!.width).toBeGreaterThan(pane!.width * 0.9);
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toHaveValue('Keep this draft');
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Explain my services');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('Here is a longer explanation.');
  expect(await page.locator('.conversation-scroll').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
  await injectMotionCanary(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await stillMoving(page)).toEqual([]);
  await page.getByRole('button', { name: /Service details/ }).click();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Chat with Rashid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Service details/ }).click();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
});

async function stubConcierge(page: Page, url: string) {
  await page.route('http://localhost:4000/**', route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': new URL(url).origin };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (path.includes('stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', headers, body: ': stub\n\n' });
    if (path === '/api/a2ui/intent') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ success: true, surface: { version: '1.0.0', sessionId: route.request().postDataJSON().sessionId, revision: randomUUID(), timestamp: Date.now(), assistantMessage: { id: randomUUID(), text: route.request().postDataJSON().text === 'Explain my services' ? 'Here is a longer explanation. '.repeat(100) : 'Here are your service details. You can review them in the service workspace.' }, view: { id: 'layout-service', type: 'SurfaceCard', children: [{ id: 'details', type: 'Text', properties: { text: 'Your saved service details' } }] } } }) });
    const value = path === '/api/auth/config' ? { enabled: false } : path === '/api/accounts' ? { accounts: [{ id: 'layout-demo', label: 'Personal account' }], user: { name: 'Demo resident' } } : { success: true };
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(value) });
  });
}

test('phone swap switches the visible view and highlights it without losing the draft', async ({ page, focused }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubConcierge(page, focused.url);
  await page.goto(new URL('/', focused.url).href);
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  const details = page.getByRole('button', { name: 'Service details', exact: true });
  const conversation = page.getByRole('region', { name: 'conversation pane', exact: true });
  const service = page.getByRole('region', { name: 'service details pane', exact: true });
  await page.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Keep this draft');
  await expect(chat).toHaveAttribute('aria-pressed', 'true');
  await conversation.getByRole('button', { name: 'Swap panes' }).click();
  await expect(details).toHaveAttribute('aria-pressed', 'true');
  await expect(service).toBeVisible();
  await expect(conversation).toBeHidden();
  expect(await details.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(await chat.evaluate(element => getComputedStyle(element).backgroundColor));
  await service.getByRole('button', { name: 'Swap panes' }).click();
  await expect(chat).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toHaveValue('Keep this draft');
});

test('the divider starts at 50/50 and supports drag, keyboard, touch and swap without losing drafts', async ({ page, focused }, info) => {
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 824 : 1440, height: 1000 });
  await stubConcierge(page, focused.url);
  await page.goto(new URL('/', focused.url).href);
  const separator = page.getByRole('separator', { name: 'Resize conversation and service details', exact: true });
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  const draft = page.getByRole('textbox', { name: 'Message Rashid', exact: true });
  await draft.fill('Preserve this draft');
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  const before = (await page.getByRole('region', { name: 'conversation pane', exact: true }).boundingBox())!.width;
  await page.getByRole('button', { name: 'Swap panes', exact: true }).click();
  const after = (await page.getByRole('region', { name: 'conversation pane', exact: true }).boundingBox())!.width;
  expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
  await expect(draft).toHaveValue('Preserve this draft');
  await separator.focus(); await page.keyboard.press('Enter');
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await page.keyboard.press('ArrowRight'); await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.keyboard.press('Enter'); await expect(separator).toHaveAttribute('aria-valuenow', '50');
  if (info.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page), touch = (await separator.boundingBox())!;
    const x = touch.x + touch.width / 2, y = touch.y + touch.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
    await separator.focus(); await page.keyboard.press('Enter');
    await cdp.detach();
  }
  await page.getByRole('button', { name: 'Maximize conversation', exact: true }).click();
  await expect(separator).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore conversation size', exact: true }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await expect(draft).toHaveValue('Preserve this draft');
  await page.screenshot({ path: info.outputPath('resizable-panes.png'), fullPage: true });
});

test('foldable book screens keep panes and controls outside the hinge and return to a phone view', async ({ page, focused }, info) => {
  await page.setViewportSize({ width: 824, height: 900 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 824, height: 900, screenWidth: 824, screenHeight: 900, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Emulation.setDisplayFeaturesOverride', { features: [{ orientation: 'vertical', offset: 400, maskLength: 24 }] });
  await cdp.send('Emulation.setDevicePostureOverride', { posture: { type: 'folded' } });
  await stubConcierge(page, focused.url);
  await page.goto(new URL('/', focused.url).href);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 824, height: 900, screenWidth: 824, screenHeight: 900, deviceScaleFactor: 1, mobile: true, displayFeature: { orientation: 'vertical', offset: 400, maskLength: 24 }, devicePosture: { type: 'folded' } });
  expect(await page.evaluate(() => matchMedia('(horizontal-viewport-segments: 2)').matches)).toBe(true);
  const chat = page.getByRole('region', { name: 'conversation pane', exact: true });
  const details = page.getByRole('region', { name: 'service details pane', exact: true });
  await expect(chat).toBeVisible(); await expect(details).toBeVisible();
  const left = (await chat.boundingBox())!, right = (await details.boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(400); expect(right.x).toBeGreaterThanOrEqual(424);
  await expect(page.getByRole('separator')).toBeHidden();
  const draft = page.getByRole('textbox', { name: 'Message Rashid', exact: true });
  await draft.fill('Foldable draft');
  await expect(draft).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('folded-book.png'), fullPage: false });
  await cdp.send('Emulation.clearDisplayFeaturesOverride');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, screenWidth: 600, screenHeight: 900, deviceScaleFactor: 1, mobile: true, displayFeature: { orientation: 'horizontal', offset: 438, maskLength: 24 }, devicePosture: { type: 'folded' } });
  expect(await page.evaluate(() => matchMedia('(vertical-viewport-segments: 2)').matches)).toBe(true);
  const upper = (await chat.boundingBox())!, lower = (await details.boundingBox())!;
  expect(upper.y + upper.height).toBeLessThanOrEqual(438); expect(lower.y).toBeGreaterThanOrEqual(462);
  await expect(draft).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('folded-clamshell.png'), fullPage: false });
  await cdp.send('Emulation.clearDisplayFeaturesOverride'); await cdp.send('Emulation.clearDevicePostureOverride');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Foldable draft'); await expect(draft).toBeInViewport({ ratio: 1 });
  await cdp.detach();
});
