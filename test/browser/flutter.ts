import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { test as base, expect } from './fixtures.ts';
import type { Page } from 'playwright/test';

/** Real key events let Flutter's semantics editor update its Dart controller before submit. */
export async function enterFlutterAccessToken(page: Page, token: string) {
  const input = page.getByLabel('Access token', { exact: true });
  await input.focus();
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await input.pressSequentially(token, { delay: 20 });
  await input.press('Tab');
  // Semantics input and the Dart controller synchronize on engine frames.
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

const root = resolve('apps/shell-flutter/build/web');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png' };
export const test = base.extend<{}, { flutterUrl: string }>({
  flutterUrl: [async ({}, use) => {
    expect(existsSync(resolve(root, 'index.html')), 'build Flutter web before running its browser suite').toBe(true);
    const server = http.createServer((request, response) => {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      let file = resolve(root, `.${decodeURIComponent(path)}`);
      if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
      if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, 'index.html');
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(readFileSync(file));
    });
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(3002, '127.0.0.1', done); });
    try { await use('http://localhost:3002'); } finally { await new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }); }
  }, { scope: 'worker' }],
});
export { expect };
