# ADR-0005 — React, Angular and Flutter reference shells

> Current demo implementation update (23 October 2026): see [ADR-0010](ADR-0010-provider-simulators-and-redis-demo.md) and the [provider guide](../demo/provider-backends.md). Earlier implementation descriptions below record the prior fixture baseline. The integrated demo now has REST provider adapters, Keycloak browser/service authentication and Redis sessions; LangGraph, production consent and standards migration remain targets.

**Status:** **Sample shells exist; parity and full build validation pending.**
**Reviewed:** 2026-10-23.

## Context

The intended Super App supports a web shell and native mobile experience while allowing independently governed mini-apps. Multiple frontend implementations are useful for proving that the *semantic* UI contract is not coupled to one JS framework.

## Decision

- Continue React, Angular and Flutter as **reference clients**, not independent product architecture sources.
- Favor React for web reference and Flutter for native mobile; Angular remains a compatibility experiment.
- The shell owns route state, authentication UI, back stack, device capability access, accessibility, locale and view lifecycle.
- The dynamic renderer consumes only validated UI specifications. Shared semantics and contract tests are required before calling renderers equivalent.
- Support split workspace on wide screens and task-focused cards/modal/sheet navigation on phones.

## Current evidence

React has `A2UIRenderer.tsx` and in-process mini-app imports; Angular has a separate component renderer; Flutter manually maps the custom UI tree to widgets. All use local demo identity markers. There is no cross-platform conformance suite, real OIDC/PKCE or production client capability handshake.

## Consequences

Multiple adapters increase maintenance and UI parity testing. A generic Lit renderer could consolidate web semantics while native Flutter keeps platform quality, but this remains a proposed migration. Do not assume a browser-specific bundle can be dynamically installed as a native Flutter module.

See [frontend guide](../architecture/frontend-and-miniapps.md), [security](../../SECURITY.md).
