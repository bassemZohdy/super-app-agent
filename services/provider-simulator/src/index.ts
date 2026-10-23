import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { verifyJwt } from '../../../packages/backend-kit/src/jwt.ts';
import { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { AccountDatabase } from './database.ts';
import { ProviderEngine, ApiError, type ApiResult } from './engine.ts';
import { operations, openApi, providerIds, type ProviderId } from './contracts.ts';
export const callers: Record<ProviderId, string[]> = { rta: ['service-ride','service-catalog','service-wallet'], dewa: ['service-food','service-wallet','service-catalog'], etisalat: ['service-telecom'], du: ['service-telecom'], police: ['service-wallet'], dld: ['service-catalog'], payments: ['service-wallet','service-food','service-ride','service-telecom','provider-settlements'] };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export function createProviderServer(provider: ProviderId, path: string) {
  const store = new AccountDatabase(path), engine = new ProviderEngine(provider, store);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const routes = operations[provider].map(operation => ({ ...operation, regex: new RegExp(`^${operation.path.replace(/\{\w+\}/g, '[^/]+')}$`), validate: operation.body ? ajv.compile(operation.body) : undefined }));
  const payments = new ProviderClient('provider-settlements', process.env.PROVIDER_SETTLEMENT_SECRET || 'demo-settlements-secret');
  const server = http.createServer(async (req, res) => {
    const send = (result: ApiResult) => { res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result.data)); };
    try {
      const url = new URL(req.url || '/', 'http://provider');
      if (req.method === 'GET' && url.pathname === '/health') return send({ status: 200, data: { status: 'ok', provider, storage: 'sqlite' } });
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send({ status: 200, data: openApi(provider) });
      const claims = await verifyJwt(req.headers.authorization, 'provider-api').catch(() => { throw new ApiError(401, 'UNAUTHENTICATED', 'A valid service access token is required.'); });
      const roles = claims.realm_access?.roles || [];
      if (!callers[provider].includes(claims.azp) || !(roles.includes(`provider:${provider}`) || (req.method === 'GET' && roles.includes(`provider:${provider}:read`)))) throw new ApiError(403, 'SERVICE_FORBIDDEN', 'This service is not allowed to use this provider.');
      const subject = req.headers['x-user-subject'];
      if (typeof subject !== 'string' || !subject || subject.length > 200 || /[\r\n\x00-\x1f]/.test(subject)) throw new ApiError(400, 'ACTOR_REQUIRED', 'A trusted user subject is required.');
      const accounts = store.accounts(subject);
      if (req.method === 'GET' && url.pathname === '/v1/accounts') return send({ status: 200, data: { success: true, accounts } });
      const match = /^\/v1\/accounts\/([a-zA-Z0-9_-]+)(\/.*)$/.exec(url.pathname);
      if (!match) throw new ApiError(404, 'NOT_FOUND', 'Operation not found.');
      const [, accountId, operationPath] = match;
      if (!store.owns(subject, accountId)) throw new ApiError(403, 'ACCOUNT_FORBIDDEN', 'This account does not belong to the user.');
      const operation = routes.find(route => route.method === req.method && route.regex.test(operationPath));
      if (!operation || url.search) throw new ApiError(404, 'NOT_FOUND', 'Operation not found.');
      const actor: Actor = { sub: subject, username: subject, name: typeof req.headers['x-user-name'] === 'string' ? Buffer.from(req.headers['x-user-name'], 'base64url').toString('utf8').slice(0, 200) : 'Demo citizen', accountId, requestId: '' };
      engine.seed(actor);
      let body: any = {};
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) throw new ApiError(413, 'BODY_LIMIT', 'Request body exceeds 64 KiB.'); }
        try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_JSON', 'A JSON object is required.'); }
        if (!operation.validate?.(body)) throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not match the OpenAPI schema.');
      }
      const key = req.headers['idempotency-key'];
      const fingerprint = createHash('sha256').update(JSON.stringify([req.method, operationPath, canonical(body)])).digest('hex');
      if (req.method === 'POST') {
        if (typeof key !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(key)) throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'Provide an Idempotency-Key of 1 to 200 ASCII characters.');
        const existing = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(accountId, key) as any;
        if (existing) { if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.'); return send({ status: existing.status, data: JSON.parse(existing.body) }); }
      }
      const proof = body.paymentId ? (await payments.call('payments', actor, 'GET', `/charges/${encodeURIComponent(body.paymentId)}`)).charge : undefined;
      const result = store.transaction(() => {
        // Re-check after asynchronous proof retrieval; another request may have committed.
        if (req.method === 'POST') {
          const existing = store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(accountId, key as string) as any;
          if (existing) { if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.'); return { status: existing.status, data: JSON.parse(existing.body) }; }
          if (proof && store.get(accountId, 'used-payment', proof.id)) throw new ApiError(409, 'PAYMENT_ALREADY_USED', 'This payment was already applied.');
        }
        const result = engine.execute(actor, req.method || 'GET', operationPath, body, proof);
        if (req.method === 'POST') {
          if (proof && result.data.success) store.put(accountId, 'used-payment', true, proof.id);
          store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(accountId, key as string, fingerprint, result.status, JSON.stringify(result.data));
        }
        return result;
      });
      send(result);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      send({ status, data: { success: false, code: error instanceof ApiError ? error.code : 'PROVIDER_UNAVAILABLE', error: error instanceof ApiError ? error.message : 'The simulator could not complete this request. Check operation status before retrying a write.' } });
    }
  });
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const provider = process.env.PROVIDER_ID as ProviderId;
  if (!providerIds.includes(provider)) throw new Error('Set PROVIDER_ID to a supported provider.');
  const { server } = createProviderServer(provider, process.env.PROVIDER_DB_PATH || `./data/${provider}.sqlite`);
  const port = Number(process.env.PORT || 4101 + providerIds.indexOf(provider));
  server.listen(port, '0.0.0.0', () => console.log(`${provider} simulator listening on ${port}`));
}
