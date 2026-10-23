# SuperApp Agent Backlog & Implementation Tracker

> **Tracking progress for the next-generation agentic SuperApp platform with AG-UI / A2-UI protocols, polyglot frontends (React / Angular / Flutter), and microservice-driven mini-apps.**

---

## 📊 High-Level Status Dashboard

| Phase | Description | Status | Progress |
|:---|:---|:---:|:---:|
| **Phase 1** | Architecture, Protocols & Schemas (`protocol-core`, `ui-tokens`) | ✅ Completed | 100% |
| **Phase 2** | Backend Microservices Cluster (`ride`, `food`, `wallet`, `catalog`) | ✅ Completed | 100% |
| **Phase 3** | Backend Agent Gateway & Cognitive Platform (`agent-gateway`) | ✅ Completed | 100% |
| **Phase 4** | Multi-Flavor Frontend Host Shells (`react`, `angular`, `flutter`) | ✅ Completed | 100% |
| **Phase 5** | Federated Mini-Apps / Microfrontends (`miniapp-*`) | ✅ Completed | 100% |
| **Phase 6** | Composite Agent Workflows & Cross-Domain Orchestration | ✅ Completed | 100% |
| **Phase 7** | Verification, Automated Testing & Documentation Polish | ✅ Completed | 100% |
| **Phase 8** | User Profile, UI Personalization & Keycloak Auth Security | ✅ Completed | 100% |
| **Phase 9** | Smart City Transformation (DubaiNow & TAMM Integration) | ✅ Completed | 100% |

---

## 🗂️ Detailed Backlog

### Phase 1: Architecture, Protocols & Schemas

- [x] **1.1 Architectural Decisions & Specifications**
  - [x] Draft ADR-0001 (SuperApp and Mini-App Ecosystem)
  - [x] Draft ADR-0002 (AG-UI and A2-UI Declarative Protocols)
  - [x] Draft ADR-0003 (Backend Agent Microservices Architecture)
  - [x] Draft ADR-0004 (Microfrontend and Mini-App Runtime Strategy)
  - [x] Draft ADR-0005 (Multi-Flavor Frontend Adapters: React, Angular, Flutter)
  - [x] Draft ADR-0006 (State Management, Security, and Event Bus)
  - [x] Draft ADR-0007 (LangGraph Agentic Platform & OpenRouter Gateway)
  - [x] Draft ADR-0008 (Adoption of agentgateway.dev Edge Data Plane)
- [x] **1.2 `@superapp/protocol-core` Protocol Package**
  - [x] Define AG-UI Component Types schema (`SurfaceCard`, `Heading`, `Text`, `Badge`, `ChoiceGroup`, `Button`, `FormInput`, `MetricWidget`, `MapViewer`, `DataTable`, `MiniAppEmbed`)
  - [x] Define A2-UI message types (`HANDSHAKE`, `STREAM_DELTA`, `RENDER_SURFACE`, `EVENT_TRIGGER`, `LAUNCH_MINIAPP`)
  - [x] Add strict validation helpers and schema unit tests for all AG-UI primitives
  - [x] Support PATCH and APPEND surface update modes in schema definitions
- [x] **1.3 `@superapp/ui-tokens` Design Token Library**
  - [x] Core design tokens in JSON (`colors`, `spacing`, `radii`, `breakpoints`)
  - [x] Base CSS variables theme sheet
  - [x] Typography scale, responsive layout tokens, and dark mode variant tokens

---

### Phase 2: Domain Microservices Cluster

- [x] **2.1 Mobility & Ride Service (`service-ride` :4001)**
  - [x] Basic Fastify/Node service scaffold and healthcheck
  - [x] REST endpoints: `/rides/options`, `/rides/book`
  - [x] Basic MCP tool definitions (`ride_getOptions`, `ride_bookCab`, `ride_trackStatus`)
  - [x] Add ride simulation state machine (Requested -> Dispatched -> In Transit -> Completed)
  - [x] Add live driver telemetry tracking endpoint (`/rides/track/:id`)
  - [x] Add unit and endpoint tests
