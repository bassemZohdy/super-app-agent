import https from 'node:https';
import { checkServerIdentity } from 'node:tls';

/** TLS stays end-to-end: the edge relay forwards opaque bytes to one configured model server.
 * Only the TCP address changes; SNI, Host, certificate verification and the model URL stay upstream-bound. */
export async function fetchViaModelRelay(endpoint: URL, init: RequestInit, relay: string): Promise<Response> {
  if (relay !== 'edge-relay:4443' || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || init.method !== 'POST' || typeof init.body !== 'string') throw new Error('Invalid model relay configuration');
  const supplied = new Headers(init.headers);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'edge-relay', port: 4443, servername: endpoint.hostname,
      rejectUnauthorized: true, checkServerIdentity: (_host, certificate) => checkServerIdentity(endpoint.hostname, certificate),
      method: 'POST', path: endpoint.pathname, signal: init.signal || undefined,
      headers: { Host: endpoint.host, 'Content-Type': 'application/json', ...(supplied.has('Authorization') ? { Authorization: supplied.get('Authorization')! } : {}) },
    }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('error', reject);
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) { reject(new Error('Model relay response too large')); response.destroy(); request.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const status = response.statusCode || 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: { 'Content-Type': 'application/json' } }));
      });
    });
    request.on('error', reject);
    request.end(init.body);
  });
}
