import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { verifyJwt } from '../../packages/backend-kit/src/jwt.ts';
import { ClientCredentials } from '../../packages/backend-kit/src/oauth.ts';
import { startTestIssuer, type TestIssuerOptions } from '../../test/support/test-issuer.ts';

// A test-only issuer, not Keycloak evidence: these tests exercise the real verifier and token client in milliseconds.
const REDIRECT = 'http://localhost:5173/callback';
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const pkce = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };
const jwt = (key: ReturnType<typeof generateKeyPairSync>['privateKey'], claims: Record<string, unknown>) => {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'k' }), body = b64(claims);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
};

async function setup(t: test.TestContext, extra: Partial<TestIssuerOptions> = {}) {
  const assertionPair = generateKeyPairSync('rsa', { modulusLength: 2048 }), brokerPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = await startTestIssuer({
    clients: {
      web: { redirectUris: [REDIRECT], grants: ['authorization_code', 'refresh_token'] },
      svc: { secret: 'svc-secret', grants: ['client_credentials'], roles: ['delegation:execute'], audience: ['delegation-api'] },
      broker: { clientKey: brokerPair.publicKey.export({ format: 'jwk' }), grants: ['urn:ietf:params:oauth:grant-type:jwt-bearer'], audience: ['provider-api'] },
    },
    users: { alice: { sub: 'alice-sub', username: 'alice', roles: ['superapp-user'] } },
    trustedIssuers: { 'cityside-issuer': [assertionPair.publicKey.export({ format: 'jwk' })] },
    ...extra,
  });
  const saved = { KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER, KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL, KEYCLOAK_TOKEN_URL: process.env.KEYCLOAK_TOKEN_URL, KEYCLOAK_REQUIRED_SCOPES: process.env.KEYCLOAK_REQUIRED_SCOPES };
  Object.assign(process.env, { KEYCLOAK_ISSUER: issuer.issuer, KEYCLOAK_JWKS_URL: issuer.jwksUrl, KEYCLOAK_TOKEN_URL: issuer.tokenUrl });
  delete process.env.KEYCLOAK_REQUIRED_SCOPES;
  t.after(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } await issuer.close(); });
  const post = (form: Record<string, string>) => fetch(issuer.tokenUrl, { method: 'POST', body: new URLSearchParams(form) });
  const authorize = (params: Record<string, string>) => fetch(`${issuer.authorizeUrl}?${new URLSearchParams(params)}`, { redirect: 'manual' });
  const assertion = (claims: Record<string, unknown> = {}) => jwt(assertionPair.privateKey, { iss: 'cityside-issuer', sub: 'cityside:alice-sub', aud: issuer.issuer, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, jti: randomUUID(), scope: 'delegation.read', ...claims });
  const clientAssertion = (claims: Record<string, unknown> = {}) => jwt(brokerPair.privateKey, { iss: 'broker', sub: 'broker', aud: issuer.issuer, exp: Math.floor(Date.now() / 1000) + 60, ...claims });
  const bearerForm = (assertionJwt: string, client = clientAssertion()) => ({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: 'broker', assertion: assertionJwt, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: client });
  return { issuer, post, authorize, assertion, clientAssertion, bearerForm };
}
const codeFrom = (response: Response) => new URL(response.headers.get('location')!).searchParams;
const code = async (f: Awaited<ReturnType<typeof setup>>, challenge: string) => {
  const redirect = await f.authorize({ response_type: 'code', client_id: 'web', redirect_uri: REDIRECT, state: 's1', code_challenge: challenge, code_challenge_method: 'S256', login_hint: 'alice', scope: 'openid' });
  assert.equal(redirect.status, 302);
  return codeFrom(redirect).get('code')!;
};

