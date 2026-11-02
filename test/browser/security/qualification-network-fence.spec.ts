import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from 'playwright/test';
import { installNetworkFence, safeRouteFetch } from '../network-fence.ts';

test('qualification fence prevents HTTP and WebSocket traffic from reaching the protected port', async ({ browser }) => {
  let reached = 0;
  const server = http.createServer((_request, response) => { reached++; response.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end(); });
  server.on('upgrade', (_request, socket) => { reached++; socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const blocked: string[] = [];
  const context = await browser.newContext();
  try {
    await installNetworkFence(context, 30000, blocked, new Set([port]));
    const page = await context.newPage();
    await page.goto('data:text/html,<title>qualification fence</title>');
    const result = await page.evaluate(async port => {
      const httpBlocked = await fetch(`http://127.0.0.1:${port}/probe`).then(() => false, () => true);
      const socketBlocked = await new Promise<boolean>(resolve => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);
        socket.onopen = () => resolve(false);
        socket.onclose = () => resolve(true);
        setTimeout(() => resolve(false), 3000);
      });
      return { httpBlocked, socketBlocked };
    }, port);
    expect(result).toEqual({ httpBlocked: true, socketBlocked: true });
    expect(blocked).toEqual([`http://127.0.0.1:${port}`, `ws://127.0.0.1:${port}`]);
    expect(reached).toBe(0);
    const control = await browser.newContext();
    try {
      await installNetworkFence(control, 0, [], new Set([port]));
      const controlPage = await control.newPage();
      expect((await controlPage.goto(`http://127.0.0.1:${port}/control`))!.status()).toBe(200);
      expect(reached).toBe(1);
    } finally { await control.close(); }
  } finally { await context.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('explicit forwarding does not follow a redirect to another server', async ({ page }) => {
  let destinationHits = 0, sourceHits = 0, refused = false;
  const destination = http.createServer((_request, response) => { destinationHits++; response.writeHead(200).end(); });
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve));
  const destinationPort = (destination.address() as AddressInfo).port;
  const source = http.createServer((request, response) => {
    if (request.url === '/redirect') { sourceHits++; response.writeHead(302, { Location: `http://127.0.0.1:${destinationPort}/target` }).end(); }
    else response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>forwarding test</title>');
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const sourcePort = (source.address() as AddressInfo).port;
  try {
    await page.route('**/redirect', async route => {
      try { await safeRouteFetch(route, undefined, 30000); } catch { refused = true; }
      await route.abort();
    });
    await page.goto(`http://127.0.0.1:${sourcePort}/`);
    await page.evaluate(() => fetch('/redirect').catch(() => undefined));
    expect(refused).toBe(true);
    expect(sourceHits).toBe(1);
    expect(destinationHits).toBe(0);
  } finally {
    source.closeAllConnections(); destination.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => source.close(() => resolve())), new Promise<void>(resolve => destination.close(() => resolve()))]);
  }
});