- [x] **2.2 Food & Dining Service (`service-food` :4002)**
  - [x] Basic Fastify/Node service scaffold and healthcheck
  - [x] REST endpoints: `/restaurants/search`, `/orders/create`
  - [x] Basic MCP tool definitions (`food_searchRestaurants`, `food_createOrder`, `food_trackOrder`)
  - [x] Expand restaurant catalog with categorized menus, dietary tags, and pricing
  - [x] Add order tracking state machine (Received -> Kitchen -> Out for Delivery -> Delivered)
  - [x] Add unit and endpoint tests
- [x] **2.3 Payments & Wallet Service (`service-wallet` :4003)**
  - [x] Basic Fastify/Node service scaffold and healthcheck
  - [x] REST endpoints: `/wallet/balance`, `/wallet/pay`
  - [x] Basic MCP tool definitions (`wallet_getBalance`, `wallet_authorizePayment`, `wallet_getTransactions`)
  - [x] Add ledger transaction history endpoint (`/wallet/transactions`)
  - [x] Add funds top-up endpoint (`/wallet/topup`) with idempotency check
  - [x] Add unit and endpoint tests
- [x] **2.4 Mini-App Registry & Catalog Service (`service-catalog` :4004)**
  - [x] Fastify/Node service scaffold and healthcheck
  - [x] Mini-app manifest list endpoint (`/miniapps`)
  - [x] Add dynamic tool catalog endpoint for Agent Gateway tool registration (`/tools`)
  - [x] Add mini-app permission and configuration endpoint

---

### Phase 3: Backend Agent Gateway & Cognitive Platform

- [x] **3.1 A2-UI Protocol Broker (`services/agent-gateway` :4000)**
  - [x] Fastify/Node server scaffold with CORS and healthcheck
  - [x] SSE streaming endpoint (`/api/a2ui/stream`)
  - [x] Intent ingestion endpoint (`/api/a2ui/intent`)
  - [x] Interactive action trigger endpoint (`/api/a2ui/action`)
  - [x] In-memory session checkpointer and subscriber registry
- [x] **3.2 LangGraph Multi-Agent Platform**
  - [x] Intent evaluation and supervisor domain routing
  - [x] Dynamic AG-UI generator for single-domain and composite workflows
  - [x] Microservice tool bindings (direct tool execution across ride, food, wallet, and catalog)
  - [x] Human-In-The-Loop (HITL) interrupt handling for user confirmation steps
  - [x] Contextual AG-UI surface reducer translating multi-tool results into rich UI trees
- [x] **3.3 Model Inference Gateway (OpenRouter Client)**
  - [x] OpenRouter fetch wrapper with fallback simulator mode
  - [x] Dynamic model switching configuration (`claude-3.5-sonnet`, `gemini-2.0-flash`, `gpt-4o`)
  - [x] Robust JSON schema verification for AG-UI surfaces
- [x] **3.4 Edge Proxy Integration (`services/agentgateway`)**
  - [x] Declarative config file (`config.yaml`) for LLM proxy, budget, and MCP tools
- [x] **3.5 Service Disambiguation & Renaming (`agent-gateway` → `agent-core` / `super-app-agent`)**
  - [x] Rename `services/agent-gateway` directory to `services/agent-core` to resolve naming clash with `agentgateway` (agentgateway.dev Rust data plane)
  - [x] Update `docker-compose.yml` service and container names (`agent-gateway` → `agent-core`, `container_name: superapp-agent-core`)
  - [x] Update package name `@superapp/agent-gateway` → `@superapp/agent-core` in `package.json` and monorepo workspace references
  - [x] Update environment variables (e.g. `PORT_GATEWAY` / `PORT_AGENT_CORE`), frontend proxies, and Dockerfile paths
  - [x] Align architecture documentation, diagrams, and ADRs (ADR-0003, ADR-0007, ADR-0008, system overview)

