# Agent flow

`services/agent-core/src/orchestrator/graph.ts` uses native `StateGraph`, annotations, conditional edges, `interrupt`, `Command` and the official SQLite saver. There is no custom executor or workflow specification.

```mermaid
flowchart TD
  Understand["Understand request and select bounded plan"] -->|Fines intent| List["List fines through governed REST tool"]
  Understand -->|Clarify, unsupported or provider error| Respond["Return conversational and structured result"]
  List -->|Read request or service failure| Respond
  List -->|Payment requested| Prepare["Build exact server quote"]
  List -->|Renewal requested| Vehicles["List vehicles; check renew permission"]
  Vehicles -->|Fines outstanding| Prepare
  Vehicles -->|No fines| RenewPrepare["Build exact renewal quote"]
  Vehicles -->|None due, ambiguous or unavailable| Respond
  Prepare -->|Empty or invalid selection| Respond
  Prepare -->|Pay permission| Approval["Persisted human interrupt"]
  Approval -->|Reject, cancel or expire| Respond
  Approval -->|Exact approval action| Execute["Revalidate authority and consent; simulate payment"]
  Execute -->|Plain fines payment| Respond
  Execute -->|Fines paid in a renewal| RenewPrepare
  RenewPrepare --> RenewApproval["Second persisted human interrupt"]
  RenewApproval -->|Reject, cancel or expire| Respond
  RenewApproval -->|Exact approval action| RenewExecute["Revalidate authority and consent; simulate renewal"]
  RenewExecute --> Respond
```

The plan selects only `list_fines`, `pay_fines`, `renew_registration`, `clarify` or `out_of_scope`, with at most ten fine IDs and an optional vehicle ID. Tool discovery is an in-process list of typed descriptors. Payment always reads current backend details and constructs an integer-fils quote; the model cannot supply amount, permission or consent. The graph has no backward edges, uses a recursion limit of twelve, and makes at most one planning call and two business tool calls per normal turn. Model timeout is fifteen seconds; tool timeout is three seconds. There is no automatic model or write fallback.

State contains a bounded twelve-message history, validated plan, fine details, pending approval, human decision, receipt, status and response text. The thread ID is server-generated and its subject/workload binding and one-day expiry live in SQLite. An approval has a random ID, exact quote, stable operation key and five-minute expiry. The approval node has no side effects before `interrupt`: resume re-enters that node. The following execute node checks fresh request authority and persisted consent before invoking the tool.

Access tokens, workload secrets and model keys are kept in request-local `AsyncLocalStorage` or adapter configuration, never graph config/state. Checkpoints use synchronous durability. They preserve execution position, not exactly-once business effects. The simulator commits its idempotency receipt and all fine changes in one SQLite transaction. The agent records the original operation before dispatch and preserves that identity on reconciliation.

`POST .../recover` continues a failed native graph node. For an unknown payment it re-enters execution only with the original persisted approval and operation key; expired/revoked authority still fails closed. This retry is valid specifically because this REST simulator durably implements idempotency. Other adapters must declare and prove their retry/reconciliation semantics. Unknown outcomes block new requests and cancellation that would obscure the unsettled action.

## Fines then registration renewal

A renewal request is the one multi-service journey. The vehicles node first refuses a resident who lacks `vehicles:renew`, so nobody is asked to clear fines for a renewal they cannot make. Outstanding fines go through the ordinary payment review and approval; once they are paid the graph builds a renewal quote and waits at a second interrupt. Each approval has its own ID and operation key, and answering one never answers the other.

The two effects are separate and nothing is atomic across them, so the outcome says what actually happened: `complete` when both finished; `partial` when the fines were paid but the renewal was declined, expired, refused (for example `FINES_OUTSTANDING` when a new fine appeared) or lost its authority, with the fines receipt kept and the reply stating that the registration was not renewed; `unknown` when the renewal response was lost, which blocks any replacement renewal and cancellation until `POST .../recover` re-enters it with the original persisted approval and operation key. A refusal the simulator or the authority check states clearly is not treated as unknown.

Typed chat assent cannot resume an interrupt. Only a validated action with the exact approval ID can resume it. Reject/cancel actions execute no payment. Session cancellation prevents subsequent turns. Inspect and recover do not extend authority or approval expiry.
