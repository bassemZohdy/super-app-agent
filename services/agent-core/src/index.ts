import { actorContext, actorFor, accountIdFor } from '../../../packages/backend-kit/src/context.ts';
import { redisSessions, SessionError } from './session-store.ts';
import { randomUUID } from 'node:crypto';
import { trackDomainOperations, executionOutcome, DomainOperationError, callDomainAsync, type Step } from './domain-operations.ts';
import { validateRequest } from '../../../packages/protocol-core/src/request-validation.ts';
import http from 'node:http';
import { EventJournal, StreamWriter, eventFrame } from './event-stream.ts';
import {
  createA2UIMessage,
  type A2UIHandshakePayload,
  type A2UIMessageEnvelope,
} from '../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';
import { SuperAppAgentGraph } from './langgraph/graph.ts';
import { verifyKeycloakToken, isDemoAuthEnabled } from './auth.ts';
import { invokeOpenRouterTTS, getModelStatus } from './openrouter.ts';

// In-Memory Session and SSE Subscriber Registry
export const sessions = new Map<string, SuperAppAgentState>();
const sessionOwners = new Map<string, string>();
export const sseClients = new Map<string, Set<(msg: A2UIMessageEnvelope) => void>>();
export const eventJournal = new EventJournal();
async function broadcast(sessionId: string, msg: A2UIMessageEnvelope) {
  const persistent = redisSessions();
  if (persistent) { await persistent.publish(sessionId, msg); return; }
  eventJournal.append(sessionId, msg);
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
  const protectedFields = ['amount', 'durationHours', 'zoneId', 'plateNumber', 'ticketId', 'provider', 'billId', 'subscriptionId', 'planId'];
  return bindings.some(binding => protectedFields.every(field =>
    payload[field] === undefined || (binding[field] !== undefined &&
      JSON.stringify(payload[field]) === JSON.stringify(binding[field]))
  ));
}
const activeTransitions = new Set<string>();
type RequestContext = { session?: SuperAppAgentState; release?: () => void | Promise<void>; save?: () => Promise<void>; assertLease?: () => Promise<void> };

function commitSurface(session: SuperAppAgentState) {
  const surface = session.currentSurface;
  if (!surface) return;
  surface.revision = randomUUID();
  const latest = session.messages.at(-1);
  if (latest?.role === 'assistant') {
    surface.assistantMessage = { id: surface.revision, text: latest.content.slice(0, 4000) };
  }
}

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