---

### Phase 4: Multi-Flavor Frontend Host Shells

- [x] **4.1 React 18 Host Shell (`apps/shell-react` :3000)**
  - [x] Vite + React 18 scaffold with responsive split-screen layout
  - [x] SSE stream subscription with live reasoning delta display
  - [x] Complete `A2UIRenderer` for `SurfaceCard`, `Heading`, `Text`, `ChoiceGroup`, `MetricWidget`, `Button`, `MapViewer`, `DataTable`, `Badge`, `FormInput`, `MiniAppEmbed`
  - [x] Mobile-first responsive optimizations (bottom sheet drawer, compact concierge dock)
  - [x] Tab switching between Conversational Concierge and Direct Mini-App views
  - [x] Quick prompt suggestion chips and audio transcription simulator
- [x] **4.2 Angular 18 Host Shell (`apps/shell-angular` :3001)**
  - [x] Angular 18 standalone component shell with Signals
  - [x] SSE connection and intent dispatching
  - [x] Native AG-UI dynamic component renderer in Angular
  - [x] Responsive split-pane layout matching React shell features
  - [x] Action dispatch loop and suggestion chips
- [x] **4.3 Flutter Host Shell (`apps/shell-flutter` :3002)**
  - [x] Flutter cross-platform mobile & desktop scaffold
  - [x] Material 3 dual-pane responsive layout and HTTP intent dispatch
  - [x] Complete Flutter AG-UI Widget Factory for dynamic component rendering
  - [x] Live SSE / HTTP streaming listener with real-time thought display
  - [x] Interactive action dispatcher and suggestion chips

---

### Phase 5: Federated Mini-Apps (Microfrontends)

- [x] **5.1 Ride Mini-App (`mini-apps/miniapp-ride`)**
  - [x] Manifest definition and basic mount/unmount lifecycle
  - [x] Interactive route and pickup/dropoff selector
  - [x] Vehicle tier choice cards with fare calculation
  - [x] Live driver tracking simulation with map interface
  - [x] Event dispatch bridge back to host shell
- [x] **5.2 Food Mini-App (`mini-apps/miniapp-food`)**
  - [x] Manifest definition and basic mount/unmount lifecycle
  - [x] Restaurant browsing and search
  - [x] Menu items selection and cart management
  - [x] Checkout flow and live order status tracker
  - [x] Event dispatch bridge back to host shell
- [x] **5.3 Wallet Mini-App (`mini-apps/miniapp-wallet`)**
  - [x] Manifest definition and basic mount/unmount lifecycle
  - [x] Digital Platinum card preview and balance display
  - [x] Quick top-up action buttons (+$20, +$50, +$100)
  - [x] Recent transactions ledger list
  - [x] Event dispatch bridge back to host shell

---

### Phase 6: Composite Workflows & Orchestration

- [x] **6.1 Multi-Service Composite Journeys**
  - [x] "Book ride + Order food" composite workflow:
    - User asks: *"Book a cab to Downtown Restaurant and order pizza for delivery there"*
    - Agent parallelizes / sequences tool calls across `service-ride` and `service-food`
    - Returns composite AG-UI surface with two tabs/cards
  - [x] "Pay with Wallet" integrated checkout:
    - HITL card prompts user to confirm total amount
    - Upon click, agent invokes `service-wallet` to deduct balance and issues confirmation
- [x] **6.2 Error Handling & Resilience**
  - [x] Graceful fallback when microservices or LLM gateway are offline
  - [x] Validation error reporting via `A2UI_CLIENT_ERROR`
  - [x] Client reconnection handling for SSE stream drops

---

### Phase 7: Verification, Automated Testing & Polish

- [x] **7.1 Monorepo Build & Dependency Management**
  - [x] Ensure scripts for building, testing, and running backend and frontends work seamlessly
  - [x] Add unified local development runner script (`scripts/dev-backend.ts`)
