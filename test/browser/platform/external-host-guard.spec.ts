/** Runner guard (QA-09): a journey that reaches a host outside this machine must fail. The first test is expected to fail, and
 *  its only possible failure is the shared fixture's check after the test, so it proves the block is active: if the guard ever
 *  stopped working, this test would pass and Playwright would report an unexpected pass. */
import { expect, test } from '../fixtures.ts';

test('a request to an external host is blocked and fails the journey', async ({ page }) => {
  test.fail(true, 'the guard must fail a journey that reaches an external host');
  await page.goto('about:blank');
  await page.evaluate(() => fetch('http://external-host.invalid/probe').then(() => 'reached', () => 'blocked'));
});

test('a local page that stays on this machine passes the guard', async ({ page, blockedExternalRequests }) => {
  await page.goto('about:blank');
  await page.setContent('<main>local only</main>');
  await expect(page.getByText('local only')).toBeVisible();
  expect(blockedExternalRequests).toEqual([]);
});
