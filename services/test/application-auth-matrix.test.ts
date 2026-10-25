import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApplicationServer } from '../../packages/backend-kit/src/application.ts';
import { APPLICATION_OPERATIONS, type ApplicationOperation } from '../../packages/backend-kit/src/application-openapi.ts';

// Proves that the integrated application server rejects bad bearer credentials before any business logic runs.
// Each operation is exercised over real HTTP on an ephemeral port. The JWKS fetch is mocked, so no network is used.

const ISSUER = 'https://auth-matrix.example/realms/superapp';
const JWKS_URL = `${ISSUER}/keys`;
const AUDIENCE = 'agent-core';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key1', use: 'sig', alg: 'RS256' };
const dataDir = mkdtempSync(join(tmpdir(), 'application-auth-matrix-'));
const ENV = {
  PROVIDER_INTEGRATION: 'true', KEYCLOAK_ISSUER: ISSUER, KEYCLOAK_JWKS_URL: JWKS_URL,
  KEYCLOAK_AUDIENCE: AUDIENCE, APP_DATA_DIR: dataDir, NODE_ENV: 'test',
};
const previousEnv = new Map<string, string | undefined>();

before(() => {
  for (const [key, value] of Object.entries(ENV)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
});
after(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  removeTemp(dataDir);
});

type Claims = Record<string, unknown>;
// Mints an RS256 bearer token. Defaults are a valid superapp user token; tests override single fields.
function mint(claims: Claims = {}, privateKey = pair.privateKey) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER, aud: AUDIENCE, sub: 'alice', preferred_username: 'alice', name: 'Alice', typ: 'Bearer',
    iat: now, exp: now + 300, realm_access: { roles: ['superapp-user'] }, ...claims,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), privateKey).toString('base64url');
  return `Bearer ${head}.${payload}.${signature}`;
}

// Serves the JWKS from memory. Loopback requests to the test server pass through; any other outbound fetch fails
// the test instead of touching the network.
const realFetch = globalThis.fetch;
function mockJwks(t: test.TestContext) {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (target !== JWKS_URL) throw new Error(`unexpected outbound fetch: ${target}`);
    return Response.json({ keys: [jwk] });
  });
}

type Credential = { name: string; authorization?: string };
// Credential cases that must each be rejected with 401 before the legacy handler runs.
function rejectedCredentials(): Credential[] {
  return [
    { name: 'no Authorization header' },
    { name: 'garbage bearer token', authorization: 'Bearer garbage' },
    { name: 'token signed by a different key', authorization: mint({}, otherPair.privateKey) },
    { name: 'wrong audience', authorization: mint({ aud: 'some-other-client' }) },
    { name: 'service-account principal', authorization: mint({ preferred_username: 'service-account-superapp' }) },
    { name: 'missing superapp-user role', authorization: mint({ realm_access: { roles: ['offline_access'] } }) },
  ];
}

function concretePath(operation: ApplicationOperation) {
  return operation.path.replace('{provider}', 'etisalat').replace(/\{[^}]+\}/g, 'test-id');
}

type LegacyCall = { method: string; path: string };
function startServer(t: test.TestContext, service: string) {
  const legacyCalls: LegacyCall[] = [];
  const legacy = (method: string, path: string) => {
    legacyCalls.push({ method, path });
    return { status: 200, data: { success: true, legacy: true } };
  };
  const server = createApplicationServer(service, legacy);
  return new Promise<{ port: number; legacyCalls: LegacyCall[] }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      t.after(() => { server.closeAllConnections(); server.close(); });
      resolve({ port, legacyCalls });
    });
  });
}

async function send(port: number, operation: ApplicationOperation, path: string, authorization?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization !== undefined) headers.Authorization = authorization;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: operation.method, headers, body: operation.method === 'POST' ? '{}' : undefined,
  });
  return { status: response.status, body: (await response.json()) as { code?: string } };
}

for (const operation of APPLICATION_OPERATIONS) {
  test(`${operation.operationId} (${operation.method} ${operation.path}) rejects bad credentials before business logic`, async t => {
    mockJwks(t);
    const { port, legacyCalls } = await startServer(t, operation.service);
    const path = concretePath(operation);
    for (const credential of rejectedCredentials()) {
      const label = `${operation.operationId} with ${credential.name}`;
      const result = await send(port, operation, path, credential.authorization);
      assert.equal(result.status, 401, `${label}: expected 401, got ${result.status}`);
      assert.equal(result.body.code, 'UNAUTHENTICATED', `${label}: expected code UNAUTHENTICATED`);
      assert.deepEqual(legacyCalls, [], `${label}: legacy handler must not be invoked`);
    }
  });
}

test('positive control: a valid superapp user token reaches the legacy handler on a GET and passes auth on a POST', async t => {
  mockJwks(t);
  const food = await startServer(t, 'service-food');
  const getOperation = APPLICATION_OPERATIONS.find(op => op.operationId === 'searchRestaurants')!;
  const getResult = await send(food.port, getOperation, '/restaurants/search', mint());
  assert.equal(getResult.status, 200);
  assert.deepEqual(food.legacyCalls, [{ method: 'GET', path: '/restaurants/search' }]);

  const profile = await startServer(t, 'service-profile');
  const postOperation = APPLICATION_OPERATIONS.find(op => op.operationId === 'updatePreferences')!;
  const postResult = await send(profile.port, postOperation, '/profile/preferences', mint());
  assert.notEqual(postResult.status, 401, 'valid user token must not be rejected on POST');
  assert.equal(postResult.status, 200);
  assert.deepEqual(profile.legacyCalls, []);
});
