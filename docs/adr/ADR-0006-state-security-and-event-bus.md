# ADR-0006: State Management, Mini-App Sandboxing, and Security Architecture

## Status
Accepted / Under Review

## Context
A SuperApp ecosystem combines heterogeneous mini-apps, third-party extensions, and an autonomous AI agent connected to external LLM providers (e.g., OpenRouter). This introduces critical architectural challenges:
1. **API Key Security**: The `OPENROUTER_API_KEY` and proprietary backend secrets must never leak to client frontends.
2. **Mini-App Sandboxing & Permissions**: Mini-apps should not tamper with the host shell, steal tokens of other mini-apps, or access device capabilities without explicit user/host consent.
3. **Cross-App Communication & State Synchronization**: When a user selects a meal in the Food mini-app, the payment must transfer seamlessly to the Wallet mini-app under agent supervision.

## Decision

We enforce a **Zero-Trust Host Sandboxing and Controlled Event Bus Architecture**:

```mermaid
flowchart TD
    subgraph ClientHost ["SuperApp Host Shell"]
        StateStore["Host Reactive State Store\n(Signals / Zustand / Riverpod)"]
        EventBus["Secure Event Bus\n(PostMessage / CustomEvent Channel)"]
        PermissionGuard["Mini-App Permission & Sandbox Guard"]
        
        subgraph SandboxedMiniApps ["Sandboxed Mini-Apps"]
            MiniAppA["Ride Mini-App (Sandbox A)"]
            MiniAppB["Food Mini-App (Sandbox B)"]
        end

        MiniAppA <-->|Scoped Event Dispatch| EventBus
        MiniAppB <-->|Scoped Event Dispatch| EventBus
        EventBus --> PermissionGuard
        PermissionGuard --> StateStore
    end

    ClientHost <-->|A2-UI Protocol (JWT Auth / WSS)| AgentGateway["Backend Agent Gateway"]

    subgraph BackendCluster ["Backend Microservices Cluster (Protected Network)"]
        AgentGateway <--> Orchestrator["Agent Orchestration Core"]
        Orchestrator --> KeyVault["Environment & Secret Store\n(OPENROUTER_API_KEY)"]
        Orchestrator <--> Microservices["Ride, Food, Wallet Services"]
    end
```

---

### 1. Secret Management & LLM Protection
- **Backend-Only Keys**: The `OPENROUTER_API_KEY` is loaded strictly on the server-side via environment variables (`.env`).
- **No Client Exposure**: Clients only receive sanitized A2-UI and AG-UI event payloads. The LLM prompts, proprietary system instructions, and tool definitions stay encapsulated within the Agent Gateway.
- **Rate-Limiting & Quotas**: The Agent Gateway enforces per-user rate limits and token budgets to prevent LLM abuse.

---

### 2. Mini-App Sandboxing & Permission Model
Every mini-app must declare a manifest specifying required permissions:
```json
{
  "miniAppId": "org.superapp.food",
  "version": "1.2.0",
  "permissions": [
    "geolocation:read",
    "payment:request"
  ],
  "allowedDomains": [
    "https://api.foodservice.internal"
  ]
}
```
- **Storage Isolation**: Mini-apps are partitioned using namespaced storage keys (e.g., `superapp:storage:org.superapp.food:*`). They cannot read host cookies or tokens from another mini-app.
- **Hardware Access**: Access to camera, microphone, or precise GPS must be requested via the Host Shell Permission Broker.

---

### 3. Cross-Mini-App Event Bus
Mini-apps communicate through a typed, broker-governed Event Bus:
- **`EVENT_REQUEST_PAYMENT`**: Dispatched by a commercial mini-app; intercepted by the Host Shell; delegates to the Wallet Mini-App modal or agent checkout flow.
- **`EVENT_SESSION_CONTEXT`**: Allows the active mini-app to share contextual metadata back to the Agent (e.g. current cart total, chosen pickup location) so the Agent remains aware of what the user is doing.

## Consequences

### Positive
- **Robust Security**: Protects LLM credentials and isolates third-party mini-app code from sensitive host storage.
- **Auditable Transactions**: All inter-app actions pass through the Agent Gateway and Event Bus, providing complete audit trails.
- **Extensible Governance**: Permission checks can be evaluated dynamically by policy engines.

### Negative / Trade-offs
- Slight serialization overhead when passing complex objects between mini-apps and host shell.
- Requires strict typing of event payloads across microfrontend boundaries.
