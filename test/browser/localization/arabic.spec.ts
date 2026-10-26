/** Resident intent: use the concierge in Arabic (P2-01). Choosing Arabic in the conversation settings sets `lang` and `dir` on the page,
 *  translates the shell, mirrors the layout (the sidebar and the phone drawer move to the right), keeps every control at 44px with
 *  nothing to scroll sideways, and is remembered; a browser that asks for Arabic first starts in Arabic. Phone and desktop projects. */
import { expect, test } from '../stack.ts';
import { controlsBelowTarget } from '../accessibility/measures.ts';

const html = (page: import('playwright/test').Page) => page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
const sideways = (page: import('playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('choosing Arabic translates and mirrors the shell, fits the screen and is remembered', async ({ resident }) => {
  expect(await html(resident)).toEqual(['en', 'ltr']);
  await resident.getByRole('button', { name: 'Conversation settings', exact: true }).click();
  await resident.getByRole('region', { name: 'Conversation settings', exact: true }).getByLabel('Language', { exact: true }).selectOption('ar');

  expect(await html(resident)).toEqual(['ar', 'rtl']);
  await expect(resident.getByPlaceholder('اسأل راشد أي شيء عن مدينتك…')).toBeVisible();
  const settings = resident.getByRole('region', { name: 'إعدادات المحادثة', exact: true });
  await expect(settings.getByLabel('اللغة', { exact: true })).toHaveValue('ar');
  await expect(settings.getByRole('checkbox', { name: 'مشاركة بيانات ملفي الشخصي مع المساعد' })).toBeVisible();
  expect(await controlsBelowTarget(resident), 'every control still reaches 44px').toEqual([]);
  expect(await sideways(resident), 'nothing scrolls sideways').toBe(false);

  // Mirrored: the sidebar is at the right edge on a desktop; on a phone the drawer opens from the right.
  const width = await resident.evaluate(() => document.documentElement.clientWidth);
  const phone = width <= 600;
  if (phone) {
    await resident.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
    await expect(resident.getByRole('button', { name: 'محادثة جديدة' })).toBeVisible();
  }
  // The drawer slides in; wait for it to settle before measuring.
  await expect.poll(async () => { const box = await resident.locator('aside.sidebar').boundingBox(); return box ? Math.round(box.x + box.width) : -1; }, { message: 'the sidebar sits against the right edge' }).toBe(width);
  for (const name of ['محادثة جديدة', 'المحادثات', 'التنقل', 'المرافق', 'المدفوعات', 'الاتصالات', 'السكن', 'ملفي الشخصي']) await expect(resident.locator('aside.sidebar').getByRole('button', { name: new RegExp(name) }).first()).toBeAttached();
  if (phone) await resident.getByRole('button', { name: 'إغلاق قائمة التنقل', exact: true }).click();

  // Remembered across a reload, and reversible.
  await resident.reload();
  expect(await html(resident)).toEqual(['ar', 'rtl']);
  await resident.getByRole('button', { name: 'إعدادات المحادثة', exact: true }).click();
  await resident.getByRole('region', { name: 'إعدادات المحادثة', exact: true }).getByLabel('اللغة', { exact: true }).selectOption('en');
  expect(await html(resident)).toEqual(['en', 'ltr']);
  await expect(resident.getByPlaceholder('Ask Rashid anything about your city…')).toBeVisible();
});

test.describe('a browser that asks for Arabic first', () => {
  test.use({ locale: 'ar-AE' });
  test('starts in Arabic without being asked', async ({ resident }) => {
    expect(await html(resident)).toEqual(['ar', 'rtl']);
    await expect(resident.getByPlaceholder('اسأل راشد أي شيء عن مدينتك…')).toBeVisible();
  });
});

