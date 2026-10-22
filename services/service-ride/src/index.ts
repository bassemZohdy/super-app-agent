import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

const drivers = [
  { id: 'drv_1', name: 'Alex M.', rating: 4.9, car: 'Toyota Camry (Silver)', etaMinutes: 4, fare: 22.0 },
  { id: 'drv_2', name: 'Sara K.', rating: 4.8, car: 'Hyundai Sonata (White)', etaMinutes: 7, fare: 18.5 },
];

fastify.get('/health', async () => ({ status: 'ok', service: 'service-ride', port: 4001 }));

// REST Endpoint: Available rides
fastify.get('/rides/options', async () => ({
  success: true,
  options: drivers,
}));

// REST Endpoint: Book a cab
fastify.post('/rides/book', async (request, reply) => {
  const body = request.body as { driverId?: string; pickup?: string; dropoff?: string };
  return {
    bookingId: `bk_${Date.now()}`,
    status: 'CONFIRMED',
    driver: drivers[0],
    pickup: body.pickup || 'Current Location',
    dropoff: body.dropoff || 'Selected Destination',
    eta: '4 mins',
  };
});

// MCP (Model Context Protocol) Endpoint: Tool definitions & execution
fastify.get('/mcp', async () => ({
  protocol: 'mcp-1.0',
  tools: [
    {
      name: 'ride_getOptions',
      description: 'Get available ride options, ETAs, and fares',
      parameters: { type: 'object', properties: { destination: { type: 'string' } } },
    },
    {
      name: 'ride_bookCab',
      description: 'Book a ride with selected tier',
      parameters: { type: 'object', properties: { driverId: { type: 'string' } }, required: ['driverId'] },
    },
  ],
}));

const PORT = parseInt(process.env.PORT || '4001', 10);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`🚖 Ride Microservice listening on port ${PORT}`);
