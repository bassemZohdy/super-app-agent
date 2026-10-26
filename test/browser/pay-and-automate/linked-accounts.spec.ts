/** Resident intent: link my own bills and see them nowhere else (QA-04). Real Keycloak sign-in; the links are made on the page.
 *  Beside it the journey asserts the stored link records, that linking moves no money, that the same link made twice is one record,
 *  that a reference the resident does not own is refused, and that another signed-in account and the household workspace see none. */
import { expect, isolatedTest as test } from '../stack.ts';
import { login } from '../stack.ts';
import { withAccountSwitcher } from '../layout.ts';

test('linking my bills stores one owned record per link, moves no money, and stays private', async ({ resident, residentApi, stack }) => {
  const { accountId, call } = residentApi, payments = stack.payments.db;
  type Link = { id: string; accountId: string; provider: string; reference: string; nickname: string; status: string; version: number };
  const journal = (account = accountId) => (payments.prepare("SELECT count(*) AS n FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING'").get(account) as { n: number }).n;
  const linkRows = (account: string) => (payments.prepare("SELECT id, body FROM resources WHERE account_id=? AND kind='billing-account' ORDER BY rowid").all(account) as Array<{ id: string; body: string }>).map(row => JSON.parse(row.body) as Link);

  const panel = resident.getByRole('region', { name: 'Payment accounts', exact: true });
  await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  const before = { journal: journal(), wallet: (await call('overview')).data.wallet.balanceMinor as number };
  expect(before.wallet).toBe(150000);
  expect((await call('overview')).data.billingAccounts, 'nothing is linked yet').toHaveLength(0);
  expect(linkRows(accountId)).toHaveLength(0);

  // Link five owned accounts on the page.
  const responseFor = (path: string) => resident.waitForResponse(r => new URL(r.url()).pathname === `/api/payments/${path}` && r.request().method() === 'POST');
  const labels = [/^Link DEWA/, /^Link Salik/, /^Link etisalat · Home internet/, /^Link du · Home internet/, /^Link Traffic fines/];
  const created: Link[] = [];
  for (const name of labels) {
    const response = responseFor('billing-accounts');
    await panel.getByRole('button', { name }).click();
    const reply = await response;
    expect(reply.status()).toBe(200);
    created.push((await reply.json()).billingAccount as Link);
  }
  expect(created.map(link => link.provider).sort()).toEqual(['dewa', 'du', 'etisalat', 'police', 'rta']);

  // The stored records: exactly one per link, owned by this account, active, first version, and the same ones the API reports.
  const rows = linkRows(accountId);
  expect(rows, 'exactly five stored links').toHaveLength(5);
  expect(rows.map(row => row.id).sort()).toEqual(created.map(link => link.id).sort());
  for (const row of rows) expect([row.accountId, row.status, row.version]).toEqual([accountId, 'ACTIVE', 1]);
  expect((await call('overview')).data.billingAccounts.map((link: Link) => link.id).sort()).toEqual(created.map(link => link.id).sort());

  // Linking moves no money and writes nothing to the journal.
  expect((await call('overview')).data.wallet.balanceMinor).toBe(before.wallet);
  expect(journal()).toBe(before.journal);

  // The same link again is not a second record, and a reference this resident does not own is refused.
  const dewa = created.find(link => link.provider === 'dewa')!;
  const again = await call('billing-accounts', { provider: dewa.provider, reference: dewa.reference, nickname: dewa.nickname });
  expect([200, 409], 'a repeat is accepted as the same link or refused').toContain(again.status);
  if (again.status === 200) expect(again.data.billingAccount.id).toBe(dewa.id);
  expect(linkRows(accountId), 'still five records').toHaveLength(5);
  const forged = await call('billing-accounts', { provider: 'dewa', reference: 'ACC-not-mine', nickname: 'Someone else' });
  expect(forged.status, 'a reference the provider does not tie to this resident').toBeGreaterThanOrEqual(400);
  expect(linkRows(accountId)).toHaveLength(5);

  // Privacy: another signed-in account cannot read this one, and sees no links of its own from this one.
  const other = await login('bassem');
  expect((await call('overview', undefined, other)).status, "another account cannot read this resident's overview").toBeGreaterThanOrEqual(400);
  const otherAccounts = await (await fetch(`${stack.coreUrl}/api/accounts`, { headers: { Authorization: `Bearer ${other}` } })).json() as { accounts: Array<{ id: string; label: string }> };
  const otherId = otherAccounts.accounts.find(account => account.label === 'Personal account')!.id;
  expect(otherId).not.toBe(accountId);
  expect(linkRows(otherId), 'the other account has no links from this resident').toHaveLength(0);
  expect((await call('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Taken from someone else' }, other)).status, 'it cannot link this resident\'s reference into this resident\'s account').toBeGreaterThanOrEqual(400);
  expect(linkRows(accountId)).toHaveLength(5);

  // The household workspace of the same resident is a separate account: it has none of these links.
  const household = await withAccountSwitcher(resident, async switcher => { const value = await switcher.locator('option').filter({ hasText: 'Household account' }).getAttribute('value'); expect(value).toBeTruthy(); await switcher.selectOption(value!); return value!; });
  await panel.getByText('AED 1500.00', { exact: true }).waitFor();
  expect(household).not.toBe(accountId);
  expect(linkRows(household), 'the household account has no links').toHaveLength(0);
  expect(journal(household)).toBe(0);

  // A reload keeps this account's links and adds none.
  await resident.reload();
  expect(linkRows(accountId)).toHaveLength(5);
  expect(journal()).toBe(before.journal);
});
