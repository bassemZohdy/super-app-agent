# Isolated React payment browser qualification — 2 November 2026

The React payment-account journeys passed against source revision `7004049` on Windows with Node 24.16.0, Playwright 1.64.1, Chrome 147.0.7727.15, Docker 29.9.2 and Compose 5.6.1. Desktop used a 1440 × 1000 viewport; mobile used a 390 × 844 touch viewport. The run used the separate `cityside-qualify` Keycloak and Redis and fresh temporary application/provider databases for each case.

## Executed

```powershell
npm run qualify -- up
$env:E2E_SUITE = 'qualification-payments-20261102'
npm run qualify -- run -- npx playwright test -c test/browser/playwright.config.ts test/browser/pay-and-automate
npm run qualify -- down
```

All ten cases passed: bill payment and refund, fine payment, billing-account linking, wallet and card recharge, and card-funded wallet reload, each at desktop and mobile sizes. The tests inspect synthetic provider records and payment journals, check selected replay and ownership refusals, and verify displayed outcomes. The named qualification project was absent before startup and its containers and volumes were removed afterward. The browser report is a local ignored artifact, not a checked-in recording.

## Limits

The browser served a temporary React build against in-process application and provider simulators, using the qualification Keycloak and Redis. This is not a full Compose application deployment, a real payment provider, native-device testing, or complete shell conformance. It does not establish distributed crash recovery or production security. Other browser journeys and the Flutter build were not part of this run.
