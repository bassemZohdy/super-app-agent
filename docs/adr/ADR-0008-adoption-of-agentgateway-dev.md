# ADR-0008: Adoption of agentgateway.dev for Edge Security, MCP Tool Federation, and Model Data Plane

## Status
Accepted

## Context
In ADR-0003 and ADR-0007, we established an Agentic Gateway (BFF) pattern orchestrating domain microservices (Ride, Food, Wallet) and interfacing with OpenRouter for foundation model inference. 

As the SuperApp scales, three critical challenges emerge:
1. **Tooling & Protocol Fragmentation**: Domain microservices need a standardized protocol to expose tools, actions, and resources to the agent without building bespoke wrapper code. The **Model Context Protocol (MCP)** by Anthropic has emerged as the open industry standard for AI tool and resource access.
2. **Model Traffic Governance & Resilience**: Routing directly from Node.js/Python to LLM endpoints lacks enterprise-grade token bucket budgeting, automatic multi-provider fallback, latency-based load balancing, and rate limiting.
3. **Edge Security & High-Performance Data Plane**: Handling thousands of concurrent mobile device connections with JWT validation, DDoS defense, and OpenTelemetry distributed tracing requires a high-performance, memory-safe data plane.

To address these needs natively, we evaluate **agentgateway.dev** (an open-source, Rust-based data plane created by Solo.io tailored specifically for LLMs, AI agents, and MCP).

## Decision

We adopt **`agentgateway.dev`** as the **Universal Agent Data Plane & Ingress Proxy**:

```mermaid
flowchart TD
    subgraph Clients ["Frontend Clients (Mobile & Web)"]
        ReactApp["React 18 Shell"]
        AngularApp["Angular 18 Shell"]
        FlutterApp["Flutter Mobile App"]
    end

    subgraph EdgePlane ["agentgateway.dev (Edge Ingress Proxy)"]
        JWTValidator["JWT / OAuth Validation"]
        RateLimiter["Token Bucket Rate Limiting (CEL)"]
        TraceEmitter["OpenTelemetry Spans & Metrics"]
    end

    Clients <-->|A2-UI Transport (SSE / WS)| EdgePlane

    subgraph BFFLayer ["A2-UI Protocol Broker & UI Session Service (:4000)"]
        HandshakeEngine["Handshake & Viewport Adapter"]
        AGUICompiler["AG-UI Schema Generator & Validator"]
        HITLManager["Human-in-the-Loop Interrupt/Resume"]
    end

    EdgePlane <--> BFFLayer

    subgraph AgentCore ["Agent Platform: LangGraph Orchestrator"]
        Supervisor["Concierge Supervisor Agent"]
        StateGraph["Multi-Agent StateGraph & Checkpointer"]
    end

    BFFLayer <--> AgentCore

    subgraph AgentDataPlane ["agentgateway.dev (Internal Agent & Model Mesh)"]
        MCPFederation["MCP Tool Federation & Discovery"]
        ModelProxy["OpenRouter / LLM Proxy & Token Budgeting"]
        A2ARouter["Agent-to-Agent (A2A) Policy Router"]
    end

    AgentCore <--> AgentDataPlane

    subgraph ExternalEcosystem ["External AI & Microservices"]
        OpenRouter["OpenRouter API\n(Claude 3.5, GPT-4o, Gemini 2.0)"]
        ServiceRide["Ride Microservice (:4001)\n[MCP Server]"]
        ServiceFood["Food Microservice (:4002)\n[MCP Server]"]
        ServiceWallet["Wallet Microservice (:4003)\n[MCP Server]"]
    end

    AgentDataPlane --> OpenRouter
    AgentDataPlane --> ServiceRide
    AgentDataPlane --> ServiceFood
    AgentDataPlane --> ServiceWallet
```

---

### Core Roles of `agentgateway.dev` in SuperApp

#### 1. North-South Ingress Data Plane
- **Edge Authentication**: Validates incoming user tokens (JWT, OAuth) and verifies user identity before requests reach the Node.js application layer.
- **Rate-Limiting via Common Expression Language (CEL)**: Limits requests based on user tier, IP, or session token to protect backend compute and LLM token budgets.
- **Unified Observability**: Injects OpenTelemetry trace contexts (`traceparent`), correlating incoming user intents with downstream LLM calls and tool executions.

#### 2. Model Inference Proxy & Cost Control
- Proxies all inference calls destined for **OpenRouter** (`https://openrouter.ai/api/v1`).
- Enforces per-user and per-mini-app token budgets and spending caps.
- Configures automated failover policies (e.g., if primary Claude 3.5 Sonnet encounters an upstream 503 or latency spike, automatically route to Gemini 2.0 Flash or GPT-4o).

#### 3. Native Model Context Protocol (MCP) Tool Federation
- Each domain microservice (`service-ride`, `service-food`, `service-wallet`) exposes an MCP endpoint (`/mcp`).
- `agentgateway.dev` automatically discovers, federates, and authorizes available tools:
  - `ride_searchDrivers`, `ride_bookCab`
  - `food_getRestaurants`, `food_createOrder`
  - `wallet_checkBalance`, `wallet_authorizePayment`
- LangGraph connects to `agentgateway.dev` as a unified MCP client, eliminating the need to write custom OpenAPI-to-LangChain glue code for every new microservice.

#### 4. Agent-to-Agent (A2A) Governance
- Governs cross-subagent communication policies (e.g. ensuring the Ride Subagent cannot directly mutate the Wallet balance without the Supervisor's approval and explicit user confirmation).

## Consequences

### Positive
- **Rust-Grade Performance**: Ultra-low latency proxying and high-concurrency connection handling at the edge.
- **Industry-Standard Protocols**: Adopts Anthropic's **MCP (Model Context Protocol)** across all domain microservices.
- **Centralized AI Governance**: Token rate-limiting, model fallbacks, and cost control are managed in configuration rather than scattered across backend code.
- **Simpler Agent Code**: LangGraph code focuses purely on reasoning graphs and AG-UI state reduction; tool discovery and network resiliency are offloaded to `agentgateway.dev`.

### Negative / Trade-offs
- Adds an additional container component in `docker-compose.yml`.
- Requires maintaining `agentgateway.yaml` configuration alongside microservice definitions.
