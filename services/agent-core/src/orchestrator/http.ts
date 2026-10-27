import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AgentError, Decision, Id, Message, Quote, RenewalQuote, authorize, execution, type ExecutionContext } from './contracts.ts';
import { equalSecret, type Authenticator } from './auth.ts';
import type { AgentService } from './service.ts';
import { logEvent } from '../../../../packages/backend-kit/src/redact.ts';
import { corsOrigins } from '../../../../packages/backend-kit/src/local-endpoints.ts';

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new AgentError('BODY_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AgentError('INVALID_JSON'); }
}
export function createServer(service: AgentService, auth: Authenticator, workloadKey: string) {
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
      const principal = await auth.authenticate(req.headers.authorization);
      const ctx: ExecutionContext = { principal, authorization: req.headers.authorization || '', correlationId, revalidate: () => auth.authenticate(req.headers.authorization) };
      await execution.run(ctx, async () => {
        if (path.startsWith('/simulator/')) {
          if (!equalSecret(String(req.headers['x-agent-key'] || ''), workloadKey)) throw new AgentError('WORKLOAD_REQUIRED', 403);
          if (req.method === 'GET' && path === '/simulator/v1/fines') { authorize(principal, 'fines:read'); return send(200, await service.store.fines(principal.subject)); }
          if (req.method === 'POST' && path === '/simulator/v1/payments') {
            authorize(principal, 'fines:pay');
            const body = z.object({ quote: Quote, consentId: z.string().uuid() }).strict().parse(await readBody(req));
            const key = z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['idempotency-key']);
            return send(200, await service.store.simulatePayment(principal, key, body.quote, body.consentId));
          }
          if (req.method === 'GET' && path === '/simulator/v1/vehicles') { authorize(principal, 'vehicles:read'); return send(200, service.store.vehicles(principal.subject)); }
          if (req.method === 'POST' && path === '/simulator/v1/renewals') {
            authorize(principal, 'vehicles:renew');
            const body = z.object({ quote: RenewalQuote, consentId: z.string().uuid() }).strict().parse(await readBody(req));
            const key = z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['idempotency-key']);
            return send(200, service.store.simulateRenewal(principal, key, body.quote, body.consentId));
          }
          throw new AgentError('NOT_FOUND', 404);
        }
        authorize(principal, 'fines:read');
        if (req.method === 'POST' && path === '/api/agent/threads') return send(201, { threadId: await service.store.createThread(principal) });
        const match = /^\/api\/agent\/threads\/([a-f0-9-]{36})(?:\/(messages|resume|cancel|recover))?$/.exec(path);
        if (!match) throw new AgentError('NOT_FOUND', 404);
        const id = z.string().uuid().parse(match[1]);
        if (req.method === 'GET' && !match[2]) return send(200, await service.inspect(id));
        if (req.method !== 'POST' || !match[2]) throw new AgentError('NOT_FOUND', 404);
        const requestId = Id.parse(req.headers['idempotency-key']);
        const action = match[2] === 'messages' ? 'message' : match[2] as 'resume' | 'cancel' | 'recover';
        let body: unknown = undefined;
        if (action === 'message') body = z.object({ message: Message }).strict().parse(await readBody(req)).message;
        if (action === 'resume') body = Decision.parse(await readBody(req));
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
    };
    void run().catch(error => {
      const status = error instanceof AgentError ? error.status : error instanceof z.ZodError ? 400 : 503;
      const code = error instanceof AgentError ? error.code : error instanceof z.ZodError ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE';
      logEvent('warn', 'agent.request_failed', { correlationId, code, status });
      if (res.headersSent) res.end(`event: error\ndata: ${JSON.stringify({ code, correlationId })}\n\n`);
      else send(status, { code, correlationId });
    });
  });
}
