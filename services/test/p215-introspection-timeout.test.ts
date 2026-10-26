import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { INTROSPECTION_TIMEOUT_DEFAULT_MS, introspectionTimeoutMs, verifyJwt } from '../../packages/backend-kit/src/jwt.ts';

function setup(t: test.TestContext, name: string, timeout?: string) {
  const issuer = `https://${name}.example/realm`;
  const env: Record<string, string | undefined> = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_JWKS_URL: `${issuer}/keys`, KEYCLOAK_INTROSPECTION_URL: `${issuer}/introspect`,
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'verifier', KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'test-secret', KEYCLOAK_INTROSPECTION_TIMEOUT_MS: timeout };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key1', use: 'sig', alg: 'RS256' };
  const mint = () => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key1' })).toString('base64url'), now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ iss: issuer, aud: 'agent-core', sub: 'alice', typ: 'Bearer', iat: now, exp: now + 300 })).toString('base64url');
    return `Bearer ${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
  };
  /** Answers the introspection after `delayMs`, honouring the request's abort signal as the real fetch does. */
  const mockIntrospection = (delayMs: number, answer: () => Response = () => Response.json({ active: true })) => t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/keys')) return Response.json({ keys: [jwk] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    });
    return answer();
  });
  return { mint, mockIntrospection };
}

test('P2-15: the online check limit has a measured default and a bounded, validated setting', () => {
  assert.equal(INTROSPECTION_TIMEOUT_DEFAULT_MS, 8000);
  assert.equal(introspectionTimeoutMs({} as NodeJS.ProcessEnv), 8000);
  assert.equal(introspectionTimeoutMs({ KEYCLOAK_INTROSPECTION_TIMEOUT_MS: '' } as NodeJS.ProcessEnv), 8000);
  assert.equal(introspectionTimeoutMs({ KEYCLOAK_INTROSPECTION_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv), 1000);
  assert.equal(introspectionTimeoutMs({ KEYCLOAK_INTROSPECTION_TIMEOUT_MS: '12000' } as NodeJS.ProcessEnv), 12000);
  for (const bad of ['999', '12001', '0', '-1', '5000.5', 'slow', 'Infinity', '1e4x']) assert.throws(() => introspectionTimeoutMs({ KEYCLOAK_INTROSPECTION_TIMEOUT_MS: bad } as NodeJS.ProcessEnv), /from 1000 to 12000/, bad);
  assert.ok(12000 < 15000, 'the ceiling stays inside the servers\' 15 second request limit');
});

test('P2-15: a slow introspection inside the limit still lets the first signed-in call succeed', async t => {
  const f = setup(t, 'slow-but-ok', '1500');
  f.mockIntrospection(600);
  const started = Date.now();
  assert.equal((await verifyJwt(f.mint(), 'agent-core')).sub, 'alice');
  assert.ok(Date.now() - started >= 550, 'the call waited for the slow answer');
});

test('P2-15: an introspection slower than the limit is cut off and the token is refused', async t => {
  const f = setup(t, 'too-slow', '1000');
  f.mockIntrospection(5000);
  const started = Date.now();
  await assert.rejects(() => verifyJwt(f.mint(), 'agent-core'));
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 2500, `refused at about the limit, not after the slow answer (${elapsed} ms)`);
});

test('P2-15: a slow answer that says the token is inactive, or a server error, still refuses it', async t => {
  const inactive = setup(t, 'slow-inactive', '1500');
  inactive.mockIntrospection(300, () => Response.json({ active: false }));
  await assert.rejects(() => verifyJwt(inactive.mint(), 'agent-core'), /inactive/);
  const broken = setup(t, 'slow-error', '1500');
  broken.mockIntrospection(300, () => new Response('upstream detail that must not leak', { status: 503 }));
  await assert.rejects(() => verifyJwt(broken.mint(), 'agent-core'), (error: Error) => /unavailable/.test(error.message) && !/upstream detail/.test(error.message));
});

test('P2-15: a misconfigured limit refuses every token instead of quietly using another value', async t => {
  const f = setup(t, 'bad-setting', '30');
  f.mockIntrospection(10);
  await assert.rejects(() => verifyJwt(f.mint(), 'agent-core'), /from 1000 to 12000/);
});

test('P2-15: the observed failure, an introspection answering after 5.5 seconds, now succeeds under the default limit', async t => {
  const f = setup(t, 'observed-failure');
  f.mockIntrospection(5500);
  assert.equal((await verifyJwt(f.mint(), 'agent-core')).sub, 'alice');
});
