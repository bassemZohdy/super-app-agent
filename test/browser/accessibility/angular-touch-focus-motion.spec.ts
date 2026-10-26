/** Resident intent: use the Angular shell with a finger, a keyboard or reduced motion (P2-14). The built shell is measured in a
 *  real browser against a stubbed local gateway, so the layout is checked without depending on Keycloak or the live gateway.
 *  Runs on the desktop and phone projects (QA-06). */
import { expect, test } from '../angular.ts';
import { controlsBelowTarget, injectMotionCanary, stillMoving, unseenFocusStops } from './measures.ts';

test.describe('Angular shell: touch, focus and motion', () => {
  test('every control is at least 44px and its text at least 14px, with the delegation and voice panels open', async ({ angular }) => {
    await angular.getByText('Delegated access', { exact: true }).click();
    await angular.getByText('Voice & conversation settings', { exact: true }).click();
    await angular.getByRole('button', { name: 'Allow up to 3 wallet balance checks' }).waitFor();
    expect(await controlsBelowTarget(angular)).toEqual([]);
  });

  test('the keyboard focus is visible in the chat row and on each Tab stop', async ({ angular }) => {
    await angular.getByRole('textbox', { name: 'Chat message' }).focus();
    expect(await unseenFocusStops(angular, 1), 'the chat input shows focus on its row').toEqual([]);
    await angular.mouse.click(1, 1);
    await angular.keyboard.press('Tab');
    expect(await unseenFocusStops(angular, 14)).toEqual([]);
  });

  test('reduced motion stops every transition and animation', async ({ angular }) => {
    await injectMotionCanary(angular);
    await angular.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await stillMoving(angular)).length, 'the canary proves motion exists without the preference').toBeGreaterThan(0);
    await angular.emulateMedia({ reducedMotion: 'reduce' });
    expect(await stillMoving(angular)).toEqual([]);
  });
});
