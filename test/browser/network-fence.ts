import type { BrowserContext, Route } from 'playwright/test';
import { isInteractiveStackRequest, isLocalRequest } from './external-hosts.ts';
import { demoPortOffset } from '../../scripts/endpoints.ts';

/** Page-level interception can take precedence; explicit forwarding must validate its target separately. */
export async function installNetworkFence(context: BrowserContext, offset: number, blocked: string[], ports?: ReadonlySet<number>) {
  const refuse = (url: URL) => !isLocalRequest(url) || isInteractiveStackRequest(url, offset, ports);
  await context.route(refuse, route => { blocked.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient'); });
  await context.routeWebSocket(refuse, socket => { blocked.push(new URL(socket.url()).origin); return socket.close(); });
}

/** Page routes can bypass context routes, so explicit forwarding must validate its own target and never follow redirects. */
export async function safeRouteFetch(route: Route, target?: string, offset = demoPortOffset) {
  const url = new URL(target ?? route.request().url());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !isLocalRequest(url) || isInteractiveStackRequest(url, offset)) {
    throw new Error('Browser test forwarding target is not permitted.');
  }
  const response = await route.fetch({ ...(target ? { url: url.href } : {}), maxRedirects: 0 });
  if (response.status() >= 300 && response.status() < 400) {
    await response.dispose();
    throw new Error('Browser test forwarding refuses redirects.');
  }
  return response;
}
