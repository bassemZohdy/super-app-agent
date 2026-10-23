# UI protocol inventory: current custom contract vs standards

**Important correction (23 October 2026):** This repo originally used the terms *AG-UI* for a proprietary JSON UI tree and *A2-UI* for a proprietary transport. The public protocols use the opposite allocation of responsibilities:

| Name | Public standard | This repository today |
| --- | --- | --- |
| **AG-UI (Agent–User Interaction)** | Standardized event/run/state/message flow between agent and application; [AG-UI project](https://github.com/ag-ui-protocol/ag-ui), [overview](https://www.copilotkit.ai/ag-ui) | No standard AG-UI SDK or event envelopes. Custom events named `A2UI_*` instead |
| **A2UI (Agent-to-User Interface)** | Structured/declarative UI surface language. [A2UI spec](https://a2ui.org/) (pin a supported version before implementing the proposed adapter) | Custom `UIComponentNode` tree inside file `ag-ui.ts`; **not** A2UI-schema compliant |
| **MCP** | Standard protocol for tools/resources/prompts | Core `/mcp` implements authenticated Streamable HTTP with the official SDK/reference-client tests; application `GET /mcp` remains descriptor metadata |
| **A2A** | Inter-agent communication and delegation | Not implemented in agent-core |

**Rule:** Say “custom UI/event contract” for existing code; use “AG-UI” and “A2UI” without qualifiers only when referring to the external standards.

## Current interface location

| Source | Responsibility |
| --- | --- |
| `packages/protocol-core/src/ag-ui.ts` | `UIComponentNode`/`AGUISurfacePayload` and helper builders |
| `packages/protocol-core/src/a2-ui.ts` | `A2UIMessageEnvelope` and custom event names |
| `services/agent-core/src/index.ts` | HTTP intent/action APIs and SSE event broadcaster |
| `apps/shell-react/src/components/A2UIRenderer.tsx` | React rendering for the current custom tree |
| `apps/shell-angular/src/app/app.component.ts` | Angular shell-specific custom rendering |
| `apps/shell-flutter/lib/main.dart` | Flutter-specific custom rendering |

### Current custom UI payload

```json
{
  "version": "1.0.0",
  "sessionId": "sess_example_001",
  "timestamp": 1792730000000,
  "view": {
    "type": "SurfaceCard",
    "id": "example",
    "children": [
      { "type": "Heading", "id": "heading", "properties": { "text": "Select a service", "level": 2 } },
      { "type": "Button", "id": "choose", "properties": { "label": "Continue" },
        "onEvents": [
          { "event": "onPress", "actionType": "AGENT_ACTION_DISPATCH",
            "payload": { "action": "example_action" } }
        ]
      }
    ]
  }
}
```

This shows **shape only**. `example_action` is not an implemented backend action and would fail authorization. The tree type is validated by `validateAGUISurface`; the helper's checks include some properties, limits on tree depth and counts, and permitted event categories. It is not a complete domain semantic validator or trust boundary.

Supported demo component types include `SurfaceCard`, `Heading`, `Text`, `Badge`, `ChoiceGroup`, `Button`, `FormInput`, `MetricWidget`, `MapViewer`, `DataTable`, and `MiniAppEmbed`. Client rendering parity is not yet automatically established across all three shells.

### Current custom transport/events

Backend routes:

| Endpoint | Expected use | Important notes |
| --- | --- | --- |
| `GET /health` | Runtime metadata | Public |
| `GET /api/a2ui/stream?sessionId=...` | Server-Sent Events | Bearer Authorization header required in integrated mode; include the selected `accountId` reference, never a token in the URL |
| `POST /api/a2ui/intent` | `{ sessionId, accountId?, text, handshake? }` | Handshake in request is currently not used to negotiate renderer components |
| `POST /api/manual/prepare` | `{ sessionId, accountId?, serviceId }` | Fixed bundled route; bypasses model execution |
| `POST /api/a2ui/cancel` | `{ sessionId, accountId?, surfaceRevision }` | Cancels the pending proposal and saved continuation |
| `POST /api/a2ui/action` | `{ sessionId, accountId?, surfaceRevision, action, payload }` | Requires existing session, matching server-issued surface revision and action offered on active surface |

Declared custom envelope: `{ id, type, sessionId, timestamp, data }`.

Custom event enum in `a2-ui.ts`:
- `A2UI_HANDSHAKE` / `A2UI_HANDSHAKE_ACK`
- `A2UI_USER_INTENT`
- `A2UI_STREAM_DELTA`
- `A2UI_RENDER_SURFACE`
- `A2UI_EVENT_TRIGGER`
- `A2UI_LAUNCH_MINIAPP`
- `A2UI_CLIENT_ERROR`

Actual HTTP/SSE handler emits handshake ACK, stream deltas and render surface messages; the enum does **not** imply complete two-way WebSocket support. The render modes `REPLACE`, `PATCH` and `APPEND` appear in types, but the current agent-core emits `REPLACE` and there is no documented patch-reconciliation conformance test.

### Event payload example

```json
{
  "id": "msg_example",
  "type": "A2UI_RENDER_SURFACE",
  "sessionId": "sess_example_001",
  "timestamp": 1792730000000,
  "data": {
    "mode": "REPLACE",
    "surface": {
      "version": "1.0.0",
      "sessionId": "sess_example_001",
      "timestamp": 1792730000000,
      "view": {
        "type": "SurfaceCard",
        "id": "example"
      }
    }
  }
}
```

## Security and correctness limitations

- **No client-trust transfer:** UI-rendered buttons do not authorize a payment. Core checks a subject/account/revision-bound approval, five-minute expiry, canonical view digest, every advertised payload field and scoped choice. Providers independently enforce resource/account ownership. Production quote attestation and delegated consent remain open.
- **Replay/backpressure:** the [stream implementation](event-stream.md) uses persistent Redis replay in integrated mode and a bounded process-local journal in fixture mode. Only fixture state is lost on ordinary process restart. Actions require the UUID revision of the current surface; timestamps are display metadata. Per-session coordination rejects concurrent transitions. Partial/unknown writes require reconciliation before more requests in that session.
- **Schema:** envelopes reject null/scalar/array data, non-finite or negative timestamps, oversized IDs, invalid render modes and surface/envelope session mismatches without throwing. Validation now includes required event payloads, a 256 KiB UI byte budget, 500 total nodes, unique component/choice IDs, depth and collection limits, map coordinates and table row/column shapes. Full property semantics and renderer conformance remain partial.
- **Reasoning exposure:** current phase names may say “REASONING”; do not stream sensitive hidden model reasoning. Use progress/status descriptions only.
- **Navigation:** `LAUNCH_MINIAPP` is named, but shell capabilities and available manifests should be verified before any transition.

## Standards-alignment plan (not implemented)

1. Freeze/version the existing custom wire contract as `legacy-superapp/1.0` and write contract/golden-case tests.
2. Use the official AG-UI agent event types and lifecycle for the agent↔frontend interaction boundary; adapt current custom events instead of renaming them blindly.
3. Adopt official A2UI surfaces/components/data binding and client action contracts in an isolated adapter. Select a concrete supported specification version and test against published fixtures.
4. Preserve the agreed shared generic renderer idea: a Lit Web Component on web and a native renderer on Flutter, each reading validated A2UI definitions from static configuration, services or an agent.
5. Keep navigation, identity, permissions and payments owned by the host/policy/domain layers—not by generated JSON.
6. Add capability handshake negotiation, version pinning, locale/accessibility, update/reconciliation semantics, error handling and frontend conformance tests.

See [ADR-0002](../adr/ADR-0002-ag-ui-and-a2-ui-declarative-protocols.md) and [frontend guide](frontend-and-miniapps.md).


## Current stream recovery

The authenticated web/backend stream now has event IDs, bounded replay, snapshots, expiry and slow-consumer bounds. See the [wire contract](event-stream.md). This remains the custom envelope above; React/Angular now have end-user OIDC login; Redis mode provides persistent cross-process replay. Flutter has an authenticated SSE parser/reconnect/lifecycle client with unit coverage; native device/proxy execution remains open. See the current provider demo guide for the two runtime modes.

## Action revision migration (P0-10)

Core-issued surfaces include an opaque `revision` UUID. Echo that exact value as the required `surfaceRevision` in `POST /api/a2ui/action`; omission or malformed values return 400. Protocol example fixtures may omit a revision, but they cannot be used as core action approvals. React, Angular, Flutter and the flight recorder now echo it. HTTP and SSE carry the same committed revision.

`SESSION_BUSY` (409) means wait for the running request; do not automatically replay a mutation. `STALE_SURFACE` (409) returns the current surface for user review. Definitive failed execution replaces the approval with a fresh warning revision; start a new intent after correcting the cause. `RECONCILIATION_REQUIRED` (409) blocks both intents and actions after partial/unknown effects and preserves their step summary. There is no public unblock operation: an authenticated provider/status reconciliation workflow remains P0-06. Redis mode persists reconciliation and uses shared session leases with fenced saves across instances. Fixture mode loses coordination/reconciliation on restart. Neither mode establishes cross-session business atomicity or a production reconciliation workflow.
