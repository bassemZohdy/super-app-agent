import { expect, isolatedTest as test } from '../stack.ts';

test('a standalone food review shows the total including delivery and orders that dish', async ({ resident }) => {
  await resident.getByRole('textbox', { name: 'Message Rashid', exact: true }).fill('Find a restaurant for dinner');
  await resident.getByRole('button', { name: 'Send message', exact: true }).click();
  const views = resident.getByRole('group', { name: 'Workspace views' });
  if (await views.isVisible()) await views.getByRole('button', { name: /Service details/ }).click();
  const choice = resident.getByRole('radio').filter({ hasText: 'Woodfired Pizza Diavola' });
  await expect(choice).toBeVisible();
  await expect(resident.getByText('Delivery address: 100 Market St, Apt 4B', { exact: true })).toBeVisible();
  await expect(choice).toContainText('Delivery AED 2.99');
  await expect(choice).toContainText('AED 20.99');
  await choice.click();
  const response = resident.waitForResponse(result => new URL(result.url()).pathname === '/api/a2ui/action' && result.request().method() === 'POST');
  await resident.getByRole('button', { name: 'Order Dish & Dispatch to Kitchen' }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(resident.getByText(/Total: AED 20\.99/)).toBeVisible();
});
