import http from 'node:http';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../fixtures.ts';

test('browser sign-in and refresh do not forward credentials through redirects', async ({ page }) => {
  let status = 307, targetCalls = 0;
  const target = http.createServer((request, response) => {
    targetCalls++; request.resume(); response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 300 }));
  });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const issuer = http.createServer((request, response) => {
    request.resume(); response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' }); response.end(); return; }
    if (status !== 200) { response.writeHead(status, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/token` }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 300 }));
  });
  await new Promise<void>(resolve => issuer.listen(0, '127.0.0.1', resolve));
  const shared = stripTypeScriptTypes(readFileSync('packages/protocol-core/src/oidc-client.ts', 'utf8'));
  const flutter = readFileSync('apps/shell-flutter/web/cityside-auth.js', 'utf8');
  const app = http.createServer((request, response) => {
    if (request.url === '/shared.js' || request.url === '/flutter.js' || request.url === '/unsafe.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(request.url === '/flutter.js' ? flutter : request.url === '/unsafe.js' ? shared.replace("redirect: 'error', ", '') : shared);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>OIDC test</title>');
  });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const issuerUrl = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;
  try {
    await page.goto(`${appUrl}/?code=test-code&state=test-state`);
    await page.evaluate(async issuerUrl => {
      const asset = '/unsafe.js'; const { BrowserAuth } = await import(asset);
      const auth = new BrowserAuth({ enabled: true, issuer: issuerUrl, clientId: 'browser-client' });
      sessionStorage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: `${location.origin}/`, createdAt: Date.now() }));
      await auth.completeLogin();
    }, issuerUrl);
    expect(targetCalls).toBe(1);
    targetCalls = 0;
    for (const asset of ['/shared.js', '/flutter.js']) {
      for (status of [307, 308]) {
        await page.goto(`${appUrl}/?code=test-code&state=test-state`);
        const result = await page.evaluate(async ({ issuerUrl, asset }) => {
          const { BrowserAuth } = await import(asset);
          const auth = new BrowserAuth({ enabled: true, issuer: issuerUrl, clientId: 'browser-client' });
          sessionStorage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: `${location.origin}/`, createdAt: Date.now() }));
          let loginRejected = false, refreshRejected = false;
          try { await auth.completeLogin(); } catch { loginRejected = true; }
          sessionStorage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', expiresAt: 0 }));
          try { await auth.token(); } catch { refreshRejected = true; }
          return { loginRejected, refreshRejected, signedIn: auth.signedIn, query: location.search };
        }, { issuerUrl, asset });
        expect(result).toEqual({ loginRejected: true, refreshRejected: true, signedIn: false, query: '' });
        expect(targetCalls).toBe(0);
      }
      status = 200;
      await page.goto(`${appUrl}/?code=test-code&state=test-state`);
      const token = await page.evaluate(async ({ issuerUrl, asset }) => {
        const { BrowserAuth } = await import(asset);
        const auth = new BrowserAuth({ enabled: true, issuer: issuerUrl, clientId: 'browser-client' });
        sessionStorage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: `${location.origin}/`, createdAt: Date.now() }));
        await auth.completeLogin(); return auth.token();
      }, { issuerUrl, asset });
      expect(token).toBe('test-access'); expect(targetCalls).toBe(0);
    }
  } finally {
    for (const server of [app, issuer, target]) server.closeAllConnections();
    await Promise.all([app, issuer, target].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
});