- [x] **7.2 End-to-End Automated Test Suite & Multi-Service Verification**
  - [x] Protocol validation test suite in `packages/protocol-core` (6 tests)
  - [x] API integration tests across all 4 microservices in `services/test/microservices.test.ts` (4 tests)
  - [x] Agent Core cognitive engine test suite in `services/test/agent-core.test.ts` (7 tests)
  - [x] End-to-end composite user journey runner in `test/e2e-workflow.test.ts` (1 test)
  - [x] Full-coverage realistic E2E life scenarios in `test/e2e-life-scenarios.test.ts` (7 tests):
    - [x] Scenario 1: Commuter Morning Rush (Ride Hailing & Real-Time Telemetry Tracking)
    - [x] Scenario 2: Evening Dinner Delivery (Food Discovery & Kitchen Prep)
    - [x] Scenario 3: Zero-Trust Wallet Management (Balance, Ledger & Fast Top-Up)
    - [x] Scenario 4: Composite Multi-Agent Orchestration (Ride + Food + Wallet HITL Checkout)
    - [x] Scenario 5: Concierge Ecosystem & Mini-App Catalog Exploration
    - [x] Scenario 6: Financial Guardrail (Insufficient Balance Protection)
    - [x] Scenario 7: A2-UI Protocol Validation & Rejection Guardrails
  - [x] Life scenarios flight recorder (`scripts/record-e2e-scenarios.ts` / `npm run test:record`)
  - [x] Comprehensive execution recording transcript in `docs/reports/E2E_LIFE_SCENARIOS_RECORDING.md`
  - [x] Monorepo single-command automated test runner (`npm test`: **25 tests passing in <180ms**)
- [x] **7.3 Documentation & Demo Guide**
  - [x] Comprehensive architecture and ADR documentation
  - [x] Step-by-step setup and quick-start instructions in README.md

---

### Phase 8: User Profile, UI Personalization & Keycloak Auth Security

- [x] **8.1 Service Disambiguation & Docker Compose Finalization**
  - [x] Verify `docker-compose.yml` uses `agent-core` exclusively (`superapp-agent-core`, `services/agent-core/Dockerfile`)
  - [x] Add `service-profile` (:4005) and `keycloak` (:8085) container definitions to `docker-compose.yml`
  - [x] Update `.env.example` with `PORT_AGENT_CORE`, `PORT_SERVICE_PROFILE`, and Keycloak OIDC environment variables
  - [x] Federate `service-profile` MCP tools in `services/agentgateway/config.yaml`
- [x] **8.2 User Profile & Preferences Microservice (`services/service-profile` :4005)**
  - [x] Fastify/Node service scaffold with healthcheck (`/health`)
  - [x] Profile metadata endpoint (`GET /profile`) with VIP loyalty tier, name, avatar
  - [x] Preferences endpoint (`GET /profile/preferences`, `POST /profile/preferences`) for dietary (Vegetarian/Spicy), mobility (EV/Comfort), and UI theme
  - [x] Dynamic LLM prompt context endpoint (`GET /profile/prompt-context`)
  - [x] MCP tool declarations (`profile_getProfile`, `profile_getPreferences`, `profile_updatePreferences`, `profile_getPromptContext`)
  - [x] Unit and endpoint tests for `service-profile`
