import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  createA2UIMessage,
  A2UIHandshakePayload,
  A2UIMessageEnvelope,
} from '@superapp/protocol-core';
import { SuperAppAgentState } from './langgraph/state.js';
import { SuperAppAgentGraph } from './langgraph/graph.js';

const fastify = Fastify({ logger: true });

// Register CORS for web and mobile frontends
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
});

// In-Memory Session and SSE Subscriber Registry
const sessions = new Map<string, SuperAppAgentState>();
const sseClients = new Map<string, (msg: A2UIMessageEnvelope) => void>();

function getOrCreateSession(sessionId: string): SuperAppAgentState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      activeDomain: 'concierge',
    });
  }
  return sessions.get(sessionId)!;
}

// 1. Health check
fastify.get('/health', async () => ({
  status: 'ok',
  service: 'agent-gateway',
  agentCore: 'LangGraph',
  edgeProxy: 'agentgateway.dev',
  timestamp: new Date().toISOString(),
}));

// 2. Server-Sent Events (SSE) Stream Endpoint for A2-UI Protocol
fastify.get('/api/a2ui/stream', (request, reply) => {
  const { sessionId } = request.query as { sessionId?: string };
  const sid = sessionId || `sess_${Date.now()}`;

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const listener = (msg: A2UIMessageEnvelope) => {
    reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
  };

  sseClients.set(sid, listener);

  // Send initial handshake acknowledgment
  const ack = createA2UIMessage('A2UI_HANDSHAKE_ACK', sid, {
    status: 'connected',
    supportedProtocols: ['AG-UI/1.0', 'A2-UI/1.0'],
    sessionId: sid,
  });
  reply.raw.write(`data: ${JSON.stringify(ack)}\n\n`);

  request.raw.on('close', () => {
    sseClients.delete(sid);
  });
});

// 3. User Intent Ingestion
fastify.post('/api/a2ui/intent', async (request, reply) => {
  const body = request.body as { sessionId: string; text: string; handshake?: A2UIHandshakePayload };
  if (!body.sessionId || !body.text) {
    return reply.status(400).send({ error: 'sessionId and text are required' });
  }

  const session = getOrCreateSession(body.sessionId);
  const clientBroadcaster = sseClients.get(body.sessionId);

  // Stream intermediate thought deltas
  const onDelta = (text: string) => {
    if (clientBroadcaster) {
      clientBroadcaster(
        createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
          phase: 'REASONING',
          text,
        })
      );
    }
  };

  const updatedState = await SuperAppAgentGraph.executeIntent(session, body.text, onDelta);

  // Broadcast AG-UI render surface
  if (updatedState.currentSurface && clientBroadcaster) {
    clientBroadcaster(
      createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE',
        surface: updatedState.currentSurface,
      })
    );
  }

  return { success: true, activeDomain: updatedState.activeDomain };
});

// 4. Interactive Action Dispatch (User tapped button or choice in AG-UI)
fastify.post('/api/a2ui/action', async (request, reply) => {
  const body = request.body as { sessionId: string; action: string; payload: Record<string, any> };
  if (!body.sessionId || !body.action) {
    return reply.status(400).send({ error: 'sessionId and action are required' });
  }

  const session = getOrCreateSession(body.sessionId);
  const clientBroadcaster = sseClients.get(body.sessionId);

  const onDelta = (text: string) => {
    if (clientBroadcaster) {
      clientBroadcaster(
        createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
          phase: 'TOOL_EXECUTION',
          text,
        })
      );
    }
  };

  const updatedState = await SuperAppAgentGraph.resumeWithAction(
    session,
    body.action,
    body.payload || {},
    onDelta
  );

  if (updatedState.currentSurface && clientBroadcaster) {
    clientBroadcaster(
      createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE',
        surface: updatedState.currentSurface,
      })
    );
  }

  return { success: true, surface: updatedState.currentSurface };
});

const PORT = parseInt(process.env.PORT || '4000', 10);
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 SuperApp Agent Gateway listening on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
