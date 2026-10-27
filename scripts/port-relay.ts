import { litellmBase } from '../services/agent-core/src/litellm-config.ts';
/** A fixed-destination TCP relay (P2-07). The backends sit on an internal Compose network with no route out and no published ports;
 *  this one container is attached to that network and to an edge network, and publishes loopback ports that forward to exactly the
 *  destinations in RELAY_ROUTES ("listenPort=service:port,…"). A client chooses nothing: there is no protocol, header or address that
 *  changes where a connection goes, and a route to anything but a plain service name is refused at start. */
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export type Route = { listen: number; host: string; port: number };

export function parseRoutes(value: string | undefined): Route[] {
  if (!value || !value.trim()) throw new Error('RELAY_ROUTES is empty.');
  const seen = new Set<number>();
  return value.split(',').map(entry => {
    const match = /^(\d{1,5})=([a-z][a-z0-9-]{0,62}):(\d{1,5})$/.exec(entry.trim());
    if (!match) throw new Error(`Invalid relay route "${entry.trim()}": expected listenPort=service:port with a plain service name.`);
    const [listen, port] = [Number(match[1]), Number(match[3])];
    for (const number of [listen, port]) if (number < 1 || number > 65535) throw new Error(`Invalid port in "${entry.trim()}".`);
    if (seen.has(listen)) throw new Error(`The port ${listen} is routed twice.`);
    seen.add(listen);
    return { listen, host: match[2], port };
  });
}

/** Optional fixed TLS route for explicitly selected hosted LiteLLM. No key is needed by this relay. */
export function parseModelRoute(env: NodeJS.ProcessEnv): Route | undefined {
  if (env.CONVERSATION_PROVIDER !== 'litellm') return;
  try {
    const url = litellmBase(env);
    if (url.protocol === 'http:') return;
    return { listen: 4443, host: url.hostname, port: Number(url.port || 443) };
  } catch { throw new Error('Invalid LiteLLM relay endpoint'); }
}

/** One forwarding listener. Connections are piped both ways and torn down together; an idle one is closed after `idleMs`. */
export function listen(route: Route, idleMs = 120_000, bind = '0.0.0.0'): Promise<net.Server> {
  const server = net.createServer(client => {
    const upstream = net.connect({ host: route.host, port: route.port });
    for (const socket of [client, upstream]) { socket.setTimeout(idleMs, () => socket.destroy()); socket.on('error', () => { client.destroy(); upstream.destroy(); }); socket.on('close', () => { client.destroy(); upstream.destroy(); }); }
    client.pipe(upstream); upstream.pipe(client);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(route.listen, bind, () => resolve(server)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const routes = parseRoutes(process.env.RELAY_ROUTES);
  const modelRoute = parseModelRoute(process.env);
  if (modelRoute) {
    if (routes.some(route => route.listen === modelRoute.listen)) throw new Error('Model relay port already routed');
    routes.push(modelRoute);
  }
  const servers = await Promise.all(routes.map(route => listen(route)));
  console.log(`relay ready: ${routes.map(route => `${route.listen}->${route.host}:${route.port}`).join(' ')}`);
  const stop = () => { for (const server of servers) server.close(); setTimeout(() => process.exit(0), 500).unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
