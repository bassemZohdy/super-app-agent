import http from 'node:http';
import {
  createA2UIMessage,
  type A2UIHandshakePayload,
  type A2UIMessageEnvelope,
} from '../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';
import { SuperAppAgentGraph } from './langgraph/graph.ts';
import { verifyKeycloakToken, isDemoAuthEnabled } from './auth.ts';

// In-Memory Session and SSE Subscriber Registry
export const sessions = new Map<string, SuperAppAgentState>();
const sessionOwners = new Map<string, string>();
export const sseClients = new Map<string, Set<(msg: A2UIMessageEnvelope) => void>>();
function broadcast(sessionId: string, msg: A2UIMessageEnvelope) {
  for (const listener of sseClients.get(sessionId) || []) listener(msg);
}
function ownsSession(sessionId: string, sub: string): boolean {
  const owner = sessionOwners.get(sessionId);
  if (owner && owner !== sub) return false;
  sessionOwners.set(sessionId, sub);
  return true;
}
// An allowed action is not permission to change financial or resource values.
function isSurfaceActionAllowed(state: SuperAppAgentState, action: string, payload: Record<string, any>): boolean {
  if (!state.currentSurface) return false;
  const bindings: Array<Record<string, any>> = [];
  const choices = new Set<string>();
  const walk = (node: any) => {
    if (node.type === 'ChoiceGroup') {
      for (const option of node.properties?.options || []) choices.add(option.id);
    }
    for (const event of node.onEvents || []) {
      if (event.actionType === 'AGENT_ACTION_DISPATCH' && event.payload?.action === action) {
        bindings.push(event.payload);
      }
    }
    for (const child of node.children || []) walk(child);
  };
  walk(state.currentSurface.view);
  if (payload.selectedChoice !== undefined && !choices.has(payload.selectedChoice)) return false;
  const protectedFields = ['amount', 'durationHours', 'zoneId', 'plateNumber', 'ticketId'];
  return bindings.some(binding => protectedFields.every(field =>
    payload[field] === undefined || (binding[field] !== undefined &&
      JSON.stringify(payload[field]) === JSON.stringify(binding[field]))
  ));
}
const consumedActions = new Set<string>();

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
  const authResult = await verifyKeycloakToken(authHeader);
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
    if (typeof body.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.sessionId) ||
        typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) {
      return { status: 400, data: { error: 'Invalid sessionId or text (max 4000 characters)' } };
    }
    if (!ownsSession(body.sessionId, authResult.user!.sub)) {
      return { status: 403, data: { error: 'Session belongs to a different user' } };
    }
    const session = getOrCreateSession(body.sessionId);
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const onDelta = (text: string) =>
      broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      }));

    const updatedState = await SuperAppAgentGraph.executeIntent(session, body.text, onDelta);

    if (updatedState.currentSurface) {
      broadcast(body.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE', surface: updatedState.currentSurface,
      }));
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
    if (typeof body.sessionId !== 'string' || typeof body.action !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(body.sessionId)) {
      return { status: 400, data: { error: 'Valid sessionId and action are required' } };
    }
    if (!sessions.has(body.sessionId)) {
      return { status: 404, data: { error: 'Session not found' } };
    }
    if (!ownsSession(body.sessionId, authResult.user!.sub)) {
      return { status: 403, data: { error: 'Session belongs to a different user' } };
    }
    const session = getOrCreateSession(body.sessionId);
    if (!isSurfaceActionAllowed(session, body.action, body.payload || {})) {
      return { status: 403, data: { error: 'Action is not authorized for the current UI surface' } };
    }
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
      return { status: 400, data: { error: 'Invalid action payload' } };
    }
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    // Prevent accidental double execution of the same surface action in this process.
    // Durable idempotency remains the responsibility of the transactional service.
    const actionKey = body.sessionId + ':' + session.currentSurface!.timestamp + ':' + body.action;
    if (consumedActions.has(actionKey)) {
      return { status: 409, data: { error: 'Action already submitted for this surface' } };
    }
    consumedActions.add(actionKey);
    const onDelta = (text: string) =>
      broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      }));

    const updatedState = await SuperAppAgentGraph.resumeWithAction(
      session,
      body.action,
      body.payload || {},
      onDelta
    );

    if (updatedState.currentSurface) {
      broadcast(body.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE', surface: updatedState.currentSurface,
      }));
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

function allowedOrigin(requestOrigin: string | undefined): string {
  const allowed = (process.env.CORS_ORIGINS ||
    'http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .split(',').map(value => value.trim());
  return requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : 'null';
}
function sendJson(req: http.IncomingMessage, res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin(req.headers.origin),
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
      'Access-Control-Allow-Origin': allowedOrigin(req.headers.origin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // SSE Stream Endpoint
  if (method === 'GET' && url.pathname === '/api/a2ui/stream') {
    // Native EventSource has no Authorization header. Demo mode uses an explicit
    // switch; production clients must use an authenticated fetch-based SSE reader.
    const demo = isDemoAuthEnabled() && url.searchParams.get('demo') === '1';
    const authHeader = (req.headers['authorization'] as string | undefined) ||
      (demo ? 'Bearer demo-local' : undefined);
    const authResult = await verifyKeycloakToken(authHeader);
    if (!authResult.authenticated) {
      sendJson(req, authResult.statusCode || 401, { error: authResult.error, authenticated: false });
      return;
    }

    const sid = url.searchParams.get('sessionId');
    if (!sid || !/^[a-zA-Z0-9_-]{8,128}$/.test(sid)) {
      sendJson(req, 400, { error: 'Valid sessionId is required' });
      return;
    }
    if (!ownsSession(sid, authResult.user!.sub)) {
      sendJson(req, 403, { error: 'Session belongs to a different user' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigin(req.headers.origin),
    });

    const listener = (msg: A2UIMessageEnvelope) => {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    };

    const subscribers = sseClients.get(sid) || new Set();
    subscribers.add(listener);
    sseClients.set(sid, subscribers);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 20_000);

    // Initial handshake ACK
    const ack = createA2UIMessage('A2UI_HANDSHAKE_ACK', sid, {
      status: 'connected',
      supportedProtocols: ['AG-UI/1.0', 'A2-UI/1.0'],
      sessionId: sid,
      user: authResult.user,
    });
    res.write(`data: ${JSON.stringify(ack)}\n\n`);

    req.on('close', () => {
      clearInterval(heartbeat);
      subscribers.delete(listener);
      if (!subscribers.size) sseClients.delete(sid);
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
    req.on('data', (chunk) => {
      bodyText += chunk;
      if (bodyText.length > 1_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = await executeGatewayRequest(method, url.pathname, query, body, headers);
        sendJson(req, result.status, result.data);
      } catch (e: any) {
        sendJson(req, e instanceof SyntaxError ? 400 : 500, {
          error: e instanceof SyntaxError ? 'Invalid JSON body' : 'Request processing failed',
        });
      }
    });
  } else {
    const result = await executeGatewayRequest(method, url.pathname, query, {}, headers);
    sendJson(req, result.status, result.data);
  }
});

export const executeCoreRequest = executeGatewayRequest;

const PORT = parseInt(process.env.PORT || '4000', 10);
if (process.argv[1]?.endsWith('agent-core/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SuperApp Agent Core listening on port ${PORT}`);
  });
}
