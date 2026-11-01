/** Resident intent: use the focused fines workspace in Arabic (P2-01). A saved Arabic choice sets `lang` and `dir`, translates the
 *  sign-in screen and header of the Angular fines route, keeps every control at 44px and leaves nothing to scroll sideways.
 *  Phone and desktop projects. Build the Angular shell first. */
import { expect, test } from '../angular.ts';
import { controlsBelowTarget } from '../accessibility/measures.ts';

test('the Angular fines workspace follows a saved Arabic choice and still fits the screen', async ({ page, angularUrl }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cityside.locale', 'ar'); } catch { /* the browser language still applies */ } });
  await page.goto(`${angularUrl}/services/fines`);

  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['ar', 'rtl']);
  await expect(page.getByRole('heading', { name: 'مخالفاتك. قرارك.' })).toBeVisible();
  await expect(page.getByText('المخالفات وتجديد المركبة', { exact: true })).toBeVisible();
  await expect(page.getByLabel('رمز الوصول', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'فتح مخالفاتي', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'نسيان مرجع المحادثة المحفوظة', exact: true })).toBeVisible();
  expect(await page.getByRole('heading', { name: 'Your fines. Your decision.' }).count(), 'no English headline is left behind').toBe(0);

  expect(await controlsBelowTarget(page), 'every control reaches 44px').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), 'nothing scrolls sideways').toBe(false);
});

test('the Angular fines workspace stays in English without a saved choice', async ({ page, angularUrl }) => {
  await page.goto(`${angularUrl}/services/fines`);
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['en', 'ltr']);
  await expect(page.getByRole('heading', { name: 'Your fines. Your decision.' })).toBeVisible();
});
