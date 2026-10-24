import { gatewayUrl, keycloakIssuerUrl } from './endpoints.ts';
import assert from 'node:assert/strict';
const issuer = keycloakIssuerUrl;
const base = gatewayUrl;
const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: process.env.DEMO_USER_PASSWORD || 'demo123', scope: 'openid' }),
});
assert.equal(response.status, 200, 'Demo user login failed');
const tokens = await response.json() as { access_token: string; refresh_token: string; id_token: string };
const request = (token: string) => fetch(`${base}/api/accounts`, { headers: { Authorization: `Bearer ${token}` } });
try {
  assert.equal((await request(tokens.access_token)).status, 200, 'Valid access token must work');
  assert.equal((await request(tokens.id_token)).status, 401, 'ID tokens must not authorize APIs');
  const logout = await fetch(`${issuer}/protocol/openid-connect/logout`, { method: 'POST',
    body: new URLSearchParams({ client_id: 'superapp-shell', refresh_token: tokens.refresh_token }),
  });
  assert.equal(logout.status, 204, 'Keycloak logout failed');
  assert.equal((await request(tokens.access_token)).status, 401, 'A logged-out access token must be inactive before its expiry');
  console.log('PASS: real Keycloak access-token acceptance, ID-token rejection and immediate post-logout revocation.');
} finally {
  await fetch(`${issuer}/protocol/openid-connect/logout`, { method: 'POST', body: new URLSearchParams({ client_id: 'superapp-shell', refresh_token: tokens.refresh_token }) });
}
