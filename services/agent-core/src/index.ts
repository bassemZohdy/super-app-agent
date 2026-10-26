import { shutdownOnSignal } from '../../../packages/backend-kit/src/shutdown.ts';
import { Telemetry,correlation,enrichCorrelation,operationalEvent } from '../../../packages/backend-kit/src/observability.ts';
import { handlePaymentAccounts } from './payment-accounts.ts';
import { EligibilityClient,EligibilityReadError,eligibilityEnforced } from '../../../packages/backend-kit/src/eligibility-client.ts';
import { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import { cancelSurfacePayment } from './payment-surfaces.ts';
import { manualServices } from './manual-services.ts';
import { proxyDelegation } from '../../../packages/backend-kit/src/delegation-proxy.ts';
import { HttpPolicy, HttpError, readJsonBody } from '../../../packages/backend-kit/src/http-policy.ts';
import { handleMcp } from './mcp.ts';
import { issueApproval, actionIsApproved, actionIsDisabled, recordApproval } from './approvals.ts';
import { actorContext, actorFor, accountIdFor } from '../../../packages/backend-kit/src/context.ts';
import { redisSessions, SessionError } from './session-store.ts';
import { randomUUID } from 'node:crypto';
import { trackDomainOperations, executionOutcome, DomainOperationError, callDomainAsync, type Step } from './domain-operations.ts';
import { validateRequest } from '../../../packages/protocol-core/src/request-validation.ts';
import http from 'node:http';
import { EventJournal, StreamWriter, eventFrame } from './event-stream.ts';
import {
  createA2UIMessage,
  type A2UIMessageEnvelope,
} from '../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';
import { executeRuntimeIntent, executeRuntimeAction, discardRuntime } from './langgraph/runtime.ts';
import { sessionLimitsFromEnv } from './session-limits.ts';
import { verifyKeycloakToken, isDemoAuthEnabled } from './auth.ts';
import { conversationModelStatus } from './conversation-model.ts';
import { voiceConfig, localSpeech, localTranscription } from './local-voice.ts';

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
const activeTransitions = new Set<string>();
const sessionLimits = sessionLimitsFromEnv();
/** Admits an in-memory conversation for its owner, evicting this owner's idle ones first; false means every candidate is busy. */
function admitSession(sessionId: string, sub: string): boolean {
  const admitted = sessionLimits.admit(sessionId, sub, id => activeTransitions.has(id));
  if (!admitted) return false;
  for (const id of admitted.evicted) { const state = sessions.get(id); sessions.delete(id); sessionOwners.delete(id); if (state) void discardRuntime(state).catch(() => {}); }
  return true;
}
const sessionLimitReply = { success: false, code: 'SESSION_LIMIT_REACHED', error: 'Too many conversations are running. Wait for one to finish.' };
const eligibilityReader=new EligibilityClient(),accountReader=new ProviderClient('service-wallet',process.env.SERVICE_WALLET_CLIENT_SECRET||'demo-wallet-secret');
type RequestContext = { session?: SuperAppAgentState; release?: () => void | Promise<void>; save?: () => Promise<void>; assertLease?: () => Promise<void> };

function commitSurface(session: SuperAppAgentState) {
  const surface = session.currentSurface;
  if (!surface) return;
  surface.revision = randomUUID();
  issueApproval(session);
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
  const delegated = await proxyDelegation(normMethod, pathname, body, headers.authorization || headers.Authorization);
  if (delegated) return delegated;
  const invalid = validateRequest('agent-core', normMethod, pathname, query, body);
  if (invalid) return invalid;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, data: { error: 'Request body must be a JSON object' } };
  }

  // 1. Healthcheck (public, no auth required)
  if (normMethod === 'GET' && pathname === '/health') {
    const [model, speech] = await Promise.all([conversationModelStatus(), voiceConfig()]);
    return {
      status: 200,
      data: {
        status: 'ok',
        service: 'agent-core',
        llm: model,
        voice: speech,
        agentCore: 'langgraph-bounded-demo',
        edgeProxy: 'direct-http',
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
  actor.requestId=correlation()?.requestId||actor.requestId;
  if(normMethod==='GET'&&pathname==='/api/accounts'&&eligibilityEnforced())return {status:200,data:{...await accountReader.call('payments',actor,'GET','/v1/accounts'),user:authResult.user}};
  if(eligibilityEnforced()&&pathname!=='/api/payments/eligibility'){
    try{actor.eligibilityEpoch=(await eligibilityReader.require(actor)).epoch;}
    catch(e){return {status:e instanceof EligibilityReadError&&[403,409].includes(e.status)?e.status:503,data:{success:false,code:e instanceof EligibilityReadError&&e.status===403?'ACCOUNT_RESTRICTED':'ELIGIBILITY_UNAVAILABLE',error:'Current owner or workspace membership prevents access. History is retained.'}};}
  }
  const paymentAccounts = await handlePaymentAccounts(actor, normMethod, pathname, normMethod==='GET'?query:body);
  if (paymentAccounts) return paymentAccounts;
  if (normMethod === 'GET' && pathname === '/api/services') return { status: 200, data: { success: true, services: manualServices.map(({ id, name }) => ({ id, name, route: `/services/${id}`, version: '1.0.0', runtime: 'bundled-surface' })) } };
  if (normMethod === 'GET' && pathname === '/api/accounts') {
    const accounts = process.env.PROVIDER_INTEGRATION === 'true'
      ? (await actorContext.run(actor, () => callDomainAsync('profile', 'GET', '/accounts'))).data.accounts
      : [{ id: accountIdFor(actor.sub), label: 'Personal account' }, { id: accountIdFor(actor.sub, 'household'), label: 'Household account' }];
    return { status: 200, data: { success: true, accounts, user: authResult.user } };
  }
  if (normMethod === 'GET' && pathname === '/api/sessions') {
    const persistent = redisSessions();
    let items=persistent?await persistent.list(actor.sub):[...sessions.values()].filter(s=>sessionOwners.get(s.sessionId)===actor.sub).map(s=>({sessionId:s.sessionId,accountId:s.metadata?.accountId,title:s.messages.find(m=>m.role==='user')?.content.slice(0,80)||'New conversation'}));
    if(eligibilityEnforced()){const allowed=new Set<string>();for(const id of new Set(items.map(s=>s.accountId).filter(Boolean))){try{await eligibilityReader.require({...actor,accountId:id,eligibilityEpoch:undefined});allowed.add(id);}catch(e){if(!(e instanceof EligibilityReadError)||e.status!==403)throw e;}}items=items.filter(s=>allowed.has(s.accountId));}
    return {status:200,data:{success:true,sessions:items}};
  }
  const sessionPath = /^\/api\/sessions\/([a-zA-Z0-9_-]{8,128})$/.exec(pathname);
  if (sessionPath && (normMethod === 'GET' || normMethod === 'DELETE')) {
    const sid = sessionPath[1], persistent = redisSessions();
    if (persistent) {
      if (normMethod === 'DELETE') { const record = await persistent.read(sid, actor.sub);if(eligibilityEnforced())await eligibilityReader.require({...actor,accountId:record.accountId,eligibilityEpoch:undefined}); await persistent.remove(sid, actor.sub); await discardRuntime(record.state); return { status: 200, data: { success: true } }; }
      const record = await persistent.read(sid, actor.sub);
      if(eligibilityEnforced())await eligibilityReader.require({...actor,accountId:record.accountId,eligibilityEpoch:undefined});
      return { status: 200, data: { success: true, sessionId: sid, accountId: record.accountId, messages: record.state.messages, surface: record.state.currentSurface, serviceId:record.state.metadata?.manualService, inference: record.state.metadata?.inference, runtime: record.state.metadata?.runtime, approval: record.state.approval, approvalHistory: record.state.approvalHistory } };
    }
    if (!sessions.has(sid)) return { status: 404, data: { error: 'Session not found' } };
    if (sessionOwners.get(sid) !== actor.sub) return { status: 403, data: { error: 'Session belongs to a different user' } };
    const state = sessions.get(sid)!;
    if(eligibilityEnforced())await eligibilityReader.require({...actor,accountId:state.metadata?.accountId||accountId,eligibilityEpoch:undefined});
    if (normMethod === 'DELETE') { if (activeTransitions.has(sid)) return { status: 409, data: { error: 'Session busy' } }; await discardRuntime(state); sessions.delete(sid); sessionOwners.delete(sid); sessionLimits.forget(sid); return { status: 200, data: { success: true } }; }
    return { status: 200, data: { success: true, sessionId: sid, accountId: state.metadata?.accountId, messages: state.messages, surface: state.currentSurface, serviceId:state.metadata?.manualService, inference: state.metadata?.inference, runtime: state.metadata?.runtime, approval: state.approval, approvalHistory: state.approvalHistory } };
  }
  // Hold ownership and coordination through persistence and the final event.
  if (normMethod === 'POST' && ['/api/a2ui/intent', '/api/a2ui/action', '/api/a2ui/cancel', '/api/manual/prepare'].includes(pathname)) {
    const persistent = redisSessions();
    let session: SuperAppAgentState;
    if (persistent) {
      // Claim ownership before acquiring; load authoritative state again under the lock.
      await persistent.claim(body.sessionId, actor.sub, accountId, pathname.endsWith('/intent') || pathname.endsWith('/prepare'));
      const lock = await persistent.acquire(body.sessionId);
      requestContext.release = lock.release;
      session = await persistent.claim(body.sessionId, actor.sub, accountId, false);
      requestContext.save = () => lock.save(session);
      requestContext.assertLease = lock.assert;
    } else {
      if ((pathname.endsWith('/action') || pathname.endsWith('/cancel')) && !sessions.has(body.sessionId)) return { status: 404, data: { error: 'Session not found' } };
      if (!admitSession(body.sessionId, actor.sub)) return { status: 429, data: sessionLimitReply };
      if (!ownsSession(body.sessionId, actor.sub)) return { status: 403, data: { error: 'Session belongs to a different user' } };
      if (activeTransitions.has(body.sessionId)) return { status: 409, data: { success: false, code: 'SESSION_BUSY', error: 'A request is already running. Wait for its result before retrying.', retry: { allowed: false, next: 'wait' } } };
      activeTransitions.add(body.sessionId);
      requestContext.release = () => { activeTransitions.delete(body.sessionId); };
      session = getOrCreateSession(body.sessionId);
      if (session.metadata?.accountId && session.metadata.accountId !== accountId) return { status: 409, data: { success: false, code: 'SESSION_ACCOUNT_MISMATCH', error: 'Start a new conversation when switching accounts.' } };
    }
    if(eligibilityEnforced()&&pathname!=='/api/a2ui/cancel'&&(pathname==='/api/a2ui/action'||session.paymentFlow)&&(session.metadata?.eligibilityEpoch||'1:1')!==actor.eligibilityEpoch)return {status:409,data:{success:false,code:'ELIGIBILITY_CHANGED',error:'Owner or workspace permission changed. Cancel the original review and start a new conversation.'}};
    session.metadata = { ...session.metadata, accountId,...(actor.eligibilityEpoch?{eligibilityEpoch:actor.eligibilityEpoch}:{}) };
    requestContext.session = session;
    enrichCorrelation({workflowId:session.sessionId,approvalId:session.approval?.id});
    if (session.reconciliation) return { status: 409, data: { success: false, code: 'RECONCILIATION_REQUIRED', error: 'Reconcile the previous journey before submitting more requests in this session.', outcome: session.reconciliation.outcome, steps: session.reconciliation.steps, retry: { allowed: false, next: 'reconcile' }, surface: session.currentSurface } };
    actor.assertLease = requestContext.assertLease;
    if (body.surfaceRevision) actor.requestId = `${body.surfaceRevision}:${body.action}`;
  }

  // 2. User Intent Ingestion
  if (normMethod === 'POST' && ['/api/a2ui/intent','/api/manual/prepare'].includes(pathname)) {
    const session = requestContext.session!;
    if(session.paymentFlow){
      const cancel=/^(cancel|cancel that|never mind|nevermind|stop|إلغاء)[.!?]*$/i.test(String(body.text||'').trim());
      if(cancel){
        await discardRuntime(session);await cancelSurfacePayment(session,actor);commitSurface(session);
        await broadcast(session.sessionId,createA2UIMessage('A2UI_RENDER_SURFACE',session.sessionId,{mode:'REPLACE',surface:session.currentSurface}));
        return {status:session.paymentFlow?409:200,data:{success:!session.paymentFlow,...(session.paymentFlow?{error:'Cancellation was not confirmed. Inspect the original payment.'}:{}),surface:session.currentSurface}};
      }
      if(pathname==='/api/manual/prepare'||!/^(hi|hello|hey|marhaba|thanks|thank you|yes|yes please|ok|okay|confirm|confirm it|go ahead|do it|pay it|نعم|explain(?: this| that| it)?|tell me more|what happens next|what am i confirming|how much is (?:it|that)|what is (?:this|that|the status))[.!?]*$/i.test(String(body.text||'').trim()))return {status:409,data:{success:false,code:'PAYMENT_REVIEW_OPEN',error:'Finish, inspect or cancel the original payment review before opening another service.',surface:session.currentSurface}};
    }
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const onDelta = (text: string) =>
      void broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      })).catch(() => {});

    const updatedState = await actorContext.run(actor, () => executeRuntimeIntent(session, body.text || 'Open service', onDelta, pathname === '/api/manual/prepare' ? body.serviceId : undefined));

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

  if (normMethod === 'POST' && pathname === '/api/a2ui/cancel') {
    const state = requestContext.session!;
    if (!state.approval || state.currentSurface?.revision !== body.surfaceRevision) return { status: 409, data: { error: 'Approval is no longer pending', code: 'STALE_SURFACE' } };
    if(state.paymentFlow){
      await discardRuntime(state);await cancelSurfacePayment(state,actor);if(!state.paymentFlow)recordApproval(state,'cancelled');commitSurface(state);
      await broadcast(state.sessionId,createA2UIMessage('A2UI_RENDER_SURFACE',state.sessionId,{mode:'REPLACE',surface:state.currentSurface}));
      return {status:state.paymentFlow?409:200,data:{success:!state.paymentFlow,...(state.paymentFlow?{error:'Cancellation was not confirmed. Inspect the original payment.'}:{}),surface:state.currentSurface}};
    }
    recordApproval(state, 'cancelled');
    await discardRuntime(state);
    state.metadata = { ...state.metadata, runtime: { version: 1, status: 'cancelled' } };
    state.currentSurface = { version: '1.0.0', sessionId: state.sessionId, timestamp: Date.now(), view: {
      type: 'Text', id: 'approval_cancelled', properties: { text: 'Approval cancelled. No service action was started.' },
    } };
    state.messages.push({ id: randomUUID(), role: 'assistant', content: 'Approval cancelled. No service action was started.', timestamp: Date.now() });
    commitSurface(state);
    await broadcast(state.sessionId, createA2UIMessage('A2UI_RENDER_SURFACE', state.sessionId, { mode: 'REPLACE', surface: state.currentSurface }));
    return { status: 200, data: { success: true, surface: state.currentSurface } };
  }

  // 3. Interactive Action Dispatch
  if (normMethod === 'POST' && pathname === '/api/a2ui/action') {
    const session = requestContext.session!;
    if (body.surfaceRevision !== session.currentSurface?.revision) {
      return { status: 409, data: { success: false, code: 'STALE_SURFACE',
        error: 'This surface has been replaced. Review the current surface before acting.',
        retry: { allowed: false, next: 'refresh_surface' }, surface: session.currentSurface } };
    }
    if (!actionIsApproved(session, body.action, body.payload || {}, actor.sub, accountId)) {
      if (actionIsDisabled(session, body.action)) {
        return { status: 409, data: { success: false, code: 'ACTION_DISABLED',
          error: 'This action is disabled for the current review state.', surface: session.currentSurface } };
      }
      return { status: 403, data: { error: 'Action is not authorized for the current UI surface' } };
    }
    if (authResult.user) {
      (session as any).user = authResult.user;
    }
    const onDelta = (text: string) =>
      void broadcast(body.sessionId, createA2UIMessage('A2UI_STREAM_DELTA', body.sessionId, {
        phase: 'TOOL_EXECUTION', text,
      })).catch(() => {});

    recordApproval(session, 'confirmed', body.action);
    const updatedState = await actorContext.run(actor, () => executeRuntimeAction(
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

  if (normMethod === 'GET' && pathname === '/api/voice/config') return { status: 200, data: { success: true, ...await voiceConfig() } };
  if (normMethod === 'POST' && pathname === '/api/voice/transcribe') {
    try { return { status: 200, data: await localTranscription(actor.sub, body) }; }
    catch (e) { return { status: e instanceof HttpError ? e.status : 503, data: { success: false, error: e instanceof HttpError ? e.message : 'Local dictation unavailable.' } }; }
  }
  // Local open-source speech only. This path never calls a hosted audio provider.
  if (normMethod === 'POST' && pathname === '/api/a2ui/tts') {
    try { return { status: 200, data: await localSpeech(actor.sub, body) }; }
    catch (e) { return { status: e instanceof HttpError ? e.status : 503, data: { success: false, available: false, error: e instanceof HttpError ? e.message : 'Local speech unavailable.' } }; }
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
    if(error instanceof EligibilityReadError)return {status:[403,409].includes(error.status)?error.status:503,data:{success:false,code:'ELIGIBILITY_DENIED',error:'Current owner or workspace membership prevents access. History is retained.'}};
    if (error instanceof SessionError) return { status: error.status, data: { success: false, code: error.code, error: error.message } };
    // A deliberately raised HttpError is our own controlled user-facing rejection, not an upstream detail.
    if (error instanceof HttpError) return { status: error.status, data: { success: false, code: 'REQUEST_REJECTED', error: error.message } };
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

const httpPolicy = new HttpPolicy();
const telemetry=new Telemetry('agent-core');
export const server = http.createServer({ maxHeaderSize: 16384 }, telemetry.handler(async (req, res) => {
  try {
  const release = httpPolicy.admit(req.socket.remoteAddress || 'unknown');
  res.once('close', release); res.once('finish', release);
  if ((req.url?.length || 0) > 4096) throw new HttpError(414, 'Request URL too long');
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

  if (url.pathname === '/mcp') { await handleMcp(req, res, executeGatewayRequest); return; }

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
    const streamActor=actorFor(authResult.user!,streamAccount,authHeader);
    if(eligibilityEnforced())try{await eligibilityReader.require(streamActor);}catch(e){sendJson(req,res,e instanceof EligibilityReadError&&e.status===403?403:503,{code:'ELIGIBILITY_DENIED',error:'Current owner or workspace membership prevents this stream.'});return;}
    if(!persistent&&sessions.get(sid)?.metadata?.accountId&&sessions.get(sid)!.metadata!.accountId!==streamAccount){sendJson(req,res,403,{error:'This conversation belongs to another workspace.'});return;}
    try { if (persistent) persistentState = await persistent.claim(sid, authResult.user!.sub, streamAccount); }
    catch (error) { sendJson(req, res, error instanceof SessionError ? error.status : 503, { error: 'Session unavailable or not owned by this user' }); return; }
    if (!persistent && !admitSession(sid, authResult.user!.sub)) { sendJson(req, res, 429, sessionLimitReply); return; }
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
    let delivery=Promise.resolve(),pendingMessages=0;
    const listener = (msg: A2UIMessageEnvelope) => {if(res.writableEnded)return;if(pendingMessages>=32){operationalEvent('sse_backpressure');res.end();return;}pendingMessages++;delivery=delivery.then(async()=>{if(res.writableEnded)return;if(eligibilityEnforced()){const verified=await verifyKeycloakToken(authHeader);if(!verified.authenticated)throw Error('Identity inactive');await eligibilityReader.require(streamActor);}writer.send(eventFrame(msg));}).catch(()=>{res.end();}).finally(()=>{pendingMessages--;});};
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
      if (surface) listener(createA2UIMessage('A2UI_RENDER_SURFACE', sid, {
        mode: 'REPLACE', surface,
      }));
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

  const body = method === 'POST' ? await readJsonBody(req) : {};
  const result = await executeGatewayRequest(method, url.pathname, query, body, headers);
  sendJson(req, res, result.status, result.data);
  } catch (error) {
    if (res.headersSent) res.end();
    else {
      res.setHeader('Connection', 'close');
      sendJson(req, res, error instanceof HttpError ? error.status : 503,
        { success: false, error: error instanceof HttpError ? error.message : 'Session or request service unavailable.' });
    }
  }
},{ready:async()=>{const persistent=redisSessions();if(persistent){await persistent.connect();await persistent.client.ping();}}}));
server.once('close',()=>telemetry.close());

server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;

export const executeCoreRequest = executeGatewayRequest;

const PORT = parseInt(process.env.PORT || '4000', 10);
if (process.argv[1]?.endsWith('agent-core/src/index.ts')) {
  shutdownOnSignal(server,()=>redisSessions()?.close());
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SuperApp Agent Core listening on port ${PORT}`);
  });
}

