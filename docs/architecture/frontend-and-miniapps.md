# Frontend shells and mini-app integration

## What exists

| Surface | Actual source | Present approach | Not yet proven |
| --- | --- | --- | --- |
| React | `apps/shell-react/src/App.tsx` and `components/A2UIRenderer.tsx` | Vite shell, chat and custom UI renderer, directly imported mini-app mount functions | Remote federation / hostile mini-app isolation / OIDC login |
| Angular | `apps/shell-angular/src/app/app.component.ts` | Standalone demo UI with custom rendering and SSE | Visual/runtime parity, OIDC login, shared renderer library |
| Flutter | `apps/shell-flutter/lib/main.dart` | Dart widgets mapped from custom schema, HTTP actions, example demo identity | Native package distribution, platform-specific auth, parity |
| Mini-apps | `mini-apps/miniapp-*` | Ride, food, wallet, housing example modules | Independently deployable MFE runtime; source imports are bundled |
| Catalog | `services/service-catalog/src/index.ts` and manifests | Metadata, example `entryRoute`, `remoteUrl`, permissions | Signed manifests, version/permission enforcement and vetted remote loader |

The README previously called the runtime “Module Federation + Web Components”. That is an **aspiration**: the current React shell directly imports the mini-app components. None of these sample bundles provide a validated runtime registry/loader, isolation boundary or universal Lit renderer.

React and Angular share `packages/protocol-core/src/sse-client.ts`: header-based bearer auth, incremental UTF-8 parsing, reconnect cursor/reset, and lifecycle abort. Both still supply local demo tokens. The build type-checks Node/mini-app source without emitting it (Node executes TypeScript directly), and bundles the two web shells. Housing is now a registered workspace. See [verification](../reports/2026-10-23-release-gates.md).

## Three UI types in the proposed agent-first experience

1. **Native mini-app screen:** existing complex domain UI, e.g. map-oriented parking.
2. **Declarative UI screen:** standardized A2UI JSON rendered by generic web/mobile renderer, populated from a static config, service or trusted agent-generated proposal.
3. **Conversational journey:** AG-UI streams agent messages/progress and embeds/refers to A2UI surfaces, while the shell owns navigation.

Prefer declarative UI for simple read/review/form tasks and dedicated mini-app code when advanced interactivity or third-party integration demands it. Both should call identical governed business capabilities.

## Contracts and ownership (future)

- **Host owns:** app-level navigation, authentication UX, back stack, lifecycle, layout, localization, accessibility, approved native device capabilities.
- **Renderer owns:** strict schema validation, supported component catalog, data-binding semantics, state reconciliation, presentation-only actions.
- **Agent owns:** user-intent understanding, composing journeys, *requesting* screens/transitions and determining what information is needed.
- **Domain owns:** resource ownership, business data, authorization, payment state and durable idempotency.

A dynamic UI should never gain arbitrary JavaScript execution, unrestricted navigation, token access or silently approved financial operations.

## Manifest evolution proposal

An independently deployable mini-app manifest should eventually describe: stable ID, version, shell compatibility, display name, signed asset location, permissions/capabilities, route catalog, accessible UI templates, API/MCP contracts, data sensitivity, trust tier, and policy requirements. A remote URL string in the current catalog is **not** enough.

## Responsive experience

The existing examples target chat plus a workspace/tabbed mini-app presentation. Preserve the idea of a focused mobile task surface and split desktop workspace, but test screen-reader behavior, keyboard access, RTL/Arabic, session switching and failure states on actual device sizes before treating it as a platform standard.

See [UI protocols](protocol-ag-ui-a2-ui.md), [ADR-0004](../adr/ADR-0004-microfrontend-and-mini-app-runtime.md), [ADR-0005](../adr/ADR-0005-multi-flavor-frontend-adapters-react-angular-flutter.md).

