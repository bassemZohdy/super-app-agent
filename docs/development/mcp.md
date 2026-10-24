# Demo MCP transport

The concierge exposes authenticated Streamable HTTP at `http://localhost:4000/mcp` using `@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/node` 2.1.2. It supports initialization, `tools/list` and `tools/call` through the official SDK. The independent reference client is pinned to 2.4.0. [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).

Send an end-user **access token** in the Authorization header. Integrated mode verifies it through the same shared JWT/introspection path as the HTTP API. Host/origin checks and a 64 KiB request limit apply. Tools run per request; no MCP session identity replaces the user's session/account ownership.

| Tool | Behavior |
| --- | --- |
| cityside_accounts | Discover the user's accounts |
| cityside_capabilities | Read capability metadata |
| cityside_intent | Prepare a reviewed proposal with the usual core intent path |
| cityside_confirm_action | Execute only the current approved surface action, revision and exact payload |
| cityside_conversations | List the user's saved conversations |
| cityside_delegations | Inspect explicitly consented grants; cannot create or expand consent |
| cityside_execute_delegation | Execute only an existing grant with a stable request key and current provider-side authority |
| cityside_revoke_delegation | Withdraw an owned grant; completed effects are not undone |

Delegation tools use the same isolated broker and [grant contract](delegation.md) as the shell. They do not supply an arbitrary user subject, actor chain or consent override. Core verifies the human MCP caller; unattended runner execution uses the broker's distinct service-client lane. Neither path receives issuer keys or delegated access tokens.

Example with the installed reference client:

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({ name: 'demo-client', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:4000/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
}));
try {
  const result = await client.callTool({ name: 'cityside_accounts', arguments: {} });
  // Check result.isError before using structuredContent.
} finally { await client.close(); }
```

`accessToken` is supplied privately by the caller's identity flow. Never paste tokens into documentation, command lines or URLs. `services/test/mcp.test.ts` checks reference-client initialization, discovery, calls, missing authentication, hostile origins, tampering and replay. `npm run demo:verify:manual` also calls a tool with a real local Keycloak token.

Application-service `GET /mcp` endpoints remain legacy descriptor JSON. They are not independent MCP servers. agentgateway federation and A2A remain deferred; see [demo target](../adr/ADR-0011-local-demo-target.md).