test('P2-10: the real verifier accepts issuer tokens over a real JWKS fetch and refuses forged, foreign-key and altered ones', async t => {
  const f = await setup(t);
  const good = await verifyJwt(`Bearer ${f.issuer.mint({ aud: ['agent-core'] })}`, 'agent-core');
  assert.equal(good.sub, 'test-user');
  for (const [name, token] of Object.entries({
    wrongAudience: f.issuer.mint({ aud: ['other'] }), expired: f.issuer.mint({ exp: Math.floor(Date.now() / 1000) - 10 }), wrongIssuer: f.issuer.mint({ iss: 'http://127.0.0.1:1/x' }),
    notBearer: f.issuer.mint({ typ: 'ID' }), foreignKey: f.issuer.mintForeign(), noneAlg: f.issuer.mint({}, { alg: 'none' }), hs256: f.issuer.mint({}, { alg: 'HS256' }),
    jkuHeader: f.issuer.mint({}, { jku: 'http://evil.test/keys' }), inlineJwk: f.issuer.mint({}, { jwk: { kty: 'RSA' } }), tooLong: f.issuer.mint({ exp: Math.floor(Date.now() / 1000) + 200000 }),
  })) await assert.rejects(() => verifyJwt(`Bearer ${token}`, 'agent-core'), name);
  const [head, body, sig] = f.issuer.mint({ sub: 'alice' }).split('.');
  await assert.rejects(() => verifyJwt(`Bearer ${head}.${b64({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: 'mallory' })}.${sig}`, 'agent-core'), 'altered payload');
  process.env.KEYCLOAK_REQUIRED_SCOPES = 'delegation.write';
  await assert.rejects(() => verifyJwt(`Bearer ${f.issuer.mint({ scope: 'delegation.read' })}`, 'agent-core'), 'missing required scope');
});

test('P2-10: authorization code requires S256 PKCE, a registered redirect and state, and a code works once', async t => {
  const f = await setup(t), { verifier, challenge } = pkce();
  const base = { response_type: 'code', client_id: 'web', redirect_uri: REDIRECT, state: 's1', code_challenge: challenge, code_challenge_method: 'S256', login_hint: 'alice' };
  assert.equal(codeFrom(await f.authorize({ ...base, code_challenge_method: 'plain' })).get('error'), 'invalid_request');
  const noChallenge = { ...base } as Record<string, string>; delete noChallenge.code_challenge;
  assert.equal(codeFrom(await f.authorize(noChallenge)).get('error'), 'invalid_request');
  const noState = { ...base } as Record<string, string>; delete noState.state;
  assert.equal(codeFrom(await f.authorize(noState)).get('error'), 'invalid_request');
  assert.equal(codeFrom(await f.authorize({ ...base, response_type: 'token' })).get('error'), 'unsupported_response_type');
  assert.equal((await f.authorize({ ...base, redirect_uri: 'http://evil.test/cb' })).status, 400, 'an unregistered redirect is never redirected to');
  assert.equal(codeFrom(await f.authorize({ ...base, login_hint: 'nobody' })).get('error'), 'access_denied');

  const ok = codeFrom(await f.authorize(base));
  assert.equal(ok.get('state'), 's1');
  const form = { grant_type: 'authorization_code', client_id: 'web', code: ok.get('code')!, redirect_uri: REDIRECT, code_verifier: verifier };
  const issued = await f.post(form);
  assert.equal(issued.status, 200);
  const body = await issued.json() as { access_token: string; refresh_token: string };
  const claims = await verifyJwt(`Bearer ${body.access_token}`, 'agent-core');
  assert.deepEqual([claims.sub, claims.azp, claims.realm_access.roles], ['alice-sub', 'web', ['superapp-user']]);
  const replay = await f.post(form);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json() as { error: string }).error, 'invalid_grant', 'a code is single-use');
});

