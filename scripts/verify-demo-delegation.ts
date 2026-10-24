import { gatewayUrl, keycloakIssuerUrl } from './endpoints.ts';
/** Real local Keycloak/broker/provider checks; never print tokens or private keys. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
const core = gatewayUrl;
const issuer = process.env.KEYCLOAK_ISSUER || keycloakIssuerUrl;
async function login(username: string) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: 'demo123' }) });
  assert.equal(response.status, 200, 'Seeded demo login'); const { access_token: token } = await response.json() as any;
  return { token, sub: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string };
}
const owner = await login('bassem'), other = await login('demo-commuter');
async function api(path: string, method = 'GET', body?: unknown, who = owner) {
  const response = await fetch(`${core}/api/delegation${path}`, { method, headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() as any };
}
const created: string[] = [];
const grant = async (extra: Record<string, unknown> = {}) => {
  const result = await api('/grants', 'POST', { provider: 'payments', method: 'GET', path: '/wallet', body: {}, accountId: accountIdFor(owner.sub), purpose: 'Inspect my synthetic wallet balance', expiresInSeconds: 300, maxOperations: 3, ...extra });
  assert.equal(result.status, 201, JSON.stringify(result.data)); created.push(result.data.grant.id); return result.data.grant;
};
try {
  const read = await grant();
  const bad = await api(`/grants/${read.id}`, 'GET', undefined, other); assert.equal(bad.status, 403);
  const cross = await api(`/grants/${read.id}/execute`, 'POST', { requestKey: randomUUID() }, other); assert.equal(cross.status, 403);
  const first = await api(`/grants/${read.id}/execute`, 'POST', { requestKey: 'read-wallet-0001' }); assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.result.success, true);
  const repeat = await api(`/grants/${read.id}/execute`, 'POST', { requestKey: 'read-wallet-0001' }); assert.equal(repeat.data.replay, true);
  const revoked = await api(`/grants/${read.id}`, 'DELETE'); assert.equal(revoked.status, 200);
  assert.equal((await api(`/grants/${read.id}/execute`, 'POST', { requestKey: randomUUID() })).status, 403);
  console.log('PASS: linked RFC 7523 issuance, owned read, replay result, cross-user denial and current consent revocation');
  const runnerResponse = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'delegation-runner', client_secret: readFileSync('.data/delegation/runner-secret', 'utf8') }) });
  assert.equal(runnerResponse.status, 200);
  const runner = { token: (await runnerResponse.json() as any).access_token, sub: '' };
  const machineGrant = await grant();
  assert.equal((await api(`/grants/${machineGrant.id}/execute`, 'POST', { requestKey: randomUUID() }, runner)).status, 200);
  assert.ok((await api('/grants', 'POST', { accountId: accountIdFor(owner.sub) }, runner)).status >= 400);
  console.log('PASS: authenticated workload executes existing consent and cannot create user consent');
  const mcp = new Client({ name: 'delegation-verifier', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${core}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${owner.token}` } } }));
  try {
    const tools = await mcp.listTools();
    assert.ok(tools.tools.some(t => t.name === 'cityside_execute_delegation'));
    assert.ok(!tools.tools.some(t => /create.*delegation|delegation.*create/.test(t.name)));
    const mcpGrant = await grant();
    assert.equal((await mcp.callTool({ name: 'cityside_execute_delegation', arguments: { grantId: mcpGrant.id, requestKey: randomUUID() } })).isError, false);
    assert.equal((await mcp.callTool({ name: 'cityside_revoke_delegation', arguments: { grantId: mcpGrant.id } })).isError, false);
    assert.equal((await mcp.callTool({ name: 'cityside_execute_delegation', arguments: { grantId: mcpGrant.id, requestKey: randomUUID() } })).isError, true);
    console.log('PASS: MCP executes existing consent, withdraws it and rejects further execution; no consent-creation tool');
  } finally { await mcp.close(); }
  for (const [provider, path] of [['rta', '/salik'], ['dewa', '/consumption'], ['etisalat', '/subscriptions'], ['du', '/subscriptions'], ['police', '/fines'], ['dld', '/tenancy']] as const) {
    const scoped = await grant({ provider, path, maxOperations: 1 });
    const result = await api(`/grants/${scoped.id}/execute`, 'POST', { requestKey: randomUUID() });
    assert.equal(result.status, 200, `${provider}: ${JSON.stringify(result.data)}`);
  }
  console.log('PASS: exact-operation delegated reads across all seven provider simulators');
  const beforeGrant = await grant();
  const before = await api(`/grants/${beforeGrant.id}/execute`, 'POST', { requestKey: randomUUID() });
  const write = await grant({ method: 'POST', path: '/topups', body: { amountMinor: 100, source: 'demo_approved' }, maxOperations: 1, purpose: 'Approve one synthetic AED 1 wallet credit' });
  const key = randomUUID();
  const result = await api(`/grants/${write.id}/execute`, 'POST', { requestKey: key }); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal((await api(`/grants/${write.id}/execute`, 'POST', { requestKey: key })).data.replay, true);
  assert.equal((await api(`/grants/${write.id}/execute`, 'POST', { requestKey: randomUUID() })).status, 403);
  const after = await api(`/grants/${beforeGrant.id}/execute`, 'POST', { requestKey: randomUUID() });
  assert.equal(after.data.result.balance - before.data.result.balance, 1);
  const history = await api(`/grants/${write.id}/history`); assert.ok(history.data.history.some((item: any) => item.event === 'execution.authorized'));
  assert.ok(!JSON.stringify(history.data).includes('access_token'));
  assert.equal((await api('/grants', 'POST', { ...write, body: { amountMinor: 10000, source: 'demo_approved' } })).status, 403);
  console.log('PASS: explicitly approved AED 1 credit, single effect, execution limit, rejected wider write and credential-free audit');
} finally { for (const id of created) await api(`/grants/${id}`, 'DELETE'); }