async function handleGatewayRequest(
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  body: any = {},
  headers: Record<string, string | undefined> = {},
  requestContext: RequestContext = {}
): Promise<{ status: number; data: any }> {
  const normMethod = method.toUpperCase();
  const invalid = validateRequest('agent-core', normMethod, pathname, query, body);
  if (invalid) return invalid;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, data: { error: 'Request body must be a JSON object' } };
  }

  // 1. Healthcheck (public, no auth required)
  if (normMethod === 'GET' && pathname === '/health') {
    return {
      status: 200,
      data: {
        status: 'ok',
        service: 'agent-core',
        llm: getModelStatus(),
        agentCore: 'deterministic-demo-router',
        edgeProxy: 'agentgateway.dev',
        activeSessions: process.env.SESSION_STORE === 'redis' ? undefined : sessions.size,
        sessions: { store: process.env.SESSION_STORE || 'memory', ttlSeconds: Number(process.env.SESSION_TTL_SECONDS || 3600) },
        integration: process.env.PROVIDER_INTEGRATION === 'true' ? 'rest-providers' : 'legacy-fixtures',
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (normMethod === 'GET' && pathname === '/api/auth/config') return { status: 200, data: {
    enabled: process.env.PROVIDER_INTEGRATION === 'true' || !isDemoAuthEnabled(),
    issuer: process.env.KEYCLOAK_PUBLIC_ISSUER || process.env.KEYCLOAK_ISSUER,
    clientId: process.env.KEYCLOAK_CLIENT_ID || 'superapp-shell',
  } };

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

  const accountId = body.accountId || query.accountId || accountIdFor(authResult.user!.sub);
  if (![accountIdFor(authResult.user!.sub), accountIdFor(authResult.user!.sub, 'household')].includes(accountId)) {
    return { status: 403, data: { success: false, code: 'ACCOUNT_FORBIDDEN', error: 'This account does not belong to the signed-in user.' } };
  }
  const actor = actorFor(authResult.user!, accountId, authHeader);
  if (normMethod === 'GET' && pathname === '/api/accounts') {
    const accounts = process.env.PROVIDER_INTEGRATION === 'true'
      ? (await actorContext.run(actor, () => callDomainAsync('profile', 'GET', '/accounts'))).data.accounts
      : [{ id: accountIdFor(actor.sub), label: 'Personal account' }, { id: accountIdFor(actor.sub, 'household'), label: 'Household account' }];
    return { status: 200, data: { success: true, accounts, user: authResult.user } };
  }
  if (normMethod === 'GET' && pathname === '/api/sessions') {
    const persistent = redisSessions();
    return { status: 200, data: { success: true, sessions: persistent ? await persistent.list(actor.sub) : [...sessions.values()].filter(s => sessionOwners.get(s.sessionId) === actor.sub).map(s => ({ sessionId: s.sessionId, accountId: s.metadata?.accountId, title: s.messages.find(m => m.role === 'user')?.content.slice(0,80) || 'New conversation' })) } };
  }
  const sessionPath = /^\/api\/sessions\/([a-zA-Z0-9_-]{8,128})$/.exec(pathname);
  if (sessionPath && (normMethod === 'GET' || normMethod === 'DELETE')) {
    const sid = sessionPath[1], persistent = redisSessions();
    if (persistent) {
      if (normMethod === 'DELETE') { await persistent.remove(sid, actor.sub); return { status: 200, data: { success: true } }; }
      const record = await persistent.read(sid, actor.sub);
      return { status: 200, data: { success: true, sessionId: sid, accountId: record.accountId, messages: record.state.messages, surface: record.state.currentSurface } };
    }
    if (!sessions.has(sid)) return { status: 404, data: { error: 'Session not found' } };
    if (sessionOwners.get(sid) !== actor.sub) return { status: 403, data: { error: 'Session belongs to a different user' } };
    if (normMethod === 'DELETE') { if (activeTransitions.has(sid)) return { status: 409, data: { error: 'Session busy' } }; sessions.delete(sid); sessionOwners.delete(sid); return { status: 200, data: { success: true } }; }
    const state = sessions.get(sid)!;
    return { status: 200, data: { success: true, sessionId: sid, accountId: state.metadata?.accountId, messages: state.messages, surface: state.currentSurface } };
  }
  // Hold ownership and coordination through persistence and the final event.
  if (normMethod === 'POST' && ['/api/a2ui/intent', '/api/a2ui/action'].includes(pathname)) {
    const persistent = redisSessions();
    let session: SuperAppAgentState;
    if (persistent) {
      // Claim ownership before acquiring; load authoritative state again under the lock.
      await persistent.claim(body.sessionId, actor.sub, accountId, pathname.endsWith('/intent'));
      const lock = await persistent.acquire(body.sessionId);
      requestContext.release = lock.release;
      session = await persistent.claim(body.sessionId, actor.sub, accountId, false);
      requestContext.save = () => lock.save(session);
      requestContext.assertLease = lock.assert;
    } else {
      if (pathname.endsWith('/action') && !sessions.has(body.sessionId)) return { status: 404, data: { error: 'Session not found' } };
      if (!ownsSession(body.sessionId, actor.sub)) return { status: 403, data: { error: 'Session belongs to a different user' } };
      if (activeTransitions.has(body.sessionId)) return { status: 409, data: { success: false, code: 'SESSION_BUSY', error: 'A request is already running. Wait for its result before retrying.', retry: { allowed: false, next: 'wait' } } };
      activeTransitions.add(body.sessionId);
      requestContext.release = () => { activeTransitions.delete(body.sessionId); };
      session = getOrCreateSession(body.sessionId);
      if (session.metadata?.accountId && session.metadata.accountId !== accountId) return { status: 409, data: { success: false, code: 'SESSION_ACCOUNT_MISMATCH', error: 'Start a new conversation when switching accounts.' } };
    }
    session.metadata = { ...session.metadata, accountId };
    requestContext.session = session;
    if (session.reconciliation) return { status: 409, data: { success: false, code: 'RECONCILIATION_REQUIRED', error: 'Reconcile the previous journey before submitting more requests in this session.', outcome: session.reconciliation.outcome, steps: session.reconciliation.steps, retry: { allowed: false, next: 'reconcile' }, surface: session.currentSurface } };
    actor.assertLease = requestContext.assertLease;
    if (body.surfaceRevision) actor.requestId = `${body.surfaceRevision}:${body.action}`;
  }

  // 2. User Intent Ingestion
  if (normMethod === 'POST' && pathname === '/api/a2ui/intent') {
    const session = requestContext.session!;
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const onDelta = (text: string) =>
      void broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      })).catch(() => {});

    const updatedState = await actorContext.run(actor, () => SuperAppAgentGraph.executeIntent(session, body.text, onDelta));

    if (updatedState.currentSurface) {
      commitSurface(updatedState);
      await broadcast(body.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE', surface: updatedState.currentSurface, outcome: 'SUCCEEDED',
      }));
    }

    return {
      status: 200,
      data: {
        success: true,
        activeDomain: updatedState.activeDomain,
        inference: updatedState.metadata?.inference,
        surface: updatedState.currentSurface,
      },
    };
  }

  // 3. Interactive Action Dispatch
  if (normMethod === 'POST' && pathname === '/api/a2ui/action') {
    const session = requestContext.session!;
    if (body.surfaceRevision !== session.currentSurface?.revision) {
      return { status: 409, data: { success: false, code: 'STALE_SURFACE',
        error: 'This surface has been replaced. Review the current surface before acting.',
        retry: { allowed: false, next: 'refresh_surface' }, surface: session.currentSurface } };
    }
    if (!isSurfaceActionAllowed(session, body.action, body.payload || {})) {
      return { status: 403, data: { error: 'Action is not authorized for the current UI surface' } };
    }
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const onDelta = (text: string) =>
      void broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      })).catch(() => {});

    const updatedState = await actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction(
      session,
      body.action,
      body.payload || {},
      onDelta
    ));

    if (updatedState.currentSurface) {
      commitSurface(updatedState);
      await broadcast(body.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', body.sessionId, {
        mode: 'REPLACE', surface: updatedState.currentSurface, outcome: 'SUCCEEDED',
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

  // 4. OpenRouter Text-to-Speech (Neural Voice Synthesis)
  if (normMethod === 'POST' && pathname === '/api/a2ui/tts') {
    try {
      const audioResult = await invokeOpenRouterTTS(body.text, {
        voice: body.voice,
        language: body.language,
      });
      if (audioResult) {
        return {
          status: 200,
          data: {
            success: true,
            available: true,
            provider: 'openrouter',
            audioBase64: audioResult.audioBase64,
            format: audioResult.format,
            model: audioResult.model,
            voice: audioResult.voice,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: true,
          available: false,
          provider: 'browser_speech_synthesis',
          fallback: true,
          message: 'OpenRouter API key not configured or neural TTS unavailable; using browser speech synthesis.',
        },
      };
    } catch (err: any) {
      return {
        status: 200,
        data: {
          success: true,
          available: false,
          provider: 'browser_speech_synthesis',
          fallback: true,
          error: err?.message || 'Neural TTS failed',
        },
      };
    }
  }

  return { status: 404, data: { error: 'Not found', path: pathname } };
}

/** Domain failures become truthful HTTP/SSE outcomes, never successful receipts. */
export async function executeGatewayRequest(method: string, pathname: string,
  query: Record<string, string> = {}, body: any = {}, headers: Record<string, string | undefined> = {}): Promise<{ status: number; data: any }> {
  const steps: Step[] = [];
  const requestContext: RequestContext = {};
  try {
    const result = await trackDomainOperations(steps, () => handleGatewayRequest(method, pathname, query, body, headers, requestContext));
    return result.data.success === true ? { ...result, data: { ...result.data, outcome: 'SUCCEEDED', steps } } : result;
  }
  catch (error) {
    if (error instanceof SessionError) return { status: error.status, data: { success: false, code: error.code, error: error.message } };
    const outcome = executionOutcome(steps);
    const domainError = error instanceof DomainOperationError;
    const code = outcome === 'UNKNOWN' ? 'DOMAIN_OUTCOME_UNKNOWN'
      : outcome === 'PARTIALLY_COMPLETED' ? 'PARTIAL_EXECUTION'
      : domainError ? error.code : 'EXECUTION_FAILED';
    const status = outcome === 'UNKNOWN' ? 502 : outcome === 'PARTIALLY_COMPLETED' ? 409
      : domainError ? error.statusCode : 500;
    const message = outcome === 'UNKNOWN' ? 'An operation outcome is unknown. Check its status before any retry.'
      : outcome === 'PARTIALLY_COMPLETED' ? 'Some operations completed before the journey stopped. Reconcile them before retrying.'
      : 'The request could not be completed. Review the request or available funds and start a new request.';
    // Deliberately do not return upstream exception strings, payloads or credentials.
    const retry = { allowed: outcome === 'FAILED' && pathname.endsWith('/intent'),
      next: outcome === 'FAILED' ? 'refresh_intent' : 'reconcile' };
    const session = requestContext.session;
    let surface;
    if (session) {
      session.currentSurface = {
        version: '1.0.0', sessionId: session.sessionId, timestamp: Date.now(), revision: randomUUID(),
        view: { type: 'SurfaceCard', id: 'execution_outcome_card', style: { variant: 'warning' }, children: [
          { type: 'Heading', id: 'outcome_heading', properties: { text: outcome === 'FAILED' ? 'Request failed' : 'Journey needs attention' } },
          { type: 'Badge', id: 'outcome_badge', properties: { text: outcome, variant: 'warning' } },
          { type: 'Text', id: 'outcome_message', properties: { text: message } },
        ] },
      };
      if (outcome !== 'FAILED') session.reconciliation = { outcome, steps: steps.map(step => ({ ...step })) };
      surface = session.currentSurface;
      session.messages.push({ id: `failure_${Date.now()}`, role: 'assistant', content: message, timestamp: Date.now() });
      commitSurface(session);
      await broadcast(session.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', session.sessionId, { mode: 'REPLACE', surface, outcome, code, steps, retry }));
    }
    return { status, data: { success: false, error: message, code, outcome, steps, retry, surface } };
  } finally {
    if (requestContext.session && requestContext.session.messages.length > 100) requestContext.session.messages = requestContext.session.messages.slice(-100);
    try { await requestContext.save?.(); } finally { await requestContext.release?.(); }
  }
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
    'Vary': 'Origin',
  });
  res.end(JSON.stringify(data));
}

export const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (req.headers.origin && allowedOrigin(req.headers.origin) === 'null') {
    sendJson(req, res, 403, { error: 'Origin is not allowed' });
    return;
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowedOrigin(req.headers.origin),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
      'Vary': 'Origin',
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
      sendJson(req, res, authResult.statusCode || 401, { error: authResult.error, authenticated: false });
      return;
    }

    const sid = url.searchParams.get('sessionId');
    if (!sid || !/^[a-zA-Z0-9_-]{8,128}$/.test(sid)) {
      sendJson(req, res, 400, { error: 'Valid sessionId is required' });
      return;
    }
    const persistent = redisSessions();
    let persistentState: SuperAppAgentState | undefined;
    const streamAccount = url.searchParams.get('accountId') || accountIdFor(authResult.user!.sub);
    if (![accountIdFor(authResult.user!.sub), accountIdFor(authResult.user!.sub, 'household')].includes(streamAccount)) { sendJson(req, res, 403, { error: 'Account is not owned by this user' }); return; }
    try { if (persistent) persistentState = await persistent.claim(sid, authResult.user!.sub, streamAccount); }
    catch (error) { sendJson(req, res, error instanceof SessionError ? error.status : 503, { error: 'Session unavailable or not owned by this user' }); return; }
    if (!persistent && !ownsSession(sid, authResult.user!.sub)) {
      sendJson(req, res, 403, { error: 'Session belongs to a different user' });
      return;
    }

    const cursor = req.headers['last-event-id'];
    const replay = typeof cursor === 'string' && cursor ? (persistent ? await persistent.after(sid, cursor) : eventJournal.after(sid, cursor)) : [];
    if (replay === undefined) {
      sendJson(req, res, 409, { error: 'Replay cursor expired or unknown', code: 'STREAM_RESET_REQUIRED' });
      return;
    }
    const subscribers = sseClients.get(sid) || new Set();
    if (subscribers.size >= 5) {
      sendJson(req, res, 429, { error: 'Too many streams for this session' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': allowedOrigin(req.headers.origin),
        'Vary': 'Origin',
    });
    const writer = new StreamWriter(res);
    const listener = (msg: A2UIMessageEnvelope) => writer.send(eventFrame(msg));
    const unsubscribe = persistent ? await persistent.subscribe(sid, listener) : undefined;
    subscribers.add(listener);
    sseClients.set(sid, subscribers);
    const heartbeat = setInterval(() => writer.send(': keepalive\n\n'), 20_000);
    // Reauthenticate each connection and close it at token expiry (or after 5 minutes).
    const lifetime = Math.min(300_000, (authResult.user!.expiresAt ?? Date.now() + 300_000) - Date.now());
    const expiry = setTimeout(() => res.end(), Math.max(0, lifetime));
    const ack = createA2UIMessage('A2UI_HANDSHAKE_ACK', sid, {
      status: 'connected', supportedProtocols: ['superapp-custom/1.0'], sessionId: sid,
      user: authResult.user,
    });
    // Handshakes and initial snapshots have no cursor: only journaled events are resumable.
    writer.send(`retry: 1000\ndata: ${JSON.stringify(ack)}\n\n`);
    if (cursor) for (const event of replay) listener(event);
    else {
      const surface = (persistentState || sessions.get(sid))?.currentSurface;
      if (surface) writer.send(`data: ${JSON.stringify(createA2UIMessage('A2UI_RENDER_SURFACE', sid, {
        mode: 'REPLACE', surface,
      }))}\n\n`);
    }
    res.once('close', () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      writer.close();
      void unsubscribe?.().catch(() => {});
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
        sendJson(req, res, result.status, result.data);
      } catch (e: any) {
        sendJson(req, res, e instanceof SyntaxError ? 400 : 500, {
          error: e instanceof SyntaxError ? 'Invalid JSON body' : 'Request processing failed',
        });
      }
    });
  } else {
    const result = await executeGatewayRequest(method, url.pathname, query, {}, headers);
    sendJson(req, res, result.status, result.data);
  }
  } catch { if (res.headersSent) res.end(); else sendJson(req, res, 503, { success: false, error: 'Session or request service unavailable.' }); }
});

export const executeCoreRequest = executeGatewayRequest;

const PORT = parseInt(process.env.PORT || '4000', 10);
if (process.argv[1]?.endsWith('agent-core/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SuperApp Agent Core listening on port ${PORT}`);
  });
}

