/**
 * Unified Backend Runner for SuperApp Agent
 * Boots all 4 microservices + Agent Gateway in-process for fast local development.
 */

console.log('===========================================================');
console.log('🚀 SuperApp Agent Platform: Starting Backend Ecosystem...');
console.log('===========================================================');

process.env.PORT = '4001';
const { server: rideServer } = await import('../services/service-ride/src/index.ts');
rideServer.listen(4001, '0.0.0.0', () => {
  console.log('🚖 [service-ride]    listening on http://localhost:4001');
});

process.env.PORT = '4002';
const { server: foodServer } = await import('../services/service-food/src/index.ts');
foodServer.listen(4002, '0.0.0.0', () => {
  console.log('🍕 [service-food]    listening on http://localhost:4002');
});

process.env.PORT = '4003';
const { server: walletServer } = await import('../services/service-wallet/src/index.ts');
walletServer.listen(4003, '0.0.0.0', () => {
  console.log('💳 [service-wallet]  listening on http://localhost:4003');
});

process.env.PORT = '4004';
const { server: catalogServer } = await import('../services/service-catalog/src/index.ts');
catalogServer.listen(4004, '0.0.0.0', () => {
  console.log('📦 [service-catalog] listening on http://localhost:4004');
});

process.env.PORT = '4005';
const { server: profileServer } = await import('../services/service-profile/src/index.ts');
profileServer.listen(4005, '0.0.0.0', () => {
  console.log('👤 [service-profile] listening on http://localhost:4005');
});

process.env.PORT = '4000';
const { server: coreServer } = await import('../services/agent-core/src/index.ts');
coreServer.listen(4000, '0.0.0.0', () => {
  console.log('🧠 [agent-core]      listening on http://localhost:4000 (A2-UI SSE & Ingress)');
  console.log('===========================================================');
  console.log('✨ All backend services operational and ready for connections.');
  console.log('===========================================================');
});
