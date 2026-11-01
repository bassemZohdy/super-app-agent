# Shell journey parity

Cityside keeps three web shells (React, Angular, Flutter web) and a native Flutter build. This guide is the agreed matrix of resident journeys: which test proves each one in each shell on a phone and on a desktop, which journeys only the React shell offers, and which are deliberately not proven. A cell that says "none yet" is a known gap, listed below; a missing test is a decision written down here and not an oversight. `services/test/qa06-parity-matrix.test.ts` fails if a file named below does not exist.

Browser specs run with `npm run test:browser` against the Compose stack (`npm run demo:up`) in a `desktop` and a `mobile` project; Flutter widget tests run with `flutter test` in `apps/shell-flutter` at phone and desktop sizes and at enlarged text. See [testing](testing.md) for how to run each.

## The matrix

| Journey | React | Angular | Flutter web | What the tests check |
| --- | --- | --- | --- | --- |
| Sign in with Keycloak (authorization code with PKCE) | `test/browser/stack.ts` | none yet | `test/browser/parity/flutter.spec.ts` | the code exchange, no password grant, the signed-in name shown (every React journey signs in through Keycloak) |
| Focused fines: review, exact approval, restart recovery | `test/browser/focused-agent/fines.spec.ts` | `test/browser/parity/angular.spec.ts` | `test/browser/parity/flutter.spec.ts` | one payment, stale and duplicate approvals refused, a lost result blocks new commands |
| Vehicle renewal beside fines | `test/browser/parity/renewal.spec.ts` | `test/browser/parity/renewal.spec.ts` | `test/browser/parity/renewal.spec.ts` | separate exact approvals for fines and renewal |
| Pane layout: swap, maximize, divider, hinge | `test/browser/focused-agent/fines.spec.ts` | `test/browser/parity/angular.spec.ts` | `apps/shell-flutter/test/workspace_panes_test.dart` | phone view switching keeps the draft, panes clear a book or clamshell hinge |
| Touch targets, focus and reduced motion | `test/browser/accessibility/touch-focus-motion.spec.ts` | `test/browser/accessibility/angular-touch-focus-motion.spec.ts` | `apps/shell-flutter/test/main_focus_accessibility_test.dart`, `apps/shell-flutter/test/main_header_accessibility_test.dart`, `apps/shell-flutter/test/main_composer_accessibility_test.dart`, `apps/shell-flutter/test/main_dialogs_accessibility_test.dart`, `apps/shell-flutter/test/surface_controls_accessibility_test.dart` | 44px controls, visible focus, named controls, no motion when reduced, at large text |
| Delegated access panel is reachable and named | `test/browser/accessibility/touch-focus-motion.spec.ts` | `test/browser/accessibility/angular-touch-focus-motion.spec.ts` | `apps/shell-flutter/test/delegation_accessibility_test.dart` | every control at least 44px with the panel open |
| Account switch clears the old conversation | `test/browser/accessibility/payment-states.spec.ts` | none yet | `apps/shell-flutter/test/account_switch_test.dart` | nothing from the other account stays on screen |
| Connections: operations, calls, refusals | `test/browser/connections/connections.spec.ts` | none yet | `apps/shell-flutter/test/connections_accessibility_test.dart` | discovered operations, my calls, a failed call, fits the screen |
| Arabic and right-to-left | `test/browser/localization/arabic.spec.ts` | `test/browser/localization/fines-arabic.spec.ts` (fines route only) | `apps/shell-flutter/test/connections_accessibility_test.dart` (connections only) | `lang` and `dir`, translated labels, 44px controls, no sideways scroll |

## Journeys only the React shell offers

The Angular and Flutter shells do not implement a Payment accounts workspace. These are not gaps to close by copying the screens; a shell gains one only when a resident journey needs it.

| Journey | React test | What the test checks |
| --- | --- | --- |
| Payment accounts: cards, wallet, linked bills | `test/browser/pay-and-automate/linked-accounts.spec.ts` | one owned record per link, no money moved, private |
| Challenge and unknown outcome | `test/browser/accessibility/payment-states.spec.ts` | masked cards, a paused rule, a challenge and an unknown outcome are readable, named and reachable |
| Pause, resume and revoke a rule | `test/browser/failures/rules.spec.ts` | a paused rule keeps its consent, a rule cannot outlive its card, a revoked rule stays revoked |
| Automation inbox and rule editor | `test/browser/accessibility/automation-screens.spec.ts` | named, touchable controls and what went wrong is said |

## Not yet proven

These cells say "none yet" above. Each is either implemented in the shell and missing a test, or a decision to leave the journey out; close each by adding the test or by moving the journey to the React-only table with its reason.

- Angular sign-in against Keycloak: the Angular browser specs run against a stubbed gateway with authentication reported as disabled.
- Angular account switch.
- Angular Connections view.
- Angular main shell in Arabic (the fines route is covered).
- Flutter shell in Arabic in a browser (widget tests cover connections).

## Gated: not offered or not provable here

- **Native Flutter sign-in.** Authorization-code sign-in is a web build feature. A native build reports that it is not configured and offers no sign-in.
- **Devices.** Physical phones, foldables, screen readers, microphones and speakers are not exercised. The hinge and divider checks emulate fold geometry, and speech has its own limits in [local AI](local-ai.md).
- **Standards-based UI protocols.** AG-UI and A2UI adapters are optional and gated behind a client that needs them.

## Adding a journey

Name the journey in the matrix with one test per shell that offers it, or move it to the React-only table or the gated list with the reason. Run the specs for the shells it touches on both browser projects, and the Flutter widget tests for Flutter, before changing the matrix.
