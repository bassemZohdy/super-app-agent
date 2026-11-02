import { expect, isolatedTest as test } from '../stack.ts';

test('a standalone ride books the reviewed route and fare', async ({ resident, residentApi, stack }) => {
  const before = stack.stores.get('rta')!.list(residentApi.accountId, 'ride').length;
  await resident.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Find a cab ride to Downtown');
  await resident.getByRole('button', { name: 'Send message', exact: true }).click();
  const views = resident.getByRole('group', { name: 'Workspace views' });
  if (await views.isVisible()) await views.getByRole('button', { name: /Service details/ }).click();
  await expect(resident.getByText('Pickup: 100 Market St', { exact: true })).toBeVisible();
  await expect(resident.getByText('Destination: Downtown Restaurant', { exact: true })).toBeVisible();
  const choice = resident.getByRole('radio').filter({ hasText: 'Toyota Camry' });
  await expect(choice).toContainText('AED 22.00');
  await choice.click();
  const response = resident.waitForResponse(result => new URL(result.url()).pathname === '/api/a2ui/action' && result.request().method() === 'POST');
  await resident.getByRole('button', { name: 'Confirm & Dispatch Driver' }).click();
  expect((await response).status()).toBe(200);
  const rides = stack.stores.get('rta')!.list(residentApi.accountId, 'ride') as Array<{ driver: { id: string }; pickup: string; dropoff: string; fare: number }>;
  expect(rides).toHaveLength(before + 1);
  expect(rides.at(-1)).toMatchObject({ driver: { id: 'drv_1' }, pickup: '100 Market St', dropoff: 'Downtown Restaurant', fare: 22 });
});
