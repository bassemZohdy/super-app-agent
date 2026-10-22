# ADR-0007: Agentic Platform Architecture — LangGraph Cognitive Orchestration with OpenRouter Model Gateway

## Status
Accepted

## Context
In an agentic SuperApp, a common misconception is equating the model provider (OpenRouter) with the agent itself. 
- **OpenRouter** is an **LLM API Gateway / Inference Provider** supplying System-1 / raw model completions (e.g., Anthropic Claude 3.5 Sonnet, OpenAI GPT-4o, Google Gemini, DeepSeek, Meta Llama). It does **not** maintain agentic state, memory persistence, cyclic multi-agent graphs, or human-in-the-loop coordination.
- **AgentCore** requires a dedicated **Agentic Platform & Cognitive Engine**. It must manage multi-turn state graphs, conditional routing, supervisor-subagent delegation (orchestrating Mobility, Food, and Payment domains), error recovery, and AG-UI / A2-UI UI state emission.

We need an explicit architectural standard for the agent platform that decouples **cognitive workflow orchestration** from **model inference**.

## Decision

We adopt **LangGraph (LangChain ecosystem)** as the **Agentic Orchestration Platform**, with **OpenRouter** serving strictly as the **Model Inference Gateway**:

```mermaid
flowchart TD
    Client["Frontend Clients\n(React / Angular / Flutter)"] <-->|A2-UI Protocol (SSE / WebSocket)| AgentGateway["Agent Ingress Gateway (:4000)"]

    subgraph AgentCore ["AgentCore: LangGraph Multi-Agent Platform"]
        Supervisor["SuperApp Concierge Supervisor\n(LangGraph StateGraph Root)"]
        Checkpointer["State Checkpointer & Session Memory\n(MemorySaver / Redis)"]
        
        subgraph SubAgents ["Specialized Domain Worker Agents"]
            RideAgent["Ride & Mobility Agent"]
            FoodAgent["Food & Dining Agent"]
            WalletAgent["Wallet & Payments Agent"]
        end

        Supervisor <--> Checkpointer
        Supervisor -->|Conditional Route| RideAgent
        Supervisor -->|Conditional Route| FoodAgent
        Supervisor -->|Conditional Route| WalletAgent

        AGUIReducer["AG-UI & A2-UI State Reducer / Emitter Node"]
        RideAgent --> AGUIReducer
        FoodAgent --> AGUIReducer
        WalletAgent --> AGUIReducer
    end

    AgentGateway <--> AgentCore

    subgraph LLMGateway ["Model Inference Gateway"]
        OpenRouter["OpenRouter API\n(Claude 3.5, GPT-4o, Gemini 2.0)"]
    end

    AgentCore <-->|OpenAI-Compatible Chat API| OpenRouter

    subgraph DomainMicroservices ["Domain Microservices"]
        ServiceRide["Ride Microservice (:4001)"]
        ServiceFood["Food Microservice (:4002)"]
        ServiceWallet["Wallet Microservice (:4003)"]
        ServiceCatalog["Catalog Microservice (:4004)"]
    end

    RideAgent -->|LangChain Dynamic Tools| ServiceRide
    FoodAgent -->|LangChain Dynamic Tools| ServiceFood
    WalletAgent -->|LangChain Dynamic Tools| ServiceWallet
    Supervisor -->|Mini-App Manifest Lookup| ServiceCatalog
    AGUIReducer -->|Emit A2UI_RENDER_SURFACE / DELTA| AgentGateway
```

---

### 1. Architectural Separation of Concerns

