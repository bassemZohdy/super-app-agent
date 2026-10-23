# ADR-0004 — Mini-app presentation and deployment strategy

**Status:** **Embedded mini-app demonstration implemented; independent MFE runtime proposed.**
**Reviewed:** 2026-10-23.

## Context

The Super App needs both reusable native surfaces and specialized domain experiences. “Independently deployed mini-app” implies lifecycle, compatibility, remote loading, sandboxing, resource scopes and version governance—not merely a manifest with `remoteUrl`.

## Decision

- Keep a **hybrid user experience**: standard declarative A2UI for basic forms/cards/review panels; approved Web Components/native features for advanced user interaction.
- For web, prefer framework-neutral Web Components for integration boundaries and the proposed generic Lit A2UI renderer for structured UI.
- For mobile, retain a native Flutter renderer for declarative screens and use explicitly reviewed embeddings only for unsupported complex integrations.
- A future registry must approve signed artifacts, permissions, versions, route boundaries, lifecycle and event contracts before activation.
- Let the agent *request* a mini-app transition; the shell checks permissions and performs navigation.

## Current evidence

The React shell directly imports ride, food, wallet and housing mini-app `mount*` functions. The catalog contains metadata and sample remote entry URLs. Real runtime module federation, signed/isolated remote bundles, marketplace approval and native dynamic code delivery are **not demonstrated**.

## Consequences

Declarative UI reduces duplicated frontend code but needs a restrictive component catalog and semantic parity. Runtime-loaded code supports rich interactions but expands supply-chain and isolation risk. Iframes/WebViews remain a deliberate isolation option for legacy/untrusted integrations, not a default.

See [frontend guide](../architecture/frontend-and-miniapps.md).
