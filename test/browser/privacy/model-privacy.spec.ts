/** Resident intent: decide whether the assistant's model sees my profile details (P1-17). The switch is on the conversation settings,
 *  says what it did, is saved with the conversation (a reload shows the same choice) and can be turned back on. Phone and desktop. */
import { expect, test } from '../stack.ts';

test('the resident withholds profile details from the assistant, and the choice survives a reload', async ({ resident }) => {
  const changed = (value: boolean) => resident.waitForResponse(r => new URL(r.url()).pathname === '/api/a2ui/model-privacy' && r.request().method() === 'POST' && r.request().postDataJSON().modelPersonalContext === value);
  const open = async () => { await resident.getByRole('button', { name: 'Conversation settings', exact: true }).click(); return resident.getByRole('region', { name: 'Conversation settings', exact: true }); };
  const settings = await open();
  const share = settings.getByRole('checkbox', { name: 'Share my profile details with the assistant' });
  await expect(share, 'shared until the resident says otherwise').toBeChecked();

  const off = changed(false);
  await share.uncheck();
  expect((await off).status()).toBe(200);
  await expect(settings.getByRole('status').filter({ hasText: 'withheld from the assistant' })).toBeVisible();
  await expect(share).not.toBeChecked();

  // Saved with the conversation: after a reload the setting shows the same choice.
  await resident.reload();
  const reopened = await open();
  await expect(reopened.getByRole('checkbox', { name: 'Share my profile details with the assistant' })).not.toBeChecked();

  const on = changed(true);
  await reopened.getByRole('checkbox', { name: 'Share my profile details with the assistant' }).check();
  expect((await on).status()).toBe(200);
  await expect(reopened.getByRole('status').filter({ hasText: 'may use your profile details' })).toBeVisible();
});
