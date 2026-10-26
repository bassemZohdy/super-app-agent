/** Layout helpers shared by the browser journeys (QA-06). At phone width the sidebar is an off-canvas drawer that an
 *  "Open navigation" button reveals; at desktop width it is always there. */
import type { Page } from 'playwright/test';

/** Runs `use` with the account switcher visible, opening the navigation drawer first when the layout collapses it and
 *  closing it afterwards, so the page is left as it was found. */
export async function withAccountSwitcher<T>(page: Page, use: (switcher: ReturnType<Page['getByRole']>) => Promise<T>): Promise<T> {
  // The names are matched in English and Arabic, so a journey can run in either language.
  const switcher = page.getByRole('combobox', { name: /^(Current account|الحساب الحالي)$/ });
  const open = page.getByRole('button', { name: /^(Open navigation|فتح القائمة)$/ });
  await switcher.or(open).first().waitFor();
  const collapsed = !await switcher.isVisible();
  if (collapsed) { await open.click(); await switcher.waitFor(); }
  try { return await use(switcher); }
  finally {
    // Some actions (switching account) close the drawer themselves; close it only if it is still open.
    const close = page.getByRole('button', { name: /^(Close navigation menu|إغلاق قائمة التنقل)$/ });
    if (collapsed && await close.isVisible()) await close.click();
  }
}
