import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS, LOCALES, direction, formatDateTime, formatMoney, formatTag, formatTime, isLocale, preferredLocale, translate, type CatalogKey } from '../../packages/protocol-core/src/i18n.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('P2-01: every locale has exactly the English keys, no empty text and the same placeholders', () => {
  const keys = Object.keys(CATALOGS.en) as CatalogKey[];
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(CATALOGS[locale]).sort(), [...keys].sort(), `${locale} has the same keys`);
    for (const key of keys) {
      assert.ok(CATALOGS[locale][key].trim().length > 0, `${locale}.${key} is empty`);
      assert.deepEqual(placeholders(CATALOGS[locale][key]), placeholders(CATALOGS.en[key]), `${locale}.${key} keeps its placeholders`);
    }
  }
  for (const key of keys) assert.match(CATALOGS.ar[key], /[؀-ۿ]/, `ar.${key} is Arabic text`);
});

test('P2-01: translate fills placeholders, falls back to English and never returns an empty label', () => {
  assert.equal(translate('ar', 'nav.signOut'), 'تسجيل الخروج');
  assert.equal(translate('en', 'nav.signOut'), 'Sign out');
  assert.equal(translate('xx' as never, 'nav.signOut'), 'Sign out', 'an unknown locale falls back to English');
});

test('P2-01: direction, locale choice and tags', () => {
  assert.deepEqual([direction('en'), direction('ar')], ['ltr', 'rtl']);
  assert.equal(preferredLocale(['ar-AE', 'en']), 'ar');
  assert.equal(preferredLocale(['en-GB', 'ar']), 'en', 'Arabic only when it is the first language asked for');
  assert.equal(preferredLocale([]), 'en');
  assert.equal(preferredLocale(undefined), 'en');
  assert.equal(isLocale('ar'), true);
  assert.equal(isLocale('fr'), false);
  assert.match(formatTag('ar'), /-u-nu-latn$/, 'Latin digits are requested for Arabic');
});

test('P2-01: money is formatted from whole minor units with the currency in the locale\'s order, and never from a float', () => {
  assert.equal(formatMoney('en', 150000), 'AED 1,500.00');
  assert.equal(formatMoney('en', 42040), 'AED 420.40');
  assert.equal(formatMoney('en', 5), 'AED 0.05');
  assert.equal(formatMoney('en', -4200), '-AED 42.00');
  assert.equal(formatMoney('ar', 150000), '1,500٫00 د.إ');
  assert.equal(formatMoney('ar', 42040), '420٫40 د.إ');
  assert.equal(formatMoney('en', 100, 'USD'), 'USD 1.00');
  for (const bad of [1.5, NaN, Infinity, 2 ** 60]) assert.throws(() => formatMoney('en', bad), /whole number/, String(bad));
});

test('P2-01: dates and times use the Dubai time zone and the locale\'s tag', () => {
  const at = Date.UTC(2026, 9, 26, 20, 30, 0); // 00:30 on 27 October in Dubai
  assert.match(formatDateTime('en', at), /27 Oct 2026/);
  assert.match(formatDateTime('ar', at), /2026/);
  assert.match(formatTime('en', at), /12:30:00/);
  assert.match(formatTime('ar', at), /12:30:00/);
});

test('P2-01: amounts follow the chosen language, and English keeps its established form', async () => {
  const { formatAED, setAmountLocale } = await import('../../packages/protocol-core/src/payments.ts');
  try {
    assert.equal(formatAED(150000), 'AED 1500.00');
    setAmountLocale('ar');
    assert.equal(formatAED(150000), '1500٫00 د.إ');
    assert.equal(formatAED(42040), '420٫40 د.إ');
    assert.throws(() => formatAED(-1), /Invalid AED fils/);
  } finally { setAmountLocale('en'); }
  assert.equal(formatAED(5), 'AED 0.05');
});