| Concern | Layer | Responsibility |
|---------|-------|----------------|
| **Model Inference** | **OpenRouter API** | Provides access to raw foundational LLMs via standard API; handles model switching, fallback providers, and token pricing. |
| **Cognitive Framework** | **LangGraph / LangChain** | Implements the state machine, agent decision graphs, cycles, supervisor-subagent task routing, and tool binding. |
| **Session Persistence** | **LangGraph Checkpointer** | Stores conversational threads, intermediate reasoning nodes, and state snapshots across user interactions. |
| **Tool Execution** | **LangChain Structured Tools** | Interfaces with domain microservices via REST/OpenAPI contracts. |
| **UI Synthesis** | **AG-UI Reducer Node** | Transforms agent outputs and tool results into valid AG-UI component JSON trees. |
| **Client Transport** | **Agent Gateway (Fastify)** | Streams A2-UI protocol packets over SSE/WebSocket to React, Angular, and Flutter hosts. |

---

### 2. LangGraph StateGraph Design

The SuperApp uses a hierarchical **Supervisor-Worker Graph**:

1. **State Definition (`SuperAppAgentState`)**:
   - `messages`: List of `BaseMessage` (User, AI, Tool messages).
   - `activeDomain`: `'ride' | 'food' | 'wallet' | 'composite' | 'general'`.
   - `currentSurface`: `AGUISurfacePayload` (The currently active AG-UI schema).
   - `miniAppContext`: Scoped variables for active mini-apps.
   - `actionQueue`: Pending A2-UI client interactions.

2. **Graph Nodes**:
   - **`concierge_router`**: Evaluates user intent and routes to the appropriate domain agent or orchestrates composite requests (e.g. food + ride).
   - **`ride_worker`**: Specialized agent with tools for ride quotation, driver search, and booking.
   - **`food_worker`**: Specialized agent with tools for menu browsing, dish filtering, and order creation.
   - **`wallet_worker`**: Specialized agent with tools for balance inquiry, checkout authorization, and payment receipts.
   - **`agui_compiler_node`**: Formulates or patches the AG-UI JSON payload conforming to ADR-0002.
   - **`stream_emitter_node`**: Pushes A2-UI events (`A2UI_STREAM_DELTA`, `A2UI_RENDER_SURFACE`) over the active SSE stream.

---

### 3. OpenRouter Model Integration with LangGraph

LangGraph connects to OpenRouter using standard LangChain model abstractions (e.g., `@langchain/openai` or `langchain-openai` in Python/TypeScript):

```typescript
import { ChatOpenAI } from "@langchain/openai";

export function createOpenRouterModel(modelName = "anthropic/claude-3.5-sonnet") {
  return new ChatOpenAI({
    modelName: modelName,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://superapp-agent.internal",
        "X-Title": "SuperApp Agent Platform",
      },
    },
    temperature: 0.2,
    streaming: true,
  });
}
```

---

### 4. Human-In-The-Loop & Interactive Action Loop

LangGraph natively supports **Interrupts** (`interrupt()` / checkpoints):
1. When an AG-UI card requires explicit user confirmation (e.g., payment approval in the Wallet mini-app or ride booking confirmation), the graph halts at a breakpoint.
2. The Agent Gateway emits `A2UI_RENDER_SURFACE` containing interactive buttons.
3. When the user taps "Confirm Ride" in React, Angular, or Flutter, the frontend dispatches `A2UI_EVENT_TRIGGER`.
4. The Agent Gateway resumes the LangGraph thread from its saved checkpoint with the user's action payload.

## Consequences

### Positive
- **Clear Decoupling**: Upgrading from Claude 3.5 to GPT-4o or an on-premise model requires only changing the OpenRouter model name string; the agentic logic, tools, and graphs in LangGraph remain untouched.
- **Deterministic Multi-Step Workflows**: LangGraph graphs prevent open-ended hallucinations and enforce strict business flow transitions.
- **Built-in Resiliency & Replay**: Checkpointers allow rewinding conversation state or resuming interrupted checkouts across devices.

### Negative / Trade-offs
- Introduces LangGraph graph definitions and state reducer logic into `services/agent-gateway`.
- Requires maintaining typed state definitions across nodes in the agent graph.
