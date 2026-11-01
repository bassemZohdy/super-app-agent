/** Resident intent: if I act on a screen the assistant has since replaced, I am told why nothing happened and shown the current screen,
 *  and my tap does not send a second action (P1-12). The gateway's real STALE_SURFACE answer is replayed to the Angular and React
 *  shells on the phone and desktop projects; the Flutter shell has the same rule in its widget tests. */
import type { Page } from 'playwright/test';
import { expect as angularExpect, test as angularTest } from '../angular.ts';
import { expect, test } from '../stack.ts';

const REASON = 'This surface has been replaced. Review the current surface before acting.';
const surface = (sessionId: string, revision: string, title: string, withButton: boolean) => ({
  version: '1.0.0', sessionId, revision, timestamp: Date.now(),
  view: { type: 'SurfaceCard', id: 'card', children: [
    { type: 'Heading', id: 'title', properties: { text: title, level: 2 } },
    ...(withButton ? [{ type: 'Button', id: 'go', properties: { label: 'Continue' }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'continue' } }] }] : []),
  ] },
});

async function showDetails(page: Page) {
  const views = page.getByRole('group', { name: 'Workspace views', exact: true });
  if (await views.isVisible()) await views.getByRole('button', { name: /^Service details/ }).click(); // React adds a badge to the name when new content arrives
}

angularTest('Angular tells me the screen was replaced, shows the current one and sends one action only', async ({ angular, angularUrl }) => {
  let actions = 0;
  const headers = { 'access-control-allow-origin': angularUrl };
  await angular.route('http://localhost:4000/api/a2ui/intent', route => route.fulfill({ status: 200, contentType: 'application/json', headers,
    body: JSON.stringify({ success: true, surface: surface((route.request().postDataJSON() as { sessionId: string }).sessionId, '00000000-0000-4000-8000-000000000001', 'Review before you continue', true) }) }));
  await angular.route('http://localhost:4000/api/a2ui/action', route => {
    actions++;
    return route.fulfill({ status: 409, contentType: 'application/json', headers, body: JSON.stringify({ success: false, code: 'STALE_SURFACE', error: REASON,
      retry: { allowed: false, next: 'refresh_surface' }, surface: surface((route.request().postDataJSON() as { sessionId: string }).sessionId, '00000000-0000-4000-8000-000000000002', 'The current surface', false) }) });
  });
  await angular.getByRole('textbox', { name: 'Chat message', exact: true }).fill('Show something');
  await angular.getByRole('button', { name: 'Send', exact: true }).click();
  await showDetails(angular);
  await angularExpect(angular.getByText('Review before you continue', { exact: true })).toBeVisible();
  await angular.getByRole('button', { name: 'Continue', exact: true }).click();
  await angularExpect(angular.getByText(REASON, { exact: true }).first()).toBeAttached();
  await showDetails(angular);
  await angularExpect(angular.getByText('The current surface', { exact: true })).toBeVisible();
  await angularExpect(angular.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await angular.waitForTimeout(500);
  angularExpect(actions, 'one tap sent one action and nothing followed').toBe(1);
});

test('React tells me the screen was replaced, shows the current one and sends one action only', async ({ resident }) => {
  let actions = 0;
  await resident.route(/\/api\/a2ui\/intent/, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ success: true, surface: surface((route.request().postDataJSON() as { sessionId: string }).sessionId, '00000000-0000-4000-8000-000000000001', 'Review before you continue', true) }) }));
  await resident.route(/\/api\/a2ui\/action/, route => {
    actions++;
    return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ success: false, code: 'STALE_SURFACE', error: REASON,
      retry: { allowed: false, next: 'refresh_surface' }, surface: surface((route.request().postDataJSON() as { sessionId: string }).sessionId, '00000000-0000-4000-8000-000000000002', 'The current surface', false) }) });
  });
  await resident.getByPlaceholder('Ask Rashid anything about your city…').fill('Show something');
  await resident.getByRole('button', { name: 'Send message', exact: true }).click();
  await showDetails(resident);
  await expect(resident.getByText('Review before you continue', { exact: true })).toBeVisible();
  await resident.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(resident.getByText(REASON, { exact: true }).first()).toBeAttached();
  await showDetails(resident);
  await expect(resident.getByText('The current surface', { exact: true })).toBeVisible();
  await expect(resident.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await resident.waitForTimeout(500);
  expect(actions, 'one tap sent one action and nothing followed').toBe(1);
});