test('the Connections view is in Arabic when the language is Arabic, and its times and counts follow', async ({ resident }) => {
  await resident.getByRole('button', { name: 'Conversation settings', exact: true }).click();
  await resident.getByRole('region', { name: 'Conversation settings', exact: true }).getByLabel('Language', { exact: true }).selectOption('ar');
  await resident.getByRole('button', { name: 'إغلاق الإعدادات', exact: true }).click();
  await resident.getByRole('button', { name: 'روابط الخدمات', exact: true }).click();
  const view = resident.getByRole('region', { name: 'روابط الخدمات', exact: true });
  await expect(view.getByRole('status').filter({ hasText: 'جميع الروابط (7) متاحة.' })).toBeVisible();
  await expect(view.getByRole('button', { name: 'فحص الروابط', exact: true })).toBeVisible();
  await expect(view.getByRole('article', { name: 'رابط Payments' })).toContainText('متاح');
  await view.getByRole('article', { name: 'رابط Payments' }).getByText('عرض عمليات Payments').click();
  await expect(view.getByRole('columnheader', { name: 'العملية' })).toBeVisible();
  await expect(view.getByText('لم تُجرَ أي استدعاءات لك بعد.').or(view.getByRole('list', { name: 'استدعاءات الجهات الأخيرة' }))).toBeVisible();
  expect(await controlsBelowTarget(resident)).toEqual([]);
  expect(await sideways(resident)).toBe(false);
});

test('amounts on the payment screen follow the language: AED in English, د.إ in Arabic, and the layout still fits', async ({ resident }) => {
  await resident.getByRole('button', { name: 'Conversation settings', exact: true }).click();
  await resident.getByRole('region', { name: 'Conversation settings', exact: true }).getByLabel('Language', { exact: true }).selectOption('ar');
  await resident.getByRole('button', { name: 'إغلاق الإعدادات', exact: true }).click();
  await resident.getByRole('button', { name: 'حسابات الدفع', exact: true }).click();
  const accounts = resident.getByRole('region', { name: 'حسابات الدفع', exact: true });
  await expect(accounts.getByRole('heading', { name: 'الحسابات والتمويل' })).toBeVisible();
  await expect(accounts.getByRole('button', { name: 'تحديث حسابات الدفع', exact: true })).toBeVisible();
  await expect(accounts.getByText(/المتاح .*د.إ · المحجوز/)).toBeVisible();
  await expect(accounts.getByRole('region', { name: 'طرق التمويل المحفوظة' }).getByRole('button', { name: 'إضافة بطاقة تجريبية', exact: true })).toBeVisible();
  await expect(accounts.getByRole('region', { name: 'حسابات الفواتير المرتبطة' }).getByRole('heading', { name: 'حسابات فواتيرك' })).toBeVisible();
  await expect(resident.getByText('1500٫00 د.إ').first()).toBeVisible();
  await expect(resident.getByText('AED 1500.00')).toHaveCount(0);
  expect(await sideways(resident)).toBe(false);
});

test('the delegated access panel is in Arabic, with the same controls and no sideways scroll', async ({ resident }) => {
  await resident.getByRole('button', { name: 'Conversation settings', exact: true }).click();
  await resident.getByRole('region', { name: 'Conversation settings', exact: true }).getByLabel('Language', { exact: true }).selectOption('ar');
  await resident.getByRole('button', { name: 'إغلاق الإعدادات', exact: true }).click();
  await resident.getByRole('button', { name: 'الوصول المفوّض', exact: true }).click();
  const panel = resident.getByRole('region', { name: 'الوصول المفوّض', exact: true });
  for (const name of ['السماح بما يصل إلى 3 عمليات للاطلاع على رصيد المحفظة', 'الموافقة على إضافة درهم واحد تجريبي إلى المحفظة', 'تحديث التفويضات']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(panel.getByText('لا توجد تفويضات لهذا الحساب.')).toBeVisible();
  expect(await controlsBelowTarget(resident)).toEqual([]);
  expect(await sideways(resident)).toBe(false);
});