- [x] **8.3 UI Personalization & Adaptive A2-UI Generation**
  - [x] Inject user profile context into `SuperAppAgentGraph` supervisor reasoning
  - [x] Personalize Ride AG-UI card (pre-select preferred vehicle tier e.g. Tesla EV / Comfort Sedan)
  - [x] Personalize Food AG-UI card (pre-filter and highlight dishes matching user dietary preferences with badge)
  - [x] Personalize Wallet AG-UI card (display user's Gold VIP loyalty badge and custom benefits)
  - [x] Interactive preference update loop (`update_preferences`) allowing runtime UI adaptation
- [x] **8.4 Keycloak Auth Server & OIDC Security Flow**
  - [x] Keycloak 24 container configuration with pre-imported `superapp` realm and client
  - [x] Keycloak realm export definition (`services/keycloak/realm-export.json`) with demo user (`bassem`) and roles (`superapp-user`, `superapp-vip`)
  - [x] JWT / OIDC token authentication middleware in `agent-core` (`services/agent-core/src/auth.ts`) validating Bearer tokens
  - [x] Update frontend host shells (React, Angular, Flutter) with authenticated user profile chip and token propagation
- [x] **8.5 E2E Personalization & Security Life Scenario Verification**
  - [x] Add E2E Life Scenario 8: User Profile Personalization & Adaptive UI
  - [x] Add E2E Life Scenario 9: Keycloak OIDC Token Authentication & Security Rejection
  - [x] Update `scripts/dev-backend.ts` to boot `service-profile` alongside other microservices
  - [x] Re-run all automated tests and flight recorder (`npm test` & `npm run test:record`)

---

### Phase 9: Smart City Platform Transformation (DubaiNow & TAMM Integration)

- [x] **9.1 Architectural & Domain Specification (DubaiNow & TAMM Reference)**
  - [x] Transform generic consumer services into authentic Smart City pillars: Smart Mobility (RTA/Mawaqif/Salik), Smart Utilities (DEWA/ADDC), Citizen Payments & Police Fines (DubaiPay/TAMM Pay & Dubai Police), and Housing & Tenancy (Ejari/Tawtheeq)
  - [x] Update ADR-0001 and ADR-0003 with Smart City Civic Services specifications
  - [x] Update MCP tool definitions in `services/agentgateway/config.yaml` for smart city tools
- [x] **9.2 Smart Mobility Microservice (`service-mobility` / `service-ride` :4001)**
  - [x] Smart Parking management (RTA Dubai & Mawaqif Abu Dhabi): zone discovery (Zone 302A Downtown, Zone 101B Business Bay), tariff calculation, meter activation (`/mobility/parking/activate`), live meter countdown, and extension (`/mobility/parking/extend`)
  - [x] Road toll system (Salik / Darb): balance check (`/mobility/salik/balance`), recent toll gate trips (`/mobility/salik/passings` Al Safa, Al Barsha), and instant auto-recharge (`/mobility/salik/recharge`)
  - [x] EV Green Charger network: GPS coordinates finder for DEWA EV chargers (`/mobility/ev/chargers`), plug availability (Type 2, 50kW DC Fast), and charging session initiation (`/mobility/ev/start`)
- [x] **9.3 Smart Utilities Microservice (`service-utilities` / `service-food` :4002)**
  - [x] Electricity and water smart premise telemetry (DEWA / ADDC): consumption breakdown in kWh and imperial gallons (`/utilities/consumption`)
  - [x] Monthly utility bill calculation with housing municipality fee and sewerage (`/utilities/bill`)
  - [x] Bill settlement endpoint with green energy credit allocation (`/utilities/pay`)
  - [x] Green Living Eco-Advice advisor calculating rooftop solar credits and off-peak savings (`/utilities/eco-advice`)
- [x] **9.4 Citizen Pay & Government Wallet (`service-citizenpay` / `service-wallet` :4003)**
  - [x] Smart City digital citizen wallet (DubaiPay / TAMM Pay) stored-value ledger & instant top-up
  - [x] Dubai Police & Abu Dhabi Police traffic fine management: radar speeding & parking overstay query (`/fines/check`) and instant settlement with early discount (`/fines/pay`)
  - [x] Unified multi-agency settlement checkout with cryptographic transaction receipt (`/pay/unified`)
- [x] **9.5 UAE PASS Digital Identity & Housing (`service-profile` :4005 & `service-catalog` :4004)**
  - [x] UAE PASS citizen profile model: Emirates ID (`784-1988-1234567-1`), Golden Visa residency status, registered vehicle plates (`Dubai B-74892` Tesla Model Y EV), registered premises (`DEWA 201948201`, Ejari `EJR-2026-948102`)
  - [x] Ejari / Tawtheeq tenancy contract verification and renewal simulation
  - [x] Dynamic LLM prompt context generator tailored for the autonomous Smart City Citizen Concierge
- [x] **9.6 Cognitive Smart City Orchestrator (`agent-core` :4000)**
  - [x] Smart city intent classifier: Parking, Salik, DEWA, Police Fines, Ejari Tenancy, Civic Incidents
  - [x] Composite Multi-Agency Life Journeys:
    - *Journey 1: Monthly Civic Living Reconciliation (DEWA utility bill + Dubai Police fine + DubaiPay unified checkout)*
    - *Journey 2: Moving-In Golden Path (Ejari contract validation + DEWA smart meter activation + RTA residential parking)*
    - *Journey 3: Smart Commute & Green EV Session (Salik balance check + EV charger reservation + Zone 302A parking)*
    - *Journey 4: Civic Incident Reporting (Street defect / leak reporting with MapViewer coordinates and municipality ticket dispatch)*
  - [x] AG-UI Surface builders for Parking Meters with live countdown, DEWA consumption widgets, fine data tables, and UAE PASS Golden Visa badges
- [x] **9.7 Polyglot Smart City Frontends (React, Angular, Flutter)**
  - [x] Transform frontend shells into **SmartCity Now • Unified Citizen Agent** (DubaiNow / TAMM aesthetic)
  - [x] Display verified UAE PASS digital citizen badge (`🛡️ UAE PASS • Bassem Zohdy • 🌟 Golden Visa`) in headers
  - [x] Smart City suggestion chips, active parking meter countdown badges, and microfrontend tabs (`MOBILITY`, `UTILITIES`, `CITIZEN PAY`)
- [x] **9.8 Verification, Automated Testing & Flight Recording**
  - [x] Update unit tests for Smart City microservices (`npm test`)
  - [x] Update realistic Smart City E2E life scenarios in `test/e2e-life-scenarios.test.ts`
  - [x] Execute flight recorder and generate `docs/reports/E2E_LIFE_SCENARIOS_RECORDING.md`
  - [x] Record fresh HD screen recording video (`docs/recordings/videos/superapp-e2e-scenarios.webm`) with Playwright & Google Chrome
  - [x] Commit and push all changes to GitHub

---

## Phase 10 — Production readiness (OPEN; do not confuse demo completion with release readiness)

The preceding phases track the **demo acceptance scope only**. The following items are pending before production:

- [x] Reject forged/demo JWTs by default; validate Keycloak RS256 signatures, issuer, audience and expiry
- [x] Scope sessions to authenticated users; reject actions not represented on current surface
- [x] Add local-only demo opt-in, multi-listener SSE, UI payload limits, and restricted CORS / local ports
- [x] Default optional OpenRouter preview to free inference and block paid models without explicit opt-in
- [x] Add regression test coverage for authentication, access controls and model spend policy (**execution pending**)
- [ ] Real OIDC/PKCE frontend login (React, Angular, Flutter) and authenticated production SSE
- [ ] Real domain-level authorization, consent, delegated identity, and tenant isolation
- [ ] Durable session/checkpoint state, event replay, retries and distributed idempotency
- [ ] Atomic/composable multi-agency settlement with compensation, audit and authorization proof
- [ ] Actual LangGraph agent orchestration instead of keyword routing; model output currently unused
- [ ] Official AG-UI + A2UI adapters and cross-platform renderer parity tests
- [ ] Container/version pinning, security scanning, Keycloak integration, production load testing
- [ ] Run full `npm test`, `npm run build`, and real Keycloak end-to-end tests before merge

See [SECURITY.md](SECURITY.md).
