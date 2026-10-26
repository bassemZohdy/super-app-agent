/** Resident intent: see which services my concierge talks to and what happened on the calls made for me (P2-11, QA-10). The Connections
 *  view lists every provider with the operations it advertises, shows my own calls with failures in words, and re-reads the providers
 *  when asked. Checked on the phone and desktop projects: named controls, 44px targets, nothing that scrolls sideways. */
import { expect, test } from '../stack.ts';
import { controlsBelowTarget } from '../accessibility/measures.ts';

test('the Connections view shows discovered operations, my calls and a failed call, and fits the screen', async ({ resident, residentApi }) => {
  const { call } = residentApi;
  const sideways = () => resident.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await resident.getByRole('button', { name: 'Connections', exact: true }).click();
  const view = resident.getByRole('region', { name: 'Connections', exact: true });
  await expect(view.getByRole('status').filter({ hasText: 'All 7 connections are reachable.' })).toBeVisible();

  // Every provider is listed with its advertised operations.
  for (const name of ['RTA', 'DEWA', 'etisalat', 'du', 'Dubai Police', 'DLD', 'Payments']) await expect(view.getByRole('article', { name: `${name} connection` })).toContainText('Reachable');
  const payments = view.getByRole('article', { name: 'Payments connection' });
  await payments.getByText('Show operations for Payments').click();
  const table = payments.getByRole('region', { name: 'Payments operations' });
  await expect(table.getByRole('cell', { name: 'listAccounts', exact: true })).toBeVisible();
  expect(await controlsBelowTarget(resident), 'every control reaches 44px').toEqual([]);
  expect(await sideways(), 'the long table scrolls inside its own region').toBe(false);

  // A call made for me appears, with no account id in it; a refused call is marked as failed, in words.
  expect((await call('overview')).status).toBe(200);
  expect((await call('orders/approve', { orderId: 'order_00000000-0000-4000-8000-000000000000', expectedVersion: 1, approvalDigest: '0'.repeat(64) })).status).toBeGreaterThanOrEqual(400);
  await view.getByRole('button', { name: 'Check connections', exact: true }).click();
  const calls = view.getByRole('list', { name: 'Recent provider calls' });
  await expect(calls.getByRole('listitem').filter({ hasText: /OK 200/ }).first()).toBeVisible();
  await expect(calls.getByRole('listitem').filter({ hasText: /Failed 4\d\d/ }).first()).toBeVisible();
  const text = await calls.innerText();
  expect(text, 'the record shows what was called, not whose').not.toMatch(/acc_[0-9a-f]{8}/);
  expect(text).toContain('/v1/accounts/{account}/');
  expect(await sideways()).toBe(false);
});

test('a provider that advertises a document pointing elsewhere is shown as refused, and the others stay usable', async ({ resident, stack }) => {
  void stack;
  await resident.route(/\/api\/connections/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.providers[0] = { provider: 'rta', ok: false, checkedAt: Date.now(), operations: [], problem: 'A server points away from the provider.' };
    await route.fulfill({ response, json: body });
  });
  await resident.getByRole('button', { name: 'Connections', exact: true }).click();
  const view = resident.getByRole('region', { name: 'Connections', exact: true });
  await expect(view.getByRole('status').filter({ hasText: '1 of 7 connections have a problem.' })).toBeVisible();
  await expect(view.getByRole('article', { name: 'RTA connection' })).toContainText('Refused · A server points away from the provider.');
  await expect(view.getByRole('article', { name: 'Payments connection' })).toContainText('Reachable');
  expect(await view.getByRole('article', { name: 'RTA connection' }).getByText(/Show operations/).count(), 'a refused provider lists no operations').toBe(0);
});
