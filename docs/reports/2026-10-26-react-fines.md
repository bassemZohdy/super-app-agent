# React fines and workspace-pane verification — 26 October 2026

Implementation revision: **`9041913`**, including the OpenRouter configuration in parent **`a2da03e`**. Commands ran on the implementation working tree before its commit; the final browser and static checks include the final pane sizing and compatibility-surface regression. This report adds evidence only.

Environment: macOS arm64, Node.js 24.15.0, npm 12.0.2, installed locked dependencies with the SQLite binding rebuilt using pinned npm 11.9.0. Browser projects use Chrome at desktop 1440×1000 and phone 390×844. The focused browser fixtures start real agent subprocesses and Vite on ephemeral loopback ports, with random test identities and temporary file-backed SQLite databases. They explicitly select the fixture planner and clear provider keys from the agent subprocess environment.

| Executed command | Result |
| --- | --- |
| `npm run check:agent` | Passed: agent/test type-checks and 24 focused tests, including actual process kill/restart and original-operation reconciliation |
| `npm run check` | Passed: lint, E2E types, docs, secret/local-only/token gates, 880 Node tests passed, 2 skipped, no failures; 19 workspace builds succeeded |
| `E2E_SUITE=focused-agent npm run test:browser -- focused-agent` | Passed: 12 desktop/phone browser tests |
| Final `npm run lint`, `npm run check:e2e`, `npm run check:tokens`, `npm run check:docs`, `git diff --check` | Passed after the final layout and documentation changes |
| `npm run agent:verify:model` | Failed safely: the first real-provider case returned `MODEL_UNAVAILABLE_OR_INVALID_PLAN`; stopped with 0/8 smoke cases passed, without retry or fallback |

## What the browser tests prove

- The React fines conversation lists actual simulated records over authenticated HTTP, prepares only selected fine IDs and displays their exact AED total using the existing renderer.
- Killing and restarting the real agent on the same SQLite file restores the identical approval. Approval creates one persisted simulated payment. Repeating its request returns the same result; fresh stale/duplicate approvals and another owner's actions add no payment. A refresh restores the receipt after authenticating again.
- Rejecting, cancelling the review and cancelling the conversation create no payment. A cancelled thread stays inspectable and rejects new messages.
- Losing the approval response after the server completes it blocks replacement commands. Recovering the original operation reveals its saved receipt without adding another payment.
- Conversation and service details swap in DOM and visual order, maximize, minimize and restore while retaining a draft. A minimized review reopens for a new approval. Focus, control targets and horizontal overflow are measured on both projects.
- The main compatibility concierge uses the same pane controls and its rendered service surface fills the available pane. That layout test uses an explicit stubbed compatibility gateway; it does not claim a full authenticated compatibility-stack journey.
- User tokens remain absent from browser storage; only the conversation ID is retained. The model key is never part of the browser configuration.

Screenshots and the Playwright report are generated under `.data/e2e-artifacts/focused-agent/`, including selected-fine reviews, receipts and the maximized conversation. The desktop and phone screenshots were inspected visually. These disposable artifacts are not added to the repository.

## Real inference boundary

The existing process environment key is wired to the explicitly selected HTTPS OpenRouter endpoint and free router, with zero-price routing enforced in requests. Local private configuration is generated without copying that key. Endpoint/key isolation and paid-model refusal are tested offline.

Live access did not produce a usable provider response. An authentication-status probe also failed at network connectivity, and a public endpoint probe failed with a socket connection error. **No successful key authentication, completion, model accuracy or latency qualification is claimed.** The local agent's `/ready` endpoint confirms configuration and SQLite access, not model reachability. No fixture or paid fallback was enabled for the interactive configuration.

## Limits

The self-contained fines suite requires no Docker. The other compatibility browser suites, Compose/Keycloak integration, containers, Angular/Flutter migration and physical/native devices were not run here. The test authority and simulated payment records do not establish production identity, delegation or financial correctness for real providers. Task state remains solely in `TODO.md`.
