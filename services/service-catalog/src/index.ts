import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

const miniApps = [
  {
    id: 'org.superapp.ride',
    name: 'Ride & Mobility',
    icon: 'car',
    version: '1.0.0',
    entryRoute: '/ride',
    remoteUrl: 'http://localhost:3010/remoteEntry.js',
    description: 'Book rides, schedule pickups, and track drivers in real-time',
  },
  {
    id: 'org.superapp.food',
    name: 'Food & Dining',
    icon: 'utensils',
    version: '1.0.0',
    entryRoute: '/food',
    remoteUrl: 'http://localhost:3011/remoteEntry.js',
    description: 'Order from local restaurants and grocery delivery',
  },
  {
    id: 'org.superapp.wallet',
    name: 'Wallet & Payments',
    icon: 'wallet',
    version: '1.0.0',
    entryRoute: '/wallet',
    remoteUrl: 'http://localhost:3012/remoteEntry.js',
    description: 'Manage digital cards, top-up funds, and view receipts',
  },
];

fastify.get('/health', async () => ({ status: 'ok', service: 'service-catalog', port: 4004 }));

// Mini-App Catalog endpoint
fastify.get('/miniapps', async () => ({
  success: true,
  count: miniApps.length,
  miniApps,
}));

const PORT = parseInt(process.env.PORT || '4004', 10);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`📦 Mini-App Catalog Service listening on port ${PORT}`);
