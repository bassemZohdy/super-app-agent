import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { startOperatorConsole, type RunControls, type RunningConsole } from '../../scripts/operator-console/console.ts';
import { describedFailpoints } from '../../scripts/operator-console/failpoints.ts';
import { providerRunControls, refreshingToken } from '../../scripts/operator-console/provider-controls.ts';
import { FAILPOINTS } from '../provider-simulator/src/failpoints.ts';

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };
const raw = (port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<Reply>((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path ?? '/', headers: options.headers }, res => {
    const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject); if (options.body !== undefined) req.write(options.body); req.end();
});

function fakeControls(overrides: Partial<RunControls> = {}) {
  const calls: unknown[][] = [];
  const controls: RunControls = {
    runId: 'simrun_00000000-0000-4000-8000-000000000001', operator: 'bassem',
    status: async () => ({ armed: [{ name: 'checkout.after-admission', fired: 1, remaining: 2 }], audit: [{ at: '2026-10-26T00:00:00Z', event: 'ARMED', name: 'checkout.after-admission', times: 2, operatorSub: 'internal-subject', runId: 'x' }] }),
    inspect: async () => ({ accounts: [{ accountId: 'acc_1', walletMinor: 150000, cards: [{ heldMinor: 500 }, { heldMinor: 250 }], orders: [{}, {}], claims: [{}] }], pendingEvents: { count: 3 } }),
    export: async () => ({ runId: 'simrun_x', accounts: [], authorization: 'Bearer abc.def.ghi', password: 'hunter2' }),
    arm: async (...args) => { calls.push(['arm', ...args]); return {}; }, clear: async () => { calls.push(['clear']); return {}; }, reset: async key => { calls.push(['reset', key]); return {}; },
    ...overrides,
  };
  return { controls, calls };
}

async function start(t: test.TestContext, options: { controls?: RunControls; now?: () => number; resetWindowMs?: number } = {}) {
  const { controls, calls } = options.controls ? { controls: options.controls, calls: [] as unknown[][] } : fakeControls();
  const running: RunningConsole = await startOperatorConsole({ controls, failpoints: describedFailpoints(), now: options.now, resetWindowMs: options.resetWindowMs });
  t.after(() => running.close());
  const cookie = `console=${running.secret}`;
  const api = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; cookie?: string | null } = {}) => raw(running.port, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), path,
    headers: { ...(init.cookie === null ? {} : { Cookie: init.cookie ?? cookie }), 'X-Console-Request': '1', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { running, calls, cookie, api };
}

test('SIM-05: the launch link sets an HttpOnly SameSite=Strict cookie and a wrong or missing secret opens nothing', async t => {
  const { running, api } = await start(t);
  assert.ok(running.launchUrl.startsWith('http://127.0.0.1:'), 'loopback only');
  const launched = await raw(running.port, { path: `/?k=${running.secret}` });
  assert.equal(launched.status, 303);
  assert.equal(launched.headers.location, '/', 'the secret leaves the address bar');
  assert.match(String(launched.headers['set-cookie']), new RegExp(`console=${running.secret}; HttpOnly; SameSite=Strict; Path=/`));
  assert.equal((await raw(running.port, { path: '/?k=wrong-secret' })).status, 401);
  assert.equal((await raw(running.port, { path: '/' })).status, 401, 'the page needs the cookie');
  assert.equal((await api('/api/state', { cookie: null })).status, 401, 'the API needs the cookie');
  assert.equal((await api('/api/state', { cookie: 'console=wrong' })).status, 401);
  assert.equal((await api('/api/state')).status, 200);
});

test('SIM-05: a request for another host or from another origin is refused, even with the cookie', async t => {
  const { running, api } = await start(t);
  for (const host of ['evil.test', `evil.test:${running.port}`, `127.0.0.1:${running.port + 1}`, '127.0.0.1']) assert.equal((await api('/api/state', { headers: { Host: host } })).status, 403, `Host ${host}`);
  assert.equal((await api('/api/state', { headers: { Host: `localhost:${running.port}` } })).status, 200, 'localhost is this machine');
  for (const origin of ['http://evil.test', 'null', `http://127.0.0.1:${running.port + 1}`, `https://127.0.0.1:${running.port}`]) assert.equal((await api('/api/state', { headers: { Origin: origin } })).status, 403, `Origin ${origin}`);
  assert.equal((await api('/api/state', { headers: { Origin: `http://127.0.0.1:${running.port}` } })).status, 200);
});

