import type { BrowserContext } from 'playwright/test';
import { isInteractiveStackRequest, isLocalRequest } from './external-hosts.ts';

/** Page-level interception can take precedence; explicit forwarding must validate its target separately. */
export async function installNetworkFence(context: BrowserContext, offset: number, blocked: string[], ports?: ReadonlySet<number>) {
  const refuse = (url: URL) => !isLocalRequest(url) || isInteractiveStackRequest(url, offset, ports);
  await context.route(refuse, route => { blocked.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient'); });
  await context.routeWebSocket(refuse, socket => { blocked.push(new URL(socket.url()).origin); return socket.close(); });
}
