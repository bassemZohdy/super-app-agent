import { expect, isolatedTest as test } from '../stack.ts';

test('the reviewed ride and meal total is the amount charged in the integrated wallet', async ({ resident, residentApi, stack }) => {
  const balanceBefore = (await residentApi.call('overview')).data.wallet.balanceMinor as number;
  const ridesBefore = stack.stores.get('rta')!.list(residentApi.accountId, 'ride').length;
  await resident.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Book a ride downtown and order pizza, pay with my wallet');
  await resident.getByRole('button', { name: 'Send message', exact: true }).click();
  const views = resident.getByRole('group', { name: 'Workspace views' });
  if (await views.isVisible()) await views.getByRole('button', { name: /Service details/ }).click();
  const approval = resident.getByRole('button', { name: /Authorize Both & Pay AED/ });
  await expect(approval).toBeVisible();
  const label = await approval.innerText();
  const response = resident.waitForResponse(result => new URL(result.url()).pathname === '/api/a2ui/action' && result.request().method() === 'POST');
  await approval.click();
  const result = await response;
  expect(result.status()).toBe(200);
  const action = result.request().postDataJSON() as { payload: { amountMinor: number; currency: string; driverId: string } };
  expect(action.payload.currency).toBe('AED');
  expect(label).toContain(`AED ${(action.payload.amountMinor / 100).toFixed(2)}`);
  await expect(resident.getByText(`Payment of AED ${(action.payload.amountMinor / 100).toFixed(2)} settled from wallet.`, { exact: false })).toBeVisible();
  expect((await residentApi.call('overview')).data.wallet.balanceMinor).toBe(balanceBefore - action.payload.amountMinor);
  const rides = stack.stores.get('rta')!.list(residentApi.accountId, 'ride') as Array<{ driver: { id: string } }>;
  expect(rides).toHaveLength(ridesBefore + 1);
  expect(rides.at(-1)?.driver.id).toBe(action.payload.driverId);
});
