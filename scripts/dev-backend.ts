import { catalogServiceUrl, foodServiceUrl, gatewayUrl, profileServiceUrl, rideServiceUrl, walletServiceUrl } from './endpoints.ts';
/**
 * Unified Backend Runner for SuperApp Agent
 * Boots all 4 microservices + Agent Gateway in-process for fast local development.
 */

console.log('===========================================================');
console.log('🚀 SuperApp Agent Platform: Starting Backend Ecosystem...');
console.log('===========================================================');

process.env.DEMO_AUTH = process.env.DEMO_AUTH || 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

process.env.PORT = '4001';
const { server: rideServer } = await import('../services/service-ride/src/index.ts');
rideServer.listen(4001, '0.0.0.0', () => {
  console.log(`🚖 [service-ride]    listening on ${rideServiceUrl}`);
});

process.env.PORT = '4002';
const { server: foodServer } = await import('../services/service-food/src/index.ts');
foodServer.listen(4002, '0.0.0.0', () => {
  console.log(`🍕 [service-food]    listening on ${foodServiceUrl}`);
});

process.env.PORT = '4003';
const { server: walletServer } = await import('../services/service-wallet/src/index.ts');
walletServer.listen(4003, '0.0.0.0', () => {
  console.log(`💳 [service-wallet]  listening on ${walletServiceUrl}`);
});

process.env.PORT = '4004';
const { server: catalogServer } = await import('../services/service-catalog/src/index.ts');
catalogServer.listen(4004, '0.0.0.0', () => {
  console.log(`📦 [service-catalog] listening on ${catalogServiceUrl}`);
});

process.env.PORT = '4005';
const { server: profileServer } = await import('../services/service-profile/src/index.ts');
profileServer.listen(4005, '0.0.0.0', () => {
  console.log(`👤 [service-profile] listening on ${profileServiceUrl}`);
});

process.env.PORT = '4000';
const { server: coreServer } = await import('../services/agent-core/src/index.ts');
coreServer.listen(4000, '0.0.0.0', () => {
  console.log(`🧠 [agent-core]      listening on ${gatewayUrl} (A2-UI SSE & Ingress)`);
  console.log('===========================================================');
  console.log('✨ All backend services operational and ready for connections.');
  console.log('===========================================================');
});
