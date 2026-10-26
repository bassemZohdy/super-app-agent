/** Resident intent: use the app with a finger, a keyboard or reduced motion (P2-14). Measured in the real shell on the running
 *  stack: every control is at least 44px, control text is at least the control size, keyboard focus is visible, and reduced
 *  motion stops animation. Runs on the desktop and phone projects (QA-06). */
import type { Page } from 'playwright/test';
import { expect, test } from '../stack.ts';
import { controlsBelowTarget, focusIsVisible, injectMotionCanary, stillMoving, unseenFocusStops } from './measures.ts';

const screens: Array<[string, (page: Page) => Promise<void>]> = [
  ['home', async () => {}],
  ['payment accounts', async page => { await page.getByRole('button', { name: 'Payment accounts', exact: true }).click(); await page.getByRole('button', { name: 'Show kill switch', exact: true }).waitFor(); }],
  ['delegated access', async page => { await page.getByRole('button', { name: 'Delegated access', exact: true }).click(); await page.getByRole('button', { name: 'Refresh grants', exact: true }).waitFor(); }],
];

test.describe('touch, focus and motion', () => {

  for (const [name, open] of screens) {
    test(`${name}: every control is at least 44px and its text at least 14px`, async ({ resident }) => {
      await open(resident);
      expect(await controlsBelowTarget(resident)).toEqual([]);
    });
  }

  test('the keyboard focus is visible on every control reached with Tab, including the message composer', async ({ resident }) => {
    const composer = resident.getByPlaceholder(/Ask Rashid/);
    await composer.focus();
    expect(await focusIsVisible(resident), 'the composer shows focus on its container').toBe(true);
    await resident.mouse.click(1, 1);
    await resident.keyboard.press('Tab');
    const unseen = await unseenFocusStops(resident, 14);
    expect(unseen).toEqual([]);
  });

  test('reduced motion stops every transition and animation', async ({ resident }) => {
    await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
    await injectMotionCanary(resident);
    await resident.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await stillMoving(resident)).length, 'the canary proves motion exists without the preference').toBeGreaterThan(0);
    await resident.emulateMedia({ reducedMotion: 'reduce' });
    expect(await stillMoving(resident)).toEqual([]);
    expect(await resident.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  });
});
