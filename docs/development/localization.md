# Localization (English and Arabic)

`packages/protocol-core/src/i18n.ts` holds the shell's text catalogs, direction and formatting. A catalog is a flat map from keys to text; the English and Arabic catalogs must have the same keys, non-empty text and the same `{placeholders}`, which `services/test/p201-i18n.test.ts` enforces. `translate(locale, key, values)` falls back to English rather than to an empty label.

## What the React shell does

The resident's language is their saved choice (`localStorage`, key `cityside.locale`), else Arabic when the browser's first language is Arabic, else English. **Conversation settings → Language** switches it. The choice sets `lang` and `dir` on the page, so screen readers, form controls and the layout follow it. Translated today: the sidebar and its drawer, the workspace tool buttons, the composer, the conversation settings and the message author and retry labels. The Delegated access panel, the Connections panel and the header, introduction, refresh control, wallet summary, demo cards, linked biller accounts, the bills and fines list, the payment review form, the quote preview, the authorization reviews and their receipts, the wallet top-up, the refunds and the grouped checkout, each with its receipts and notices, of Payment accounts are translated (the receipt wording is checked by the catalog test and the English journeys; no Arabic journey reaches a paid order yet) (the grant's purpose and the run result come from the gateway in English), the latter with its times formatted for the language; its notice is stored as what happened and worded when shown, so it follows a language change. (The Arabic for Telecom and for Connections must differ, because the journeys and the buttons are found by name: Connections is "روابط الخدمات".)

The stylesheet uses logical properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`), so the layout mirrors by itself; the one place that names a side is the phone drawer, which has an explicit right-to-left rule. In English the pixels are unchanged (the same screens before and after the conversion compare identical).

## What the Angular shell does

The shell's chrome is translated with the same catalogs (`ng.*` keys): the sign-in screen, header, language selector, concierge title, suggestion chips, composer, workspace titles and empty state, then the delegated access panel and the voice settings with their notices and status text. It reads and writes the same saved choice (`cityside.locale`) as the React shell and sets `lang` and `dir` on the page. Its stylesheet uses logical properties, so English pixels are unchanged. The suggestion chips still send their English requests to the gateway; only the labels change. The grant purposes and results from the gateway, the welcome message, connection status, surface content and errors stay English for now, and no browser spec has run it in Arabic yet.

## Money, dates and times

`formatMoney(locale, minor, currency)` takes whole minor units (a non-integer is refused, so a float never carries an amount) and prints `AED 1,500.00` in English and `1,500٫00 د.إ` in Arabic with Latin digits, so an amount reads the same on screen, in a receipt and in a statement. `formatAED`, which every amount in the shells already calls, follows the chosen language through `setAmountLocale` (set by the React shell's `useLocale`): English keeps `AED 1500.00`, Arabic shows `1500٫00 د.إ`, and neither groups thousands, so no screen changes its width unexpectedly. `formatDateTime` and `formatTime` use the Dubai time zone and the locale's tag.

## Not yet translated

The grant purposes and results the gateway sends for delegation, and the provider problem messages, the assistant's replies and the surfaces it builds, the rest of the Angular shell and the Flutter shell. A journey that must run in either language matches names with both spellings (`test/browser/layout.ts`).

## Checked

`test/browser/localization/arabic.spec.ts` on the phone and desktop projects: choosing Arabic sets `ar` and `rtl`, translates the shell, keeps every control at 44px with nothing scrolling sideways, puts the sidebar (and the phone drawer) at the right edge, survives a reload and can be reversed; a browser that asks for Arabic first starts in Arabic.
