import { catalogServiceUrl, foodServiceUrl, gatewayUrl, profileServiceUrl, rideServiceUrl, walletServiceUrl } from './endpoints.ts';
import type { Server } from 'node:http';
/**
 * Unified Backend Runner for SuperApp Agent
 * Boots all 4 microservices + Agent Gateway in-process for fast local development.
 *
 * Each service listens on the port of its own endpoint URL (DEMO_*_URL, see endpoints.ts), on the loopback address unless
 * DEV_BACKEND_HOST says otherwise. This is a development runner, not a production profile.
 */

console.log('===========================================================');
console.log('🚀 SuperApp Agent Platform: Starting Backend Ecosystem...');
console.log('===========================================================');

process.env.DEMO_AUTH = process.env.DEMO_AUTH || 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const host = process.env.DEV_BACKEND_HOST || '127.0.0.1';
/** The port a service endpoint URL names; an endpoint without an explicit port is a mistake worth stopping for. */
const portOf = (url: string) => {
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { throw new Error('A backend endpoint URL is invalid.'); }
  if (endpoint.protocol !== 'http:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
    throw new Error('A backend endpoint URL is invalid: use a plain HTTP origin without credentials, path, query or fragment.');
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Every backend endpoint must name a port.');
  return port;
};

// Validate all ports before importing or starting any server, so a typo cannot leave a partial stack running.
const ports = [rideServiceUrl, foodServiceUrl, walletServiceUrl, catalogServiceUrl, profileServiceUrl, gatewayUrl].map(portOf);
if (new Set(ports).size !== ports.length) throw new Error('Duplicate backend port: each service needs a distinct port.');
const listen = (server: Server, url: string, message: string) => new Promise<void>((resolve, reject) => {
  const onError = (error: Error) => reject(error);
  server.once('error', onError);
  server.listen(portOf(url), host, () => { server.off('error', onError); console.log(message.replace(url, new URL(url).origin)); resolve(); });
});

process.env.PORT = String(portOf(rideServiceUrl));
const { server: rideServer } = await import('../services/service-ride/src/index.ts');
await listen(rideServer, rideServiceUrl, `🚖 [service-ride]    listening on ${rideServiceUrl}`);

process.env.PORT = String(portOf(foodServiceUrl));
const { server: foodServer } = await import('../services/service-food/src/index.ts');
await listen(foodServer, foodServiceUrl, `🍕 [service-food]    listening on ${foodServiceUrl}`);

process.env.PORT = String(portOf(walletServiceUrl));
const { server: walletServer } = await import('../services/service-wallet/src/index.ts');
await listen(walletServer, walletServiceUrl, `💳 [service-wallet]  listening on ${walletServiceUrl}`);

process.env.PORT = String(portOf(catalogServiceUrl));
const { server: catalogServer } = await import('../services/service-catalog/src/index.ts');
await listen(catalogServer, catalogServiceUrl, `📦 [service-catalog] listening on ${catalogServiceUrl}`);

process.env.PORT = String(portOf(profileServiceUrl));
const { server: profileServer } = await import('../services/service-profile/src/index.ts');
await listen(profileServer, profileServiceUrl, `👤 [service-profile] listening on ${profileServiceUrl}`);

process.env.PORT = String(portOf(gatewayUrl));
const { server: coreServer } = await import('../services/agent-core/src/index.ts');
await listen(coreServer, gatewayUrl, `🧠 [agent-core]      listening on ${gatewayUrl} (A2-UI SSE & Ingress)`);
console.log('===========================================================');
console.log('✨ All backend services operational and ready for connections.');
console.log('===========================================================');
