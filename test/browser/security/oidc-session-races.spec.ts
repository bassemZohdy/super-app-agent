import http from 'node:http';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../fixtures.ts';

test('sign-out and account replacement fence pending browser refreshes', async ({ page }) => {
  const shared = stripTypeScriptTypes(readFileSync('packages/protocol-core/src/oidc-client.ts', 'utf8'));
  const flutter = readFileSync('apps/shell-flutter/web/cityside-auth.js', 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/shared.js' || request.url === '/flutter.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(request.url === '/shared.js' ? shared : flutter); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>OIDC race test</title>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const asset of ['/shared.js', '/flutter.js']) for (const scenario of ['clear', 'replace-success', 'replace-failure'] as const) {
      await page.goto(base);
      let calls = 0, started!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const routePattern = `${base}/protocol/openid-connect/token`;
      await page.route(routePattern, async route => {
        calls++; started(); await gate;
        await route.fulfill(scenario === 'replace-failure' ? { status: 401, body: '' } : { status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 300 }) });
      });
      try {
        await page.evaluate(async ({ base, asset }) => {
          const { BrowserAuth } = await import(asset);
          const config = { enabled: true, issuer: base, clientId: 'browser-client' };
          sessionStorage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', expiresAt: 0 }));
          const a = new BrowserAuth(config), b = new BrowserAuth(config);
          const state = globalThis as typeof globalThis & { raceAuth: { clear(): void }; raceResult: Promise<string[]> };
          state.raceAuth = b;
          state.raceResult = Promise.allSettled([a.token(), b.token()]).then(results => results.map(result => result.status));
        }, { base, asset });
        await entered; await page.waitForTimeout(50); expect(calls).toBe(1);
        await page.evaluate(scenario => {
          if (scenario === 'clear') (globalThis as typeof globalThis & { raceAuth: { clear(): void } }).raceAuth.clear();
          else sessionStorage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'current-access', refresh_token: 'current-refresh', expiresAt: Date.now() + 600000 }));
        }, scenario);
        release();
        const result = await page.evaluate(async () => ({ outcomes: await (globalThis as typeof globalThis & { raceResult: Promise<string[]> }).raceResult, saved: sessionStorage.getItem('cityside.oidc.tokens') }));
        expect(result.outcomes).toEqual(['rejected', 'rejected']);
        if (scenario === 'clear') expect(result.saved).toBeNull();
        else expect(JSON.parse(result.saved!).access_token).toBe('current-access');
      } finally { release(); await page.unroute(routePattern); }
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
