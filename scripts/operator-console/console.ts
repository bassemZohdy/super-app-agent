/** The local scenario console (SIM-05): a small web page for the operator of one isolated run. It controls only that run, only
 *  through named failpoints, an export and a reset, and it adds no authority: the operator's token stays in the launcher process
 *  (`RunControls` holds it), the browser holds only a cookie this server sets, and residents' shells have no route here.
 *
 *  Guards, each tested: loopback only; a random launch secret that becomes an HttpOnly SameSite=Strict cookie; the Host must be this
 *  server's own (DNS rebinding); a present Origin must be its own; every API call needs a custom header (which a cross-site page
 *  cannot send without a CORS preflight this server never allows); a strict content security policy; fixed bodies of at most 1 KB;
 *  request keys made here, never taken from the page; and a one-time, 60 second confirmation before a reset. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { redact } from '../../packages/backend-kit/src/redact.ts';

export interface RunControls {
  readonly runId: string;
  readonly operator: string;
  status(): Promise<{ armed?: Array<{ name: string; fired: number; remaining: number }>; audit?: Array<Record<string, unknown>> }>;
  inspect(): Promise<{ accounts?: Array<Record<string, any>>; pendingEvents?: { count?: number } }>;
  export(): Promise<unknown>;
  arm(name: string, times: number, requestKey: string): Promise<unknown>;
  clear(): Promise<unknown>;
  reset(requestKey: string): Promise<unknown>;
}

export type ConsoleOptions = { controls: RunControls; failpoints: ReadonlyArray<{ name: string; description: string }>; secret?: string; now?: () => number; resetWindowMs?: number };
export type RunningConsole = { port: number; secret: string; launchUrl: string; url: string; close(): Promise<void> };

const here = (name: string) => join(import.meta.dirname, name), repo = (path: string) => join(import.meta.dirname, '..', '..', path);
const CSS = { '/theme.css': 'packages/ui-tokens/src/theme.css', '/a11y.css': 'packages/ui-tokens/src/a11y.css', '/console.css': 'scripts/operator-console/console.css' } as const;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startOperatorConsole(options: ConsoleOptions): Promise<RunningConsole> {
  const { controls } = options, now = options.now ?? (() => Date.now()), secret = options.secret ?? randomBytes(24).toString('base64url');
  const names = new Set(options.failpoints.map(point => point.name)), windowMs = options.resetWindowMs ?? 60_000;
  const page = readFileSync(here('index.html')), script = stripTypeScriptTypes(readFileSync(here('browser.ts'), 'utf8'));
  const statics = Object.fromEntries(Object.entries(CSS).map(([route, file]) => [route, readFileSync(repo(file))]));
  let reset: { nonce: string; until: number } | undefined;
  let port = 0;

  const state = async () => {
    const [status, inspection] = await Promise.all([controls.status(), controls.inspect()]);
    return redact({
      runId: controls.runId, operator: controls.operator, failpoints: options.failpoints, armed: status.armed ?? [],
      audit: (status.audit ?? []).slice(0, 20).map(entry => ({ at: String(entry.at ?? ''), event: String(entry.event ?? ''), ...(typeof entry.name === 'string' ? { name: entry.name } : {}), ...(typeof entry.times === 'number' ? { times: entry.times } : {}) })),
      accounts: (inspection.accounts ?? []).map(account => ({ accountId: String(account.accountId), walletMinor: Number(account.walletMinor) || 0,
        openOrders: (account.orders ?? []).length, heldMinor: (account.cards ?? []).reduce((sum: number, card: { heldMinor?: number }) => sum + (card.heldMinor || 0), 0), claims: (account.claims ?? []).length })),
      pendingEvents: Number(inspection.pendingEvents?.count) || 0,
    });
  };

  const readBody = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) throw Object.assign(new Error('Send JSON.'), { status: 415 });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024) throw Object.assign(new Error('The request is too large.'), { status: 413 }); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape'); return body as Record<string, unknown>; }
    catch { throw Object.assign(new Error('Send a JSON object.'), { status: 400 }); }
  };
  const cookieOf = (req: http.IncomingMessage) => /(?:^|;\s*)console=([A-Za-z0-9_-]+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? '';

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const send = (status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) =>
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer', ...extra }).end(body);
    const json = (status: number, body: unknown) => send(status, JSON.stringify(body), 'application/json');
    const fail = (status: number, error: string) => json(status, { success: false, error });

    // DNS rebinding and cross-site requests: the Host must be this server's own, and a present Origin must be too.
    const host = String(req.headers.host ?? ''), self = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!self.includes(host)) return fail(403, 'This console answers only on its own loopback address.');
    const origin = req.headers.origin;
    if (origin !== undefined && !self.some(address => origin === `http://${address}`)) return fail(403, 'Cross-site requests are refused.');

    const url = new URL(req.url ?? '/', `http://${host}`), method = req.method ?? 'GET';
    if (method === 'GET' && url.pathname in statics) return send(200, statics[url.pathname], 'text/css; charset=utf-8');
    if (method === 'GET' && url.pathname === '/console.js') return send(200, script, 'text/javascript; charset=utf-8');

    // The launch link carries the secret once; it becomes a cookie and the address is cleaned.
    if (method === 'GET' && url.pathname === '/' && url.searchParams.has('k')) {
      if (!same(url.searchParams.get('k') ?? '', secret)) return fail(401, 'Use the link printed by the launcher.');
      return send(303, '', 'text/plain', { Location: '/', 'Set-Cookie': `console=${secret}; HttpOnly; SameSite=Strict; Path=/` });
    }
    if (!same(cookieOf(req), secret)) return send(401, 'Open the link printed by the launcher.', 'text/plain; charset=utf-8');
    if (method === 'GET' && url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');

    if (!url.pathname.startsWith('/api/')) return fail(404, 'Not found.');
    if (req.headers['x-console-request'] !== '1') return fail(403, 'A console request header is required.');
    try {
      if (method === 'GET' && url.pathname === '/api/state') return json(200, await state());
      if (method === 'GET' && url.pathname === '/api/export') return json(200, redact(await controls.export()));
      if (method !== 'POST') return fail(405, 'Use POST.');
      const body = await readBody(req);
      if (url.pathname === '/api/arm') {
        const name = body.name, times = body.times;
        if (typeof name !== 'string' || !names.has(name)) return fail(400, 'Arm one of the named failpoints.');
        if (typeof times !== 'number' || !Number.isInteger(times) || times < 1 || times > 100) return fail(400, 'The count must be a whole number from 1 to 100.');
        if (Object.keys(body).some(key => !['name', 'times'].includes(key))) return fail(400, 'Only a failpoint and a count are accepted.');
        await controls.arm(name, times, `console_${randomBytes(12).toString('base64url')}`);
        return json(200, await state());
      }
      if (url.pathname === '/api/clear') { await controls.clear(); return json(200, await state()); }
      if (url.pathname === '/api/reset/prepare') { reset = { nonce: randomBytes(18).toString('base64url'), until: now() + windowMs }; return json(200, { success: true, nonce: reset.nonce, expiresInMs: windowMs }); }
      if (url.pathname === '/api/reset') {
        const pending = reset; reset = undefined;                      // one use, whatever the outcome
        if (!pending || typeof body.nonce !== 'string' || !same(body.nonce, pending.nonce) || pending.until < now()) return fail(409, 'Confirm the reset again; the confirmation was missing, used or expired.');
        await controls.reset(`console_${randomBytes(12).toString('base64url')}`);
        return json(200, { success: true, resetting: true });
      }
      return fail(404, 'Not found.');
    } catch (error) {
      const status = (error as { status?: number }).status;
      // Provider errors are not echoed: they can carry upstream detail. The operator sees the status line only.
      return fail(status && status < 500 ? status : 502, status && status < 500 ? (error as Error).message : 'The run did not accept that request.');
    }
  };

  const server = http.createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;
  return { port, secret, url, launchUrl: `${url}?k=${secret}`, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}
