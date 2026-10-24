# Frontend shells and mini-app integration

All three shells now include explicit bounded delegation consent, run, revoke and audit controls backed by the separate trusted broker. [Guide](../development/delegation.md) · [Actual React browser evidence and remaining parity limits](../reports/2026-10-24-delegation-demo.md).

The current Cityside interface uses account-bound authenticated surfaces. React and Angular sign in with Keycloak authorization code + S256 PKCE; Flutter uses a local-demo password grant. All service names and funds represent simulators. See [setup](../development/local-development.md) and [current validation](../reports/2026-10-24-demo-completion.md).

## Implemented clients

| Client | Current behavior | Remaining boundary |
| --- | --- | --- |
| React | Conversation and service workspace, PKCE/refresh/logout, personal/household selection, saved conversation restore/delete, authenticated SSE, local microphone drafts and opt-in KittenTTS speech | Complete accessibility/component conformance, production session design and remote mini-app isolation |
| Angular | Separate custom renderer, PKCE/refresh/logout, account selection, authenticated SSE and internal local voice controls | Full UI/component parity and automated browser conformance |
| Flutter | Custom widgets, local-demo login/refresh/logout, account selection at phone and desktop widths, HTTP intents/actions, authenticated SSE and saved transcript restore | Native PKCE, native speech, device/distribution validation and complete renderer parity |
| Legacy mini-apps | Ride, food, wallet and housing mount modules in the workspace | Standalone modules are compatibility examples, not retained demo execution paths |

React service navigation uses authenticated `/api/manual/prepare` and stable `/services/{id}` routes without a prior chat proposal or model call. The catalog declares repository-bundled surfaces, compatibility and trust; unused remote URLs/device permissions were removed. Exact mini-app IDs map to allowlisted routes. React does not mount the standalone legacy modules. No Module Federation, remote loader, Web Components or generic Lit renderer is claimed. The old modules remain source/type-checked compatibility examples.

React and Angular share the fetch SSE client and browser OIDC helper in `packages/protocol-core`. Access tokens are sent in headers; refreshed tokens are obtained through the helper. Tokens live in sessionStorage, which is accessible to same-origin JavaScript. The selected account and conversation reference also live there. Logout clears local tokens and redirects through Keycloak; owned server conversations remain until deletion or expiry.

React restores the selected account's transcript and current surface through `/api/sessions/{id}`. Account switching clears the prior workspace and restores or creates a conversation for that account. Saved inference status is restored with the transcript and surface so model errors remain visible after reload. Busy controls prevent local overlaps; the server's session lease/revision remains authoritative. The connection indicator distinguishes a reachable concierge, configured inference, a successful generated response and a model error. “Local model ready” uses the actual llama.cpp health probe; speech model-file readiness is checked separately. Physical device quality and native speech remain open. [Voice behavior](voice-and-conversation.md).

Flutter web has a checked-in bootstrap page. Build/analyzer/widget-test results and exact versions are in the current report. Web compilation does not establish Android/iOS authentication, permissions or native lifecycle behavior. Flutter's renderer visibly reports unsupported components; it is not equivalent to the web renderers.

## Intended shared experience

The target supports dedicated native mini-app screens for complex interactions, standard declarative surfaces for read/review/form tasks, and conversational journeys linking those surfaces. The host owns navigation, identity UX, lifecycle and approved device access. The renderer owns schema/component handling. The agent requests permitted capabilities and screens; domains own resource authorization and business effects.

The proposed remote manifest needs stable IDs/versions, shell compatibility, signed asset references, permissions, routes, data sensitivity, rollout/rollback and an allowlisted host bridge. None of these controls follows from a remote URL string. Manual mini-app and concierge paths must use the same governed capabilities and quote/approval rules.

Test Arabic/RTL, keyboard/focus/screen readers, touch sizes, device lifecycle and failure states before treating the target as a supported platform. See [custom protocol](protocol-ag-ui-a2-ui.md), [ADR-0004](../adr/ADR-0004-microfrontend-and-mini-app-runtime.md), and [ADR-0005](../adr/ADR-0005-multi-flavor-frontend-adapters-react-angular-flutter.md).
