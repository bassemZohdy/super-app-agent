import http from 'node:http';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../fixtures.ts';

test('browser login rejects stale and corrupt requests before exchange', async ({ page }) => {
  const shared = stripTypeScriptTypes(readFileSync('packages/protocol-core/src/oidc-client.ts', 'utf8'));
  const flutter = readFileSync('apps/shell-flutter/web/cityside-auth.js', 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/shared.js' || request.url === '/flutter.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(request.url === '/shared.js' ? shared : flutter); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>OIDC request test</title>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const asset of ['/shared.js', '/flutter.js']) for (const scenario of ['corrupt', 'stale', 'future', 'valid'] as const) {
      await page.goto(`${base}/?code=code&state=state`);
      let calls = 0;
      await page.route(`${base}/protocol/openid-connect/token`, route => { calls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'access', expires_in: 300 }) }); });
      try {
        const result = await page.evaluate(async ({ base, asset, scenario }) => {
          const { BrowserAuth } = await import(asset);
          const auth = new BrowserAuth({ enabled: true, issuer: base, clientId: 'browser-client' });
          sessionStorage.removeItem('cityside.oidc.tokens');
          const createdAt = Date.now() + (scenario === 'stale' ? -301000 : scenario === 'future' ? 60000 : 0);
          sessionStorage.setItem('cityside.oidc.request', scenario === 'corrupt' ? '{broken' : JSON.stringify({ state: 'state', verifier: 'verifier', redirectUri: `${location.origin}/`, createdAt }));
          let outcome = 'accepted'; try { await auth.completeLogin(); } catch { outcome = 'rejected'; }
          return { outcome, query: location.search, request: sessionStorage.getItem('cityside.oidc.request'), signedIn: auth.signedIn };
        }, { base, asset, scenario });
        expect(result).toEqual({ outcome: scenario === 'valid' ? 'accepted' : 'rejected', query: '', request: null, signedIn: scenario === 'valid' });
        expect(calls).toBe(scenario === 'valid' ? 1 : 0);
      } finally { await page.unroute(`${base}/protocol/openid-connect/token`); }
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
