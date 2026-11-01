/** Resident intent: when the gateway answers with something the app cannot draw, I am told the answer could not be shown, nothing is
 *  drawn, and I can carry on (P1-12). The Angular and React shells each get a surface with a revision that is not a revision; neither
 *  may say the gateway was unreachable, and the composer must stay usable. The Flutter shell has the same rule in its widget tests. */
import { expect as angularExpect, test as angularTest } from '../angular.ts';
import { expect, test } from '../stack.ts';

const unreadable = (sessionId: string) => ({ success: true, surface: { version: '1.0.0', sessionId, revision: 'not-a-revision', view: { type: 'SurfaceCard', id: 'card', children: [] } } });

angularTest('Angular says the gateway answer could not be read, and the composer stays usable', async ({ angular, angularUrl }) => {
  await angular.route('http://localhost:4000/api/a2ui/intent', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': angularUrl },
    body: JSON.stringify(unreadable((route.request().postDataJSON() as { sessionId: string }).sessionId)),
  }));
  const composer = angular.getByRole('textbox', { name: 'Chat message', exact: true });
  await composer.fill('Show something');
  await angular.getByRole('button', { name: 'Send', exact: true }).click();
  await angularExpect(angular.getByText('Could not read the gateway response. Check status before retrying.', { exact: true })).toBeVisible();
  await angularExpect(angular.getByText(/could not reach|offline|unreachable/i)).toHaveCount(0);
  await angularExpect(composer).toBeEnabled();
});

test('React says the gateway returned an invalid surface, offers to try again and keeps the composer usable', async ({ resident }) => {
  await resident.route(/\/api\/a2ui\/intent/, route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(unreadable((route.request().postDataJSON() as { sessionId: string }).sessionId)),
  }));
  const composer = resident.getByPlaceholder('Ask Rashid anything about your city…');
  await composer.fill('Show something');
  await resident.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(resident.getByText('The gateway returned an invalid surface. Refresh your request.', { exact: true })).toBeVisible();
  await expect(resident.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(resident.getByText(/could not reach|offline|unreachable/i)).toHaveCount(0);
  await expect(composer).toBeEnabled();
});
