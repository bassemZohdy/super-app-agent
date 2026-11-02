import http from 'node:http';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../fixtures.ts';

test('browser clients reject malformed refresh responses', async ({ page }) => {
  const shared = stripTypeScriptTypes(readFileSync('packages/protocol-core/src/oidc-client.ts', 'utf8'));
  const flutter = readFileSync('apps/shell-flutter/web/cityside-auth.js', 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/shared.js' || request.url === '/flutter.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(request.url === '/shared.js' ? shared : flutter); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>OIDC response test</title>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const asset of ['/shared.js', '/flutter.js']) for (const scenario of ['invalid', 'oversized', 'valid'] as const) {
      await page.goto(base);
      await page.route(`${base}/protocol/openid-connect/token`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: scenario === 'invalid' ? '' : 'valid-access', refresh_token: 'valid-refresh', expires_in: 300, padding: scenario === 'oversized' ? 'x'.repeat(70000) : '' }) }));
      try {
        const result = await page.evaluate(async ({ base, asset }) => {
          const { BrowserAuth } = await import(asset);
          sessionStorage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 0 }));
          const auth = new BrowserAuth({ enabled: true, issuer: base, clientId: 'browser-client' });
          try { await auth.token(); return { outcome: 'accepted', signedIn: auth.signedIn }; }
          catch { return { outcome: 'rejected', signedIn: auth.signedIn }; }
        }, { base, asset });
        expect(result).toEqual(scenario === 'valid' ? { outcome: 'accepted', signedIn: true } : { outcome: 'rejected', signedIn: false });
      } finally { await page.unroute(`${base}/protocol/openid-connect/token`); }
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
