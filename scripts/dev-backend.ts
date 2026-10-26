import { catalogServiceUrl, foodServiceUrl, gatewayUrl, profileServiceUrl, rideServiceUrl, walletServiceUrl } from './endpoints.ts';
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
  const port = Number(new URL(url).port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`The endpoint ${url} must name a port.`);
  return port;
};

process.env.PORT = String(portOf(rideServiceUrl));
const { server: rideServer } = await import('../services/service-ride/src/index.ts');
rideServer.listen(portOf(rideServiceUrl), host, () => {
  console.log(`🚖 [service-ride]    listening on ${rideServiceUrl}`);
});

process.env.PORT = String(portOf(foodServiceUrl));
const { server: foodServer } = await import('../services/service-food/src/index.ts');
foodServer.listen(portOf(foodServiceUrl), host, () => {
  console.log(`🍕 [service-food]    listening on ${foodServiceUrl}`);
});

process.env.PORT = String(portOf(walletServiceUrl));
const { server: walletServer } = await import('../services/service-wallet/src/index.ts');
walletServer.listen(portOf(walletServiceUrl), host, () => {
  console.log(`💳 [service-wallet]  listening on ${walletServiceUrl}`);
});

process.env.PORT = String(portOf(catalogServiceUrl));
const { server: catalogServer } = await import('../services/service-catalog/src/index.ts');
catalogServer.listen(portOf(catalogServiceUrl), host, () => {
  console.log(`📦 [service-catalog] listening on ${catalogServiceUrl}`);
});

process.env.PORT = String(portOf(profileServiceUrl));
const { server: profileServer } = await import('../services/service-profile/src/index.ts');
profileServer.listen(portOf(profileServiceUrl), host, () => {
  console.log(`👤 [service-profile] listening on ${profileServiceUrl}`);
});

process.env.PORT = String(portOf(gatewayUrl));
const { server: coreServer } = await import('../services/agent-core/src/index.ts');
coreServer.listen(portOf(gatewayUrl), host, () => {
  console.log(`🧠 [agent-core]      listening on ${gatewayUrl} (A2-UI SSE & Ingress)`);
  console.log('===========================================================');
  console.log('✨ All backend services operational and ready for connections.');
  console.log('===========================================================');
});
