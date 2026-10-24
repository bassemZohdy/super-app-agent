/** Trusted local-demo issuer process. Agent runtime never mounts this service's keys/database. */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { HttpPolicy, HttpError, readJsonBody } from '../../../packages/backend-kit/src/http-policy.ts';
import { handleDelegation } from './service.ts';
export function createDelegationServer() {
  const policy = new HttpPolicy();
  return http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const release = policy.admit(req.socket.remoteAddress || 'unknown'); res.once('finish', release); res.once('close', release);
      const url = new URL(req.url || '/', 'http://broker');
      if (req.headers.origin || url.search || url.pathname.length > 500) return send(403, { success: false, code: 'BROKER_BACKCHANNEL_ONLY' });
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', service: 'delegation-broker', mode: 'local-synthetic-demo' });
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const result = await handleDelegation(req.method || 'GET', url.pathname, body, req.headers.authorization);
      send(result?.status || 404, result?.data || { success: false, code: 'NOT_FOUND' });
    } catch (e) { send(e instanceof HttpError ? e.status : 503, { success: false, code: 'BROKER_UNAVAILABLE' }); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createDelegationServer().listen(Number(process.env.PORT || 4010), '0.0.0.0', () => console.log('Trusted demo delegation broker listening.'));
