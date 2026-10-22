import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

const restaurants = [
  {
    id: 'rest_1',
    name: 'Pizza Napoli',
    cuisine: 'Italian',
    rating: 4.8,
    items: [
      { id: 'item_pizza', name: 'Woodfired Pizza Diavola', price: 18.0 },
      { id: 'item_pasta', name: 'Truffle Tagliatelle', price: 22.5 },
    ],
  },
];

fastify.get('/health', async () => ({ status: 'ok', service: 'service-food', port: 4002 }));

// REST Endpoint: Search restaurants
fastify.get('/restaurants/search', async (request) => {
  return { success: true, restaurants };
});

// REST Endpoint: Create food order
fastify.post('/orders/create', async (request) => {
  const body = request.body as { restaurantId?: string; items?: string[] };
  return {
    orderId: `ord_${Date.now()}`,
    status: 'ACCEPTED_BY_KITCHEN',
    restaurant: restaurants[0].name,
    estimatedPrepTime: '15 mins',
  };
});

// MCP (Model Context Protocol) Endpoint
fastify.get('/mcp', async () => ({
  protocol: 'mcp-1.0',
  tools: [
    {
      name: 'food_searchRestaurants',
      description: 'Find dining and grocery options',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
      name: 'food_createOrder',
      description: 'Place food order to restaurant kitchen',
      parameters: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] },
    },
  ],
}));

const PORT = parseInt(process.env.PORT || '4002', 10);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`🍕 Food Microservice listening on port ${PORT}`);
