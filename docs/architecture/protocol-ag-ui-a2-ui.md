# UI protocol inventory: current custom contract vs standards

**Important correction (23 October 2026):** This repo originally used the terms *AG-UI* for a proprietary JSON UI tree and *A2-UI* for a proprietary transport. The public protocols use the opposite allocation of responsibilities:

| Name | Public standard | This repository today |
| --- | --- | --- |
| **AG-UI (Agent–User Interaction)** | Standardized event/run/state/message flow between agent and application; [AG-UI 1.0](https://github.com/ag-ui-protocol/ag-ui), [overview](https://www.copilotkit.ai/ag-ui) | No standard AG-UI SDK or event envelopes. Custom events named `A2UI_*` instead |
| **A2UI (Agent-to-User Interface)** | Structured/declarative UI surface language. [A2UI spec](https://a2ui.org/) (v0.9.1 current, v1.0 candidate as checked October 2026) | Custom `UIComponentNode` tree inside file `ag-ui.ts`; **not** A2UI-schema compliant |
| **MCP** | Standard protocol for tools/resources/prompts | Service `GET /mcp` returns a simple tool list/descriptor; no proven MCP server transport/session or tool invocation |
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
| `GET /api/a2ui/stream?sessionId=...` | Server-Sent Events | Needs valid auth; `&demo=1` works **only** when local demo auth enabled |
| `POST /api/a2ui/intent` | `{ sessionId, text, handshake? }` | Handshake in request is currently not used to negotiate renderer components |
| `POST /api/a2ui/action` | `{ sessionId, action, payload }` | Requires existing session and action offered on active surface |

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

- **No client-trust transfer:** UI-rendered buttons do not authorize a payment. The code checks current-surface events and a small list of protected payload fields; authoritative service-side authorization, quote validation and consent are missing.
- **Replay/backpressure:** messages get a timestamp/random ID; they are not durably ordered or replayed after reconnect. Subscribers are a process-local Set.
- **Schema:** recursive type/property limits are partial and all three renderers need parity, accessibility and malicious payload tests.
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
