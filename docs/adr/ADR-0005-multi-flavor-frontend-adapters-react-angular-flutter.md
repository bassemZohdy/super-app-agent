# ADR-0005 — React, Angular and Flutter reference shells

> Implementation review, 24 October 2026: [current status](../STATUS.md), [delivery target](ADR-0011-local-demo-target.md) and [bounded delegation amendment](ADR-0012-secure-delegation-demo.md) identify the implemented demo. This decision does not establish production approval.

**Status:** **Browser login/builds and scoped Flutter web/widget checks exist; complete/native parity remains open.**
**Reviewed:** 2026-10-24.

## Context

The intended Super App supports a web shell and native mobile experience while allowing independently governed mini-apps. Multiple frontend implementations are useful for proving that the *semantic* UI contract is not coupled to one JS framework.

## Decision

- Continue React, Angular and Flutter as **reference clients**, not independent product architecture sources.
- Favor React for web reference and Flutter for native mobile; Angular remains a compatibility experiment.
- The shell owns route state, authentication UI, back stack, device capability access, accessibility, locale and view lifecycle.
- The dynamic renderer consumes only validated UI specifications. Shared semantics and contract tests are required before calling renderers equivalent.
- Support split workspace on wide screens and task-focused cards/modal/sheet navigation on phones.

## Current evidence

React has `A2UIRenderer.tsx`, Angular a separate renderer, and Flutter a native widget mapping for a subset. React/Angular use Keycloak PKCE and account selection; Flutter uses a local-demo password grant. Redis stores owner/account-bound conversations. Flutter web bootstrap, strict analysis and account-switch widget tests now exist. Complete component conformance, native PKCE/speech and production handshake remain open. See the [current evidence](../reports/2026-10-24-demo-completion.md).

## Consequences

Multiple adapters increase maintenance and UI parity testing. A generic Lit renderer could consolidate web semantics while native Flutter keeps platform quality, but this remains a proposed migration. Do not assume a browser-specific bundle can be dynamically installed as a native Flutter module.

See [frontend guide](../architecture/frontend-and-miniapps.md), [security](../../SECURITY.md).
