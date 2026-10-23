import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../../services/agent-core/src/index.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

// Only test:keycloak supplies an isolated real issuer. No fetch/JWKS/token mocks here.
test('real Keycloak client tokens authenticate HTTP/SSE and isolate service-account subjects', async t => {
  assert.equal(process.env.DEMO_AUTH, 'false');
  const issuer = process.env.KEYCLOAK_ISSUER;
  assert.ok(issuer, 'Run npm run test:keycloak');
  const token = async (client: string, secret: string | undefined) => {
    assert.ok(secret, 'Missing generated integration secret');
    const response = await fetch(issuer + '/protocol/openid-connect/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret }) });
    assert.equal(response.status, 200, 'Real token endpoint rejected integration client');
    const body = await response.json() as { access_token: string };
    assert.ok(body.access_token);
    return body.access_token;
  };
  const alice = await token('release-alice', process.env.KEYCLOAK_TEST_SECRET_A);
  const bob = await token('release-bob', process.env.KEYCLOAK_TEST_SECRET_B);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const sid = 'real_keycloak_release_session';
  const intent = (jwt: string) => fetch(base + '/api/a2ui/intent', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
    body: JSON.stringify({ sessionId: sid, text: 'show my wallet' }) });
  assert.equal((await intent('demo-local')).status, 401);
  assert.equal((await intent(alice)).status, 200);
  assert.equal((await intent(bob)).status, 403);
  const url = base + '/api/a2ui/stream?sessionId=' + sid;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer ' + bob } })).status, 403);
  const abort = new AbortController();
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + alice }, signal: abort.signal });
  assert.equal(response.status, 200);
  const events = readEventStream(response);
  assert.equal(JSON.parse((await events.next()).value!.data).type, 'A2UI_HANDSHAKE_ACK');
  assert.equal(JSON.parse((await events.next()).value!.data).type, 'A2UI_RENDER_SURFACE');
  abort.abort(); await events.return(undefined);
});
