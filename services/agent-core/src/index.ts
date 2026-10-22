import http from 'node:http';
import {
  createA2UIMessage,
  type A2UIHandshakePayload,
  type A2UIMessageEnvelope,
} from '../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';
import { SuperAppAgentGraph } from './langgraph/graph.ts';
import { verifyKeycloakToken } from './auth.ts';

// In-Memory Session and SSE Subscriber Registry
export const sessions = new Map<string, SuperAppAgentState>();
export const sseClients = new Map<string, (msg: A2UIMessageEnvelope) => void>();

export function getOrCreateSession(sessionId: string): SuperAppAgentState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      activeDomain: 'concierge',
    });
  }
  return sessions.get(sessionId)!;
}

export async function executeGatewayRequest(
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  body: any = {},
  headers: Record<string, string | undefined> = {}
): Promise<{ status: number; data: any }> {
  const normMethod = method.toUpperCase();

  // 1. Healthcheck (public, no auth required)
  if (normMethod === 'GET' && pathname === '/health') {
    return {
      status: 200,
      data: {
        status: 'ok',
        service: 'agent-core',
        agentCore: 'LangGraph',
        edgeProxy: 'agentgateway.dev',
        activeSessions: sessions.size,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Keycloak OIDC Authentication & Security Check
  const authHeader = headers['authorization'] || headers['Authorization'];
  const authResult = verifyKeycloakToken(authHeader);
  if (!authResult.authenticated) {
    return {
      status: authResult.statusCode || 401,
      data: {
        error: authResult.error || 'Authentication required',
        authenticated: false,
      },
    };
  }

  // 2. User Intent Ingestion
  if (normMethod === 'POST' && pathname === '/api/a2ui/intent') {
    if (!body.sessionId || !body.text) {
      return { status: 400, data: { error: 'sessionId and text are required' } };
    }

    const session = getOrCreateSession(body.sessionId);
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const clientBroadcaster = sseClients.get(body.sessionId);

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

    if (updatedState.currentSurface && clientBroadcaster) {
      clientBroadcaster(
        createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
          mode: 'REPLACE',
          surface: updatedState.currentSurface,
        })
      );
    }

    return {
      status: 200,
      data: {
        success: true,
        activeDomain: updatedState.activeDomain,
        surface: updatedState.currentSurface,
      },
    };
  }

  // 3. Interactive Action Dispatch
  if (normMethod === 'POST' && pathname === '/api/a2ui/action') {
    if (!body.sessionId || !body.action) {
      return { status: 400, data: { error: 'sessionId and action are required' } };
    }

    const session = getOrCreateSession(body.sessionId);
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
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

    return {
      status: 200,
      data: {
        success: true,
        surface: updatedState.currentSurface,
      },
    };
  }

  return { status: 404, data: { error: 'Not found', path: pathname } };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // SSE Stream Endpoint
  if (method === 'GET' && url.pathname === '/api/a2ui/stream') {
    const authHeader = (req.headers['authorization'] as string) || (url.searchParams.get('token') ? `Bearer ${url.searchParams.get('token')}` : undefined);
    const authResult = verifyKeycloakToken(authHeader);
    if (!authResult.authenticated) {
      sendJson(res, authResult.statusCode || 401, { error: authResult.error, authenticated: false });
      return;
    }

    const sid = url.searchParams.get('sessionId') || `sess_${Date.now()}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const listener = (msg: A2UIMessageEnvelope) => {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    };

    sseClients.set(sid, listener);

    // Initial handshake ACK
    const ack = createA2UIMessage('A2UI_HANDSHAKE_ACK', sid, {
      status: 'connected',
      supportedProtocols: ['AG-UI/1.0', 'A2-UI/1.0'],
      sessionId: sid,
      user: authResult.user,
    });
    res.write(`data: ${JSON.stringify(ack)}\n\n`);

    req.on('close', () => {
      sseClients.delete(sid);
    });
    return;
  }

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const headers = req.headers as Record<string, string | undefined>;

  if (method === 'POST') {
    let bodyText = '';
    req.on('data', (chunk) => (bodyText += chunk));
    req.on('end', async () => {
      try {
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await executeGatewayRequest(method, url.pathname, query, body, headers);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = await executeGatewayRequest(method, url.pathname, query, {}, headers);
    sendJson(res, result.status, result.data);
  }
});

export const executeCoreRequest = executeGatewayRequest;

const PORT = parseInt(process.env.PORT || '4000', 10);
if (process.argv[1]?.endsWith('agent-core/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SuperApp Agent Core listening on port ${PORT}`);
  });
}