test('SIM-05: every API call needs the console header, and the page is locked down by CSP', async t => {
  const { running, api, cookie } = await start(t);
  assert.equal((await raw(running.port, { path: '/api/state', headers: { Cookie: cookie } })).status, 403, 'no header');
  assert.equal((await raw(running.port, { path: '/api/state', headers: { Cookie: cookie, 'X-Console-Request': '0' } })).status, 403);
  const page = await raw(running.port, { path: '/', headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const csp = String(page.headers['content-security-policy']);
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "form-action 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(directive), directive);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.body, /<script src="\/console\.js"><\/script>/);
  assert.equal(/<script>[\s\S]+<\/script>|onclick=|style=/.test(page.body), false, 'no inline script, handler or style');
  assert.equal((await api('/nope')).status, 404);
  assert.equal((await api('/api/state', { method: 'DELETE' })).status, 405);
});

test('SIM-05: the state is a fixed, safe summary: no operator identity, no tokens', async t => {
  const { api } = await start(t);
  const reply = await api('/api/state'), state = JSON.parse(reply.body);
  assert.deepEqual(Object.keys(state).sort(), ['accounts', 'armed', 'audit', 'failpoints', 'operator', 'pendingEvents', 'runId']);
  assert.deepEqual(state.accounts, [{ accountId: 'acc_1', walletMinor: 150000, openOrders: 2, heldMinor: 750, claims: 1 }]);
  assert.equal(state.pendingEvents, 3);
  assert.deepEqual(state.failpoints.map((f: { name: string }) => f.name), [...FAILPOINTS]);
  assert.deepEqual(state.audit, [{ at: '2026-10-26T00:00:00Z', event: 'ARMED', name: 'checkout.after-admission', times: 2 }]);
  assert.equal(reply.body.includes('internal-subject'), false, 'the audit fields are picked, not passed through');
});

test('SIM-05: the export is redacted', async t => {
  const { api } = await start(t);
  const reply = await api('/api/export');
  assert.equal(reply.status, 200);
  for (const secret of ['abc.def.ghi', 'hunter2']) assert.equal(reply.body.includes(secret), false, secret);
  assert.equal(JSON.parse(reply.body).runId, 'simrun_x');
});

test('SIM-05: only named failpoints with a bounded count are armed, with a key made by the console', async t => {
  const { api, calls } = await start(t);
  const refuse = async (body: unknown, label: string) => { const reply = await api('/api/arm', { body }); assert.equal(reply.status, 400, label); };
  await refuse({ name: 'checkout.drop-everything', times: 1 }, 'unknown failpoint');
  await refuse({ name: 'http://evil.test/x', times: 1 }, 'a URL');
  await refuse({ name: 'checkout.after-admission', times: 0 }, 'zero');
  await refuse({ name: 'checkout.after-admission', times: 101 }, 'too many');
  await refuse({ name: 'checkout.after-admission', times: 1.5 }, 'fraction');
  await refuse({ name: 'checkout.after-admission', times: '3' }, 'string count');
  await refuse({ name: 'checkout.after-admission', times: 1, requestKey: 'chosen-by-the-page' }, 'a page-chosen key');
  await refuse({ name: 'checkout.after-admission', times: 1, path: '/etc/passwd' }, 'an extra field');
  assert.deepEqual(calls, [], 'nothing reached the run');
  assert.equal((await api('/api/arm', { body: { name: 'funding.after-commit', times: 100 } })).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['arm', 'funding.after-commit', 100]);
  assert.match(String(calls[0][3]), /^console_[A-Za-z0-9_-]{16}$/);
  await api('/api/arm', { body: { name: 'funding.after-commit', times: 1 } });
  assert.notEqual(calls[0][3], calls[1][3], 'each request gets its own key');
});

test('SIM-05: bodies must be small JSON objects', async t => {
  const { running, cookie, api } = await start(t);
  const headers = { Cookie: cookie, 'X-Console-Request': '1' };
  assert.equal((await raw(running.port, { method: 'POST', path: '/api/clear', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await raw(running.port, { method: 'POST', path: '/api/clear', headers: { ...headers, 'Content-Type': 'application/json' }, body: 'x'.repeat(2000) })).status, 413);
  assert.equal((await raw(running.port, { method: 'POST', path: '/api/clear', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{not json' })).status, 400);
  assert.equal((await raw(running.port, { method: 'POST', path: '/api/clear', headers: { ...headers, 'Content-Type': 'application/json' }, body: '[1]' })).status, 400);
  assert.equal((await api('/api/clear', { body: {} })).status, 200);
});

test('SIM-05: a reset needs a one-time confirmation that expires and is spent by any attempt', async t => {
  let clock = 1_000_000;
  const { api, calls } = await start(t, { now: () => clock, resetWindowMs: 60_000 });
  assert.equal((await api('/api/reset', { body: { nonce: 'guess' } })).status, 409, 'no confirmation was prepared');
  assert.deepEqual(calls, []);
  const first = JSON.parse((await api('/api/reset/prepare', { body: {} })).body).nonce as string;
  assert.equal((await api('/api/reset', { body: { nonce: 'wrong' } })).status, 409, 'a wrong nonce');
  assert.equal((await api('/api/reset', { body: { nonce: first } })).status, 409, 'the failed attempt spent it');
  const second = JSON.parse((await api('/api/reset/prepare', { body: {} })).body).nonce as string;
  assert.notEqual(first, second);
  assert.equal((await api('/api/reset', { body: { nonce: second } })).status, 200);
  assert.deepEqual([calls.length, calls[0][0]], [1, 'reset']);
  assert.match(String(calls[0][1]), /^console_[A-Za-z0-9_-]{16}$/);
  assert.equal((await api('/api/reset', { body: { nonce: second } })).status, 409, 'it cannot be replayed');
  const third = JSON.parse((await api('/api/reset/prepare', { body: {} })).body).nonce as string;
  clock += 60_001;
  assert.equal((await api('/api/reset', { body: { nonce: third } })).status, 409, 'it expired');
  assert.equal(calls.length, 1);
});

test('SIM-05: a failing run is reported without its detail', async t => {
  const failing = fakeControls({ arm: async () => { throw new Error('upstream detail: token abc.def.ghi at http://internal:4107'); }, status: async () => { throw new Error('boom internal'); } });
  const { api } = await start(t, { controls: failing.controls });
  const arm = await api('/api/arm', { body: { name: 'funding.after-commit', times: 1 } });
  assert.equal(arm.status, 502);
  assert.equal(/abc\.def|internal|upstream/.test(arm.body), false);
  const state = await api('/api/state');
  assert.equal(state.status, 502);
  assert.equal(/boom|internal/.test(state.body), false);
});

test('SIM-05: the page script is valid JavaScript with no types left, no import, and builds the page without innerHTML', async t => {
  const { running } = await start(t);
  const script = await raw(running.port, { path: '/console.js' });
  assert.equal(script.status, 200);
  assert.match(String(script.headers['content-type']), /javascript/);
  assert.doesNotThrow(() => new vm.Script(script.body), 'it parses as a classic script');
  const code = script.body.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/\binnerHTML\b|\bouterHTML\b|\beval\(|\bdocument\.write\b|\bnew Function\b/.test(code), false, 'no unsafe sinks');
  assert.equal(/^\s*(?:import|export)\b|\bimport\s*\(/m.test(code), false, 'a classic script has no module syntax');
  assert.equal(script.body.includes('Bearer'), false, 'the page holds no token');
  for (const css of ['/theme.css', '/a11y.css', '/console.css']) assert.equal((await raw(running.port, { path: css })).status, 200, css);
  assert.match((await raw(running.port, { path: '/console.css' })).body, /min-height: 44px/);
});

test('SIM-05: every provider failpoint is described, so a new one cannot be armed unexplained', () => {
  assert.deepEqual(describedFailpoints().map(f => f.name), [...FAILPOINTS]);
  for (const point of describedFailpoints()) assert.ok(point.description.length > 20, point.name);
});

test('SIM-05: the provider-backed controls call exactly the run\'s routes with a fresh operator token and report only a status', async t => {
  const seen: Array<{ url: string; method: string; auth: string; body?: string }> = [];
  let tokens = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method), auth: String((init?.headers as Record<string, string>).Authorization), body: init?.body as string | undefined });
    return String(url).endsWith('/reset') ? new Response('provider secret detail', { status: 409 }) : Response.json({ ok: true });
  });
  const controls = providerRunControls({ base: 'http://localhost:4107', runId: 'simrun_run1', operator: 'bassem', token: async () => `token-${++tokens}` });
  await controls.status(); await controls.inspect(); await controls.export(); await controls.arm('funding.after-commit', 2, 'key_12345678'); await controls.clear();
  await assert.rejects(() => controls.reset('key_87654321'), (error: Error) => error.message === 'The run answered 409.');
  assert.deepEqual(seen.map(s => `${s.method} ${s.url.replace('http://localhost:4107/internal/scenario-controls/simrun_run1', '')}`), ['GET ', 'GET /inspect', 'GET /export', 'POST /arm', 'POST /clear', 'POST /reset']);
  assert.deepEqual(seen.map(s => s.auth), [1, 2, 3, 4, 5, 6].map(n => `Bearer token-${n}`));
  assert.deepEqual(JSON.parse(seen[3].body!), { name: 'funding.after-commit', times: 2, requestKey: 'key_12345678' });
});

test('SIM-05: the operator token is requested again shortly before it expires, once at a time', async () => {
  let now = 1_000_000_000_000, logins = 0;
  const mint = (lifetimeSeconds: number) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + lifetimeSeconds })).toString('base64url')}.s`;
  const token = refreshingToken(async () => { logins++; await new Promise(resolve => setTimeout(resolve, 5)); return mint(300); }, () => now);
  const [a, b] = await Promise.all([token(), token()]);
  assert.equal(a, b); assert.equal(logins, 1, 'concurrent calls share one login');
  await token(); assert.equal(logins, 1, 'a fresh token is reused');
  now += 250_000; await token(); assert.equal(logins, 1, 'still valid with a margin');
  now += 21_000; await token(); assert.equal(logins, 2, 'refreshed inside the 30 second margin');
});
