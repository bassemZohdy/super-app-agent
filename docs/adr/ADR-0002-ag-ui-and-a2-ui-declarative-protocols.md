# ADR-0002 — UI and agent-interaction protocol strategy

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **Legacy demo contract implemented; standards-aligned target proposed.**
**Reviewed:** 2026-10-24. The original naming in this repository does **not** correspond to public specifications.

## Context

The demo needed JSON component trees and bidirectional interaction between React, Angular, Flutter and the backend. It introduced a private “AG-UI” schema for components and a private “A2-UI” event stream. Public protocols now make a better abstraction boundary: [AG-UI](https://github.com/ag-ui-protocol/ag-ui) covers agent–frontend interaction; [A2UI](https://a2ui.org/) covers declarative UI. They are complementary.

## Decision

1. **Keep existing custom types functional** for compatibility with current demo/tests; call them **legacy SuperApp protocol** in architecture documents.
2. **Do not claim standards compliance.** The symbols `AGUISurfacePayload`, `A2UIMessageEnvelope` and `A2UI_RENDER_SURFACE` belong to the current custom contract, not official AG-UI/A2UI.
3. For target architecture: adopt official AG-UI event/message/run lifecycle between Concierge and shells, carrying official A2UI UI specifications as data.
4. Preserve framework-neutral capability catalogs and semantic action IDs. Server-side policy owns allowed side effects.
5. Use a generic Lit Web Component renderer on web and equivalent native Flutter renderer for validated A2UI surfaces from static, service or agent origins.

## Current evidence

`packages/protocol-core/src/ag-ui.ts` defines `UIComponentNode` and supported components; `a2-ui.ts` declares custom event names; agent-core only serves HTTP + SSE and emits a subset of events. There is no official AG-UI/A2UI adapter, negotiated component catalog or conformance test.

## Trade-offs / risks

A migration introduces client-adapter work, surface state reconciliation, version negotiation, error/event replay and accessibility requirements. It must not make arbitrary model output executable. The existing action allowlist is a defense in depth measure, not a sufficient business authorization policy.

**Reference:** [Protocol inventory](../architecture/protocol-ag-ui-a2-ui.md).
