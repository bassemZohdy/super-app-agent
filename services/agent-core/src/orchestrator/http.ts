import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AgentError, Decision, Id, Message, Quote, RenewalQuote, authorize, execution, type ExecutionContext } from './contracts.ts';
import { equalSecret, type Authenticator } from './auth.ts';
import type { AgentService } from './service.ts';
import { logEvent } from '../../../../packages/backend-kit/src/redact.ts';
import { corsOrigins } from '../../../../packages/backend-kit/src/local-endpoints.ts';

async function readBody(req: http.IncomingMessage, timeoutMs: number, ignored = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); req.off('data', onData); req.off('end', onEnd);
      if (error) { req.pause(); reject(error); return; }
      if (ignored) { resolve(undefined); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AgentError('INVALID_JSON')); }
    };
    const onData = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8192) finish(new AgentError('BODY_TOO_LARGE', 413)); else if (!ignored) chunks.push(chunk); };
    const onEnd = () => finish();
    const onError = () => finish(new AgentError('BODY_READ_FAILED', 400));
    const timer = setTimeout(() => finish(new AgentError('BODY_READ_TIMEOUT', 408)), timeoutMs);
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError);
    req.once('close', () => req.off('error', onError));
  });
}
export function createServer(service: AgentService, auth: Authenticator, workloadKey: string, options: { bodyTimeoutMs?: number; maxPublicRequests?: number; maxSimulatorRequests?: number } = {}) {
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 10000;
  const maxPublicRequests = options.maxPublicRequests ?? 64, maxSimulatorRequests = options.maxSimulatorRequests ?? 16;
  let publicRequests = 0, simulatorRequests = 0;
  return http.createServer({ requestTimeout: 30000, headersTimeout: 10000 }, (req, res) => {
    const correlationId = randomUUID();
    res.setHeader('X-Correlation-ID', correlationId); res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const run = async () => {
      const origin = req.headers.origin;
      const allowed = corsOrigins();
      if (origin) {
        if (!allowed.includes(origin)) throw new AgentError('ORIGIN_NOT_ALLOWED', 403);
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, Accept');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      }
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/live') return send(200, { live: true });
      if (req.method === 'GET' && path === '/ready') { service.store.ready(); return send(200, { ready: true, dependencies: ['sqlite'], plannerConfigured: true }); }
      const trustedSimulator = path.startsWith('/simulator/') && equalSecret(String(req.headers['x-agent-key'] || ''), workloadKey);
      if (trustedSimulator ? simulatorRequests >= maxSimulatorRequests : publicRequests >= maxPublicRequests) {
        res.setHeader('Connection', 'close'); throw new AgentError('SERVER_BUSY', 503);
      }
      if (trustedSimulator) simulatorRequests++; else publicRequests++;
      try {
        const principal = await auth.authenticate(req.headers.authorization);
        if (res.destroyed) throw new AgentError('CLIENT_DISCONNECTED', 499);
        const ctx: ExecutionContext = { principal, authorization: req.headers.authorization || '', correlationId, revalidate: () => auth.authenticate(req.headers.authorization) };
        const refreshAuthority = async (permission: string) => {
          const current = await ctx.revalidate();
          if (res.destroyed) throw new AgentError('CLIENT_DISCONNECTED', 499);
          if (current.subject !== principal.subject || current.workload !== principal.workload) throw new AgentError('AUTHORITY_CHANGED', 403);
          authorize(current, permission);
          ctx.principal = current;
          return current;
        };
        await execution.run(ctx, async () => {
          if (path.startsWith('/simulator/')) {
            if (!equalSecret(String(req.headers['x-agent-key'] || ''), workloadKey)) throw new AgentError('WORKLOAD_REQUIRED', 403);
            if (req.method === 'GET' && path === '/simulator/v1/fines') { authorize(principal, 'fines:read'); return send(200, await service.store.fines(principal.subject)); }
            if (req.method === 'POST' && path === '/simulator/v1/payments') {
              authorize(principal, 'fines:pay');
              const body = z.object({ quote: Quote, consentId: z.string().uuid() }).strict().parse(await readBody(req, bodyTimeoutMs));
              const key = z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['idempotency-key']);
              return send(200, await service.store.simulatePayment(await refreshAuthority('fines:pay'), key, body.quote, body.consentId));
            }
            if (req.method === 'GET' && path === '/simulator/v1/vehicles') { authorize(principal, 'vehicles:read'); return send(200, service.store.vehicles(principal.subject)); }
            if (req.method === 'POST' && path === '/simulator/v1/renewals') {
              authorize(principal, 'vehicles:renew');
              const body = z.object({ quote: RenewalQuote, consentId: z.string().uuid() }).strict().parse(await readBody(req, bodyTimeoutMs));
              const key = z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['idempotency-key']);
              return send(200, service.store.simulateRenewal(await refreshAuthority('vehicles:renew'), key, body.quote, body.consentId));
            }
            throw new AgentError('NOT_FOUND', 404);
          }
          authorize(principal, 'fines:read');
          if (req.method === 'POST' && path === '/api/agent/threads') {
            await readBody(req, bodyTimeoutMs, true);
            return send(201, { threadId: await service.store.createThread(await refreshAuthority('fines:read')) });
          }
          const match = /^\/api\/agent\/threads\/([a-f0-9-]{36})(?:\/(messages|resume|cancel|recover))?$/.exec(path);
          if (!match) throw new AgentError('NOT_FOUND', 404);
          const id = z.string().uuid().parse(match[1]);
          if (req.method === 'GET' && !match[2]) return send(200, await service.inspect(id));
          if (req.method !== 'POST' || !match[2]) throw new AgentError('NOT_FOUND', 404);
          const requestId = Id.parse(req.headers['idempotency-key']);
          const action = match[2] === 'messages' ? 'message' : match[2] as 'resume' | 'cancel' | 'recover';
          let body: unknown = undefined;
          if (action === 'message') body = z.object({ message: Message }).strict().parse(await readBody(req, bodyTimeoutMs)).message;
          if (action === 'resume') body = Decision.parse(await readBody(req, bodyTimeoutMs));
          if (action === 'cancel' || action === 'recover') await readBody(req, bodyTimeoutMs, true);
          await refreshAuthority('fines:read');
          const streaming = req.headers.accept === 'text/event-stream';
          if (streaming) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
            ctx.onProgress = node => { if (!res.destroyed) res.write(`event: progress\ndata: ${JSON.stringify({ node, correlationId })}\n\n`); };
          }
          const result = await service.transition(id, requestId, action, body);
          logEvent('info', 'agent.transition', { correlationId, threadId: id, action });
          if (streaming) { if (!res.destroyed) res.end(`event: result\ndata: ${JSON.stringify(result)}\n\n`); }
          else send(200, result);
        });
      } finally {
        if (trustedSimulator) simulatorRequests--; else publicRequests--;
      }
    };
    void run().catch(error => {
      const status = error instanceof AgentError ? error.status : error instanceof z.ZodError ? 400 : 503;
      const code = error instanceof AgentError ? error.code : error instanceof z.ZodError ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE';
      logEvent('warn', 'agent.request_failed', { correlationId, code, status });
      if (res.destroyed) return;
      if (code === 'BODY_READ_TIMEOUT' || code === 'BODY_TOO_LARGE') res.setHeader('Connection', 'close');
      if (!res.headersSent && code === 'RECOVERY_RATE_LIMIT_REACHED') {
        res.setHeader('Retry-After', '60');
        if (res.hasHeader('Access-Control-Allow-Origin')) res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
      }
      if (res.headersSent) res.end(`event: error\ndata: ${JSON.stringify({ code, correlationId })}\n\n`);
      else send(status, { code, correlationId });
    });
  });
}
