---
name: verify-demo
description: Run the integrated demo verification that matches a change area (payments, delegation, local AI, restart, security) against the running Docker stack, and report results honestly.
disable-model-invocation: true
---

# Verify the integrated demo

Target area: $ARGUMENTS (for example `payments`, `delegation`, `local-ai`, `restart`, `security`, `journeys`, `manual`). If empty, infer the area from `git diff --stat main` and state the choice before running anything.

## Steps

1. Confirm the stack is up with `npm run demo:wait`. If it fails, stop and report it. Do not start containers without asking, because `demo:up` reconciles Keycloak and the demo databases.
2. Run the matching scripts from the table below, one at a time. Do not run wallet-changing checks in parallel. `demo:verify:restart` must run with no other wallet-changing tests active.
3. If a script fails, report the exact failing assertion and output. Do not retry blindly and do not weaken or skip an assertion.
4. Finish with `npm run check:docs` if any Markdown changed. Run `npm run lint` if any TypeScript changed.

| Area | Commands |
| --- | --- |
| payments | `npm run demo:verify:payment-ledger`, `npm run demo:verify:payment-authorization`, `npm run demo:verify:wallet-funding`, `npm run demo:verify:fine-checkout` |
| delegation | `npm run demo:verify:delegation`, `npm run demo:verify:delegation:security` |
| local-ai | `npm run local-ai:verify`, `npm run local-ai:test` |
| restart | `npm run demo:verify:restart` |
| security | `npm run demo:verify:security` |
| journeys | `npm run demo:verify:journeys` |
| manual | `npm run demo:verify:manual` |

## Report

For each command, give the result (PASS or FAIL) and the one-line evidence from its output. State any command you did not run and why. Do not describe a check as passing unless its output shows it.
