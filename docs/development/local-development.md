# Local development

**Applies to the demonstration repository as of 23 October 2026.** Commands are taken from the checked-in scripts. This documentation update is not a fresh successful execution of all toolchains.

## Prerequisites

- Node.js **22 or later**, with `--experimental-strip-types` and `--env-file-if-exists` support; npm.
- Docker with Compose only for container-mode testing. Flutter SDK and Chrome for `dev:flutter`.
- No model API key is needed for the deterministic demo/test suite.

```bash
cp .env.example .env
# Set DEMO_AUTH=true in the ignored .env for local demo only
npm install
npm test
```

### In-process backend (fastest setup)

```bash
npm run dev:backend
```

This script loads `.env` if present, imports and starts the simulated HTTP handlers at `4001`–`4005` and the agent-core server at `4000` in one process. It does **not** start Keycloak or agentgateway. Domain calls from `SuperAppAgentGraph` are direct TypeScript imports, not requests through a network gateway.

```bash
curl http://localhost:4000/health
```

```bash
curl -X POST http://localhost:4000/api/a2ui/intent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer demo-local' \
  -d '{"sessionId":"sess_example_001","text":"Show my wallet balance"}'
```

The POST works only if `DEMO_AUTH=true` and `NODE_ENV` is not `production`.

### Frontend

```bash
npm run dev:react
# http://localhost:3000
```

The React shell sends the local demo marker and subscribes with `?demo=1` to the custom SSE endpoint. For Angular, use `npm run dev:angular` (requires its full Angular CLI workspace config; validate before use); for Flutter, `npm run dev:flutter` (Flutter SDK/browser needed). All three are *example* shells, not a verified production release matrix.

### Compose mode

```bash
docker compose config
docker compose up --build
```

Compose defines agent-core, five domain services, Keycloak, agentgateway and the React frontend. Backend host ports are mapped to `127.0.0.1` by default. Note the Compose Keycloak container has an **insecure dev realm/import and default admin credentials**; never expose this stack externally. Gateway image is tagged `latest` and config compatibility is not established; if that container fails, use in-process backend to test the demo behavior. Compose does **not** dynamically convert the direct-in-process agent calls to authenticated remote service calls.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_AUTH` | `false` | Opt-in mock identity in nonproduction Node only |
| `KEYCLOAK_ISSUER` | local realm URL | Exact `iss` accepted for signed JWTs |
| `KEYCLOAK_AUDIENCE` | `agent-core` | Required token audience |
| `KEYCLOAK_JWKS_URL` | local Keycloak certs URL | Signing keys endpoint; HTTPS enforced in production |
| `CORS_ORIGINS` | three localhost shells | Comma-separated origin allowlist for agent-core |
| `OPENROUTER_API_KEY` | empty | Optional; keep in local ignored file |
| `OPENROUTER_MODEL` | `openrouter/free` | Free router or currently available `:free` model |
| `ENABLE_LIVE_LLM` | `false` | Enable informational preview call; **not live planning** |
| `OPENROUTER_ALLOW_PAID_MODELS` | `false` | Prevent paid inference unless explicitly enabled |
| `OPENROUTER_BASE_URL` | OpenRouter API | Inference API endpoint |
| `PORT_AGENT_CORE` | 4000 | Compose exposed port; runner hardcodes 4000 |
| `PORT_SERVICE_*` | 4001–4005 | Compose ports for simulators |

The `LANGCHAIN_*` placeholders in the sample env file do not imply the LangGraph/LangSmith SDK is integrated. `BACKEND_RUNTIME_MODE` is a config hint rather than evidence of automatically switching execution engines.

### Optional inference cost policy

1. Create an OpenRouter key privately (no key needed for the tests).
2. Put it in `.env`; do not commit it.
3. Use `OPENROUTER_MODEL=openrouter/free`. For reproducible behavior select a currently listed `:free` model only after verifying availability at https://openrouter.ai/models?pricing=free.
4. Set `ENABLE_LIVE_LLM=true` to permit the preview call.
5. Never enable `OPENROUTER_ALLOW_PAID_MODELS=true` unless you deliberately want paid API traffic.

The model response is currently ignored by journey routing. Free models may rate-limit or disappear; the deterministic demo still works when the call fails.

### Troubleshooting

- **401 on intent/action:** `DEMO_AUTH` is disabled, or token is invalid; production mode never accepts `demo-local`.
- **403 on action:** create a session with an intent and click only an action actually offered on its current surface. Cross-user sessions also return 403.
- **409 on repeated click:** process-local duplicate-action protection; a second execution is blocked for that surface/action pair.
- **SSE 401:** `?demo=1` is only for local demo; real auth needs an authenticated streaming client.
- **LLM unavailable:** remove key or disable preview; mock journeys do not require inference.
- **Ports occupied:** close the other runner/Compose stack or adjust deployment consistently; the in-process script uses fixed ports.
- **Flutter / Angular not launching:** install the missing SDK/toolchain and validate project scaffolding; these are not CI-proven by the documentation update.
