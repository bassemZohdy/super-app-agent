/** Resident intent: edit a rule and read what automation did, with a finger or a keyboard (QA-10). The AUTO-04 rule editor and the
 *  AUTO-14 inbox are checked for the same things the design checklist asks of every screen: each field named, every control at
 *  least 44px, an error said in words next to the action that caused it, nothing to scroll sideways, and a tab order that reaches
 *  the form. Runs on the phone and desktop projects. */
import { expect, isolatedTest as test } from '../stack.ts';
import { controlsBelowTarget } from './measures.ts';

test('the rule editor and the automation inbox are named, touchable, and say what went wrong', async ({ resident, residentApi }) => {
  const { call } = residentApi;
  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const dewa = (await call('overview')).data.candidates.find((c: { provider: string }) => c.provider === 'dewa');
  await call('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  await panel.getByRole('button', { name: 'Refresh payment accounts', exact: true }).click();

  const sideways = () => resident.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

  // The editor: open it, and every field has a name and a touch target.
  await panel.getByRole('button', { name: 'Start a new rule', exact: true }).click();
  const editor = panel.getByRole('region', { name: 'New automation rule', exact: true });
  await editor.waitFor();
  for (const label of ['Pay this linked biller', 'Pay from', 'Most one payment may take, in AED']) await expect(editor.getByLabel(label)).toBeVisible();
  expect(await controlsBelowTarget(resident), 'every editor control reaches 44px').toEqual([]);
  expect(await sideways(), 'the editor fits the screen').toBe(false);

  // Asking for a review with nothing chosen is refused in words, and nothing is saved.
  await editor.getByRole('button', { name: 'Review rule', exact: true }).click();
  await expect(resident.getByRole('status').filter({ hasText: 'Choose the linked biller to pay.' }), 'the error is said in words').toBeVisible();
  expect(((await call('mandates')).data.mandates as unknown[]).length, 'no rule was created by the empty request').toBe(0);

  // Keyboard: the form is reached in order, from the biller to the amount.
  await editor.getByLabel('Pay this linked biller').focus();
  await resident.keyboard.press('Tab');
  await expect(editor.getByLabel('Pay from')).toBeFocused();
  await resident.keyboard.press('Tab');
  await expect(editor.getByLabel('Most one payment may take, in AED')).toBeFocused();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);

  // The inbox: an empty inbox says so, with a named control and the same target size.
  const loadInbox = panel.getByRole('button', { name: 'Load automation inbox', exact: true });
  await loadInbox.scrollIntoViewIfNeeded();
  await loadInbox.click();
  await expect(resident.getByText('No automation activity yet.', { exact: true }), 'an empty inbox says so').toBeVisible();
  expect(await controlsBelowTarget(resident), 'the inbox controls reach 44px').toEqual([]);
  expect(await sideways(), 'the inbox fits the screen').toBe(false);
});
