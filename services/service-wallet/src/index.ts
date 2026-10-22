import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

let balance = 142.5;

fastify.get('/health', async () => ({ status: 'ok', service: 'service-wallet', port: 4003 }));

// REST Endpoint: Check Balance
fastify.get('/wallet/balance', async () => ({
  success: true,
  currency: 'USD',
  balance,
}));

// REST Endpoint: Authorize and execute payment
fastify.post('/wallet/pay', async (request, reply) => {
  const body = request.body as { amount: number; purpose?: string };
  if (!body.amount || body.amount > balance) {
    return reply.status(400).send({ error: 'Insufficient funds or invalid amount' });
  }

  balance -= body.amount;
  return {
    success: true,
    transactionId: `tx_${Date.now()}`,
    amountPaid: body.amount,
    remainingBalance: balance,
    purpose: body.purpose || 'SuperApp Purchase',
  };
});

// MCP (Model Context Protocol) Endpoint
fastify.get('/mcp', async () => ({
  protocol: 'mcp-1.0',
  tools: [
    {
      name: 'wallet_getBalance',
      description: 'Check active user wallet balance and currency',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'wallet_authorizePayment',
      description: 'Deduct amount from user wallet for mini-app purchase',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'number' }, purpose: { type: 'string' } },
        required: ['amount'],
      },
    },
  ],
}));

const PORT = parseInt(process.env.PORT || '4003', 10);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`💳 Wallet Microservice listening on port ${PORT}`);
