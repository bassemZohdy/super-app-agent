import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const issuer = process.env.DEMO_KEYCLOAK_URL || 'http://localhost:8085/realms/superapp';
const base = process.env.DEMO_GATEWAY_URL || 'http://localhost:4000';
const login = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123', scope: 'openid' }) });
assert.equal(login.status, 200);
const token = (await login.json() as { access_token: string }).access_token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const mcp = new Client({ name: 'cityside-real-identity-check', version: '1.0.0' });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const result = await mcp.callTool({ name: 'cityside_accounts', arguments: {} });
  assert.notEqual(result.isError, true);
  console.log('PASS: official MCP client calls an authorized tool with a real local Keycloak access token');
} finally { await mcp.close(); }
const listing = await fetch(`${base}/api/services`, { headers }); assert.equal(listing.status, 200);
const services = (await listing.json() as { services: Array<{ id: string }> }).services;
for (const service of services) {
  const sessionId = `manual_verify_${randomUUID()}`;
  try {
    const response = await fetch(`${base}/api/manual/prepare`, { method: 'POST', headers, body: JSON.stringify({ sessionId, serviceId: service.id }) });
    assert.equal(response.status, 200, service.id);
    const data = await response.json() as any;
    assert.ok(data.surface.revision); assert.equal(data.inference.provider, 'manual-service');
    if (service.id === 'wallet') {
      const cancellation = await fetch(`${base}/api/a2ui/cancel`, { method: 'POST', headers, body: JSON.stringify({ sessionId, surfaceRevision: data.surface.revision }) }); assert.equal(cancellation.status, 200);
      const replay = await fetch(`${base}/api/a2ui/action`, { method: 'POST', headers, body: JSON.stringify({ sessionId, surfaceRevision: data.surface.revision, action: 'topup_wallet', payload: { amount: 50 } }) }); assert.equal(replay.status, 409);
    }
    console.log(`PASS: manual ${service.id} prepares without a model request`);
  } finally { const removed = await fetch(`${base}/api/sessions/${sessionId}`, { method: 'DELETE', headers }); assert.equal(removed.status, 200); }
}
console.log('Manual service verification passed. Cancelled approval replay was rejected.');
