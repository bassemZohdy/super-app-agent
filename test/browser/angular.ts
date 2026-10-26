/** The built Angular shell (apps/shell-angular/dist/browser) served on the port Keycloak already allows for it, plus a signed-in
 *  page, so a spec can measure the real app. Build it first with `npm run build --workspace=apps/shell-angular`; the Compose
 *  stack must be up. Loopback only. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

const ROOT = resolve('apps/shell-angular/dist/browser');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export const test = base.extend<{ angular: Page }, { angularUrl: string }>({
  angularUrl: [async ({ }, use) => {
    expect(existsSync(join(ROOT, 'index.html')), 'build the Angular shell first: npm run build --workspace=apps/shell-angular').toBe(true);
    const server = http.createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname));
      let file = resolve(ROOT, `.${sep}${path}`);
      if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403).end(); return; }
      if (!existsSync(file) || !statSync(file).isFile()) file = join(ROOT, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(file));
    });
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(3001, '127.0.0.1', done); });
    try { await use('http://localhost:3001'); } finally { await new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }); }
  }, { scope: 'worker' }],

  /** The Angular shell against a stubbed local gateway: auth is reported as disabled and the API answers with fixed data, so the
   *  page is measured as laid out without depending on Keycloak or the gateway (whose token check can be slow on a cold stack). */
  angular: async ({ page, angularUrl }, use) => {
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': angularUrl }, body: JSON.stringify(body) });
    await page.route('http://localhost:4000/**', route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': angularUrl, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (url.pathname === '/api/auth/config') return route.fulfill(json({ enabled: false }));
      if (url.pathname === '/api/accounts') return route.fulfill(json({ success: true, accounts: [{ id: 'acc_stub', label: 'Personal account' }], user: { name: 'Demo resident' } }));
      if (url.pathname.includes('stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': angularUrl }, body: ': stub\n\n' });
      return route.fulfill(json({ success: true }));
    });
    await page.goto(angularUrl);
    await page.getByRole('combobox', { name: 'Current account', exact: true }).waitFor();
    await use(page);
  },
});

export { expect };