test('P2-10: a wrong verifier, wrong redirect or another client cannot redeem a code', async t => {
  const f = await setup(t), { verifier, challenge } = pkce();
  for (const change of [{ code_verifier: pkce().verifier }, { redirect_uri: 'http://localhost:5173/other' }, { code_verifier: '' }]) {
    const fresh = await code(f, challenge);
    const response = await f.post({ grant_type: 'authorization_code', client_id: 'web', code: fresh, redirect_uri: REDIRECT, code_verifier: verifier, ...change });
    assert.equal(response.status, 400);
    // The failed attempt consumed the code: the right verifier no longer redeems it.
    assert.equal((await f.post({ grant_type: 'authorization_code', client_id: 'web', code: fresh, redirect_uri: REDIRECT, code_verifier: verifier })).status, 400);
  }
  const other = await f.post({ grant_type: 'authorization_code', client_id: 'svc', client_secret: 'svc-secret', code: await code(f, challenge), redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal((await other.json() as { error: string }).error, 'unauthorized_client', 'a client without this grant is refused');
});

test('P2-10: authorization codes expire', async t => {
  let clock = Date.now();
  const f = await setup(t, { now: () => clock, codeTtlSeconds: 30 }), { verifier, challenge } = pkce();
  const fresh = await code(f, challenge);
  clock += 31_000;
  const response = await f.post({ grant_type: 'authorization_code', client_id: 'web', code: fresh, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal((await response.json() as { error: string }).error, 'invalid_grant');
});

test('P2-10: refresh tokens rotate and reusing an old one revokes the whole session', async t => {
  const f = await setup(t), { verifier, challenge } = pkce();
  const first = await (await f.post({ grant_type: 'authorization_code', client_id: 'web', code: await code(f, challenge), redirect_uri: REDIRECT, code_verifier: verifier })).json() as { refresh_token: string };
  const second = await (await f.post({ grant_type: 'refresh_token', client_id: 'web', refresh_token: first.refresh_token })).json() as { refresh_token: string };
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal((await f.post({ grant_type: 'refresh_token', client_id: 'web', refresh_token: first.refresh_token })).status, 400, 'the rotated token is dead');
  assert.equal((await f.post({ grant_type: 'refresh_token', client_id: 'web', refresh_token: second.refresh_token })).status, 400, 'reuse revoked the newer token too');
});

test('P2-10: the real ClientCredentials client gets a verifiable service token, and a wrong secret fails', async t => {
  const f = await setup(t);
  const token = await new ClientCredentials('svc', 'svc-secret', 'delegation.execute').token();
  const claims = await verifyJwt(`Bearer ${token}`, 'delegation-api');
  assert.deepEqual([claims.azp, claims.preferred_username, claims.realm_access.roles], ['svc', 'service-account-svc', ['delegation:execute']]);
  await assert.rejects(() => new ClientCredentials('svc', 'wrong').token(), /Service authentication failed \(401\)/);
  assert.equal((await f.post({ grant_type: 'client_credentials', client_id: 'web' })).status, 400, 'a public client has no client_credentials grant');
});

test('P2-10: the jwt-bearer grant issues a subject token once and refuses assertion reuse', async t => {
  const f = await setup(t), signed = f.assertion();
  const issued = await f.post(f.bearerForm(signed));
  assert.equal(issued.status, 200);
  const claims = await verifyJwt(`Bearer ${(await issued.json() as { access_token: string }).access_token}`, 'provider-api');
  assert.deepEqual([claims.sub, claims.azp, claims.scope, claims.act], ['alice-sub', 'broker', 'delegation.read', undefined]);
  const replay = await f.post(f.bearerForm(signed, f.clientAssertion()));
  assert.equal(replay.status, 400);
  assert.equal((await replay.json() as { error_description: string }).error_description, 'assertion already used');
});

test('P2-10: the jwt-bearer grant refuses untrusted, expired, misdirected and badly authenticated requests', async t => {
  const f = await setup(t), now = Math.floor(Date.now() / 1000);
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const [name, form] of Object.entries({
    unknownIssuer: f.bearerForm(f.assertion({ iss: 'someone-else' })),
    expired: f.bearerForm(f.assertion({ exp: now - 5 })),
    wrongAudience: f.bearerForm(f.assertion({ aud: 'http://evil.test/realm' })),
    badSignature: f.bearerForm(jwt(wrongKey, { iss: 'cityside-issuer', sub: 'cityside:alice-sub', aud: f.issuer.issuer, exp: now + 60 })),
    missingClientAssertion: { ...f.bearerForm(f.assertion()), client_assertion: '' },
    clientAssertionWrongAudience: f.bearerForm(f.assertion(), f.clientAssertion({ aud: 'http://evil.test/realm' })),
    clientAssertionOtherSubject: f.bearerForm(f.assertion(), f.clientAssertion({ sub: 'someone' })),
    clientAssertionExpired: f.bearerForm(f.assertion(), f.clientAssertion({ exp: now - 5 })),
  })) assert.notEqual((await f.post(form)).status, 200, name);
  assert.equal((await f.post({ ...f.bearerForm(f.assertion()), client_id: 'svc', client_secret: 'svc-secret' })).status, 400, 'a client without the jwt-bearer grant is refused');
});

test('P2-10: a token request body is bounded', async t => {
  const f = await setup(t);
  assert.equal((await f.post({ grant_type: 'client_credentials', client_id: 'svc', client_secret: 'x'.repeat(20000) })).status, 413);
});
