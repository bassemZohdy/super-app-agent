/** Layout helpers shared by the browser journeys (QA-06). At phone width the sidebar is an off-canvas drawer that an
 *  "Open navigation" button reveals; at desktop width it is always there. */
import type { Page } from 'playwright/test';

/** Runs `use` with the account switcher visible, opening the navigation drawer first when the layout collapses it and
 *  closing it afterwards, so the page is left as it was found. */
export async function withAccountSwitcher<T>(page: Page, use: (switcher: ReturnType<Page['getByRole']>) => Promise<T>): Promise<T> {
  const switcher = page.getByRole('combobox', { name: 'Current account', exact: true });
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await switcher.or(open).first().waitFor();
  const collapsed = !await switcher.isVisible();
  if (collapsed) { await open.click(); await switcher.waitFor(); }
  try { return await use(switcher); }
  finally { if (collapsed) await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click(); }
}
