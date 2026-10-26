import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { removeTemp } from '../../test/support/temp-cleanup.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { startTestIssuer, signInWithPkce, serviceToken } from '../../test/support/test-issuer.ts';

// The real broker (grants, runner execution, RFC 7523 exchange, provider authorization, kill-switch roles) against the
// test-only issuer. This is NOT Keycloak evidence: the Compose broker checks stay the release gate.
const root = mkdtempSync(join(tmpdir(), 'cityside-p210-'));
const env = { DELEGATION_ENABLED: 'true', DELEGATION_KEY_DIR: join(root, 'keys'), DELEGATION_DB_PATH: join(root, 'grants.sqlite') };
const saved = new Map(Object.keys({ ...env, KEYCLOAK_ISSUER: 1, KEYCLOAK_JWKS_URL: 1, KEYCLOAK_TOKEN_URL: 1, PROVIDER_PAYMENTS_URL: 1, DELEGATION_ISSUER: 1 }).map(key => [key, process.env[key]]));
Object.assign(process.env, env);
const { keyMaterial } = await import('../delegation/src/keys.ts');
const { handleDelegation, delegatedAuthorization, issuerName, grantStore } = await import('../delegation/src/service.ts');
const { brokerClient, runnerClient, automationAdminClient, automationWorkerClient } = await import('../delegation/src/policy.ts');

const REDIRECT = 'http://localhost:5173/callback';
const issuer = await startTestIssuer({
  clients: {
    'superapp-shell': { redirectUris: [REDIRECT], grants: ['authorization_code'], audience: ['agent-core'] },
    'other-web': { redirectUris: [REDIRECT], grants: ['authorization_code'], audience: ['agent-core'] },
    [brokerClient]: { clientKey: keyMaterial('client').jwk, grants: ['urn:ietf:params:oauth:grant-type:jwt-bearer'], audience: ['provider-api'] },
    [runnerClient]: { secret: 'runner-secret', grants: ['client_credentials'], roles: ['delegation:execute'], audience: ['delegation-api'] },
    'plain-service': { secret: 'plain-secret', grants: ['client_credentials'], roles: [], audience: ['delegation-api'] },
    [automationAdminClient]: { secret: 'admin-secret', grants: ['client_credentials'], audience: ['delegation-api'] },
    [automationWorkerClient]: { secret: 'worker-secret', grants: ['client_credentials'], audience: ['delegation-api'] },
  },
  users: {
    alice: { sub: 'alice-sub', username: 'alice', roles: ['superapp-user'] }, bob: { sub: 'bob-sub', username: 'bob', roles: ['superapp-user'] },
    norole: { sub: 'norole-sub', username: 'norole', roles: [] },
  },
  trustedIssuers: { [`${process.env.DELEGATION_ISSUER || 'http://localhost:4000/api/delegation'}`]: [keyMaterial('issuer').jwk] },
});
Object.assign(process.env, { KEYCLOAK_ISSUER: issuer.issuer, KEYCLOAK_JWKS_URL: issuer.jwksUrl, KEYCLOAK_TOKEN_URL: issuer.tokenUrl });

// A provider that asks the broker, as the real provider does, whether the bearer may do this exact operation.
const seen: string[] = [];
const provider = http.createServer((req, res) => {
  void (async () => {
    const authorization = String(req.headers.authorization || ''), accountId = decodeURIComponent((req.url || '').split('/')[3] || '');
    seen.push(authorization);
    try {
      await delegatedAuthorization(authorization, { provider: 'payments', accountId, method: 'GET', path: '/wallet', body: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, wallet: { balanceMinor: 150000 } }));
    } catch { res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false })); }
  })();
});
await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
process.env.PROVIDER_PAYMENTS_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

test.after(async () => {
  await issuer.close(); await new Promise<void>(done => { provider.closeAllConnections(); provider.close(() => done()); });
  grantStore().db.close();
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  removeTemp(root);
});

const bearer = (token: string) => `Bearer ${token}`;
const user = async (name: string, client = 'superapp-shell') => bearer((await signInWithPkce(issuer, client, REDIRECT, name)).access_token);
const runner = async () => bearer(await serviceToken(issuer, runnerClient, 'runner-secret'));
const grantBody = (sub = 'alice-sub') => ({ accountId: accountIdFor(sub, 'personal'), provider: 'payments', method: 'GET', path: '/wallet', body: {}, purpose: 'Read my exact owned demo wallet', expiresInSeconds: 300, maxOperations: 1 });
const createGrant = async (authorization: string, body = grantBody()) => handleDelegation('POST', '/api/delegation/grants', body, authorization);
const execute = (id: string, authorization: string, requestKey = `exec-${Math.random().toString(36).slice(2, 12)}`) => handleDelegation('POST', `/api/delegation/grants/${id}/execute`, { requestKey }, authorization);

test('P2-10: an owner grants consent, the runner executes it, and the provider sees exactly the owner as the broker client', async () => {
  const created = await createGrant(await user('alice'));
  assert.equal(created?.status, 201);
  const before = seen.length, run = await execute(created!.data.grant.id, await runner());
  assert.equal(run?.status, 200, JSON.stringify(run?.data));
  assert.equal(run!.data.result.wallet.balanceMinor, 150000);
  assert.equal(seen.length, before + 1);
  const claims = JSON.parse(Buffer.from(seen.at(-1)!.split('.')[1], 'base64url').toString());
  assert.deepEqual([claims.sub, claims.azp, claims.scope, claims.act, claims.aud], ['alice-sub', brokerClient, 'delegation.read', undefined, ['provider-api']]);
  assert.ok(claims.exp - claims.iat <= 90, 'the delegated token lives no longer than the assertion');
  const second = await execute(created!.data.grant.id, await runner());
  assert.notEqual(second?.status, 200, 'a second distinct operation exceeds the grant\'s single permitted use');
  assert.equal(seen.length, before + 1, 'the provider saw only the first');
});

test('P2-10: an exact retry returns the stored result and does not reach the provider again', async () => {
  const created = await createGrant(await user('alice'), { ...grantBody(), maxOperations: 2 } as ReturnType<typeof grantBody>);
  const key = 'exec-retry-0001', first = await execute(created!.data.grant.id, await runner(), key), calls = seen.length;
  assert.equal(first?.status, 200);
  const retry = await execute(created!.data.grant.id, await runner(), key);
  assert.deepEqual([retry?.status, retry?.data.replay], [200, true]);
  assert.equal(seen.length, calls);
});

test('P2-10: only an interactive superapp user can manage consent', async () => {
  assert.equal((await handleDelegation('GET', '/api/delegation/grants', undefined, undefined))?.data.code, 'USER_AUTHENTICATION_REQUIRED');
  for (const [name, authorization] of Object.entries({
    wrongClient: await user('alice', 'other-web'), noRole: await user('norole'),
    serviceToken: bearer(await serviceToken(issuer, 'plain-service', 'plain-secret')), brokerToken: bearer(issuer.mint({ aud: ['agent-core'], azp: brokerClient })),
  })) assert.notEqual((await createGrant(authorization))?.status, 201, name);
  assert.equal((await createGrant(await user('bob'), grantBody('alice-sub')))?.data.code, 'ACCOUNT_FORBIDDEN', 'a user cannot grant another owner\'s account');
});

test('P2-10: only the runner client, with its role, can execute, and only a grant owner otherwise', async () => {
  const created = await createGrant(await user('alice')), id = created!.data.grant.id, calls = seen.length;
  const plain = bearer(await serviceToken(issuer, 'plain-service', 'plain-secret'));
  assert.equal((await execute(id, plain))?.data.code, 'RUNNER_REQUIRED');
  assert.equal((await execute(id, bearer(await serviceToken(issuer, automationAdminClient, 'admin-secret'))))?.data.code, 'RUNNER_REQUIRED');
  assert.notEqual((await execute(id, await user('bob')))?.status, 200, 'another user cannot execute it');
  const runnerWithoutRole = issuer.mint({ aud: ['delegation-api'], azp: runnerClient, preferred_username: `service-account-${runnerClient}`, realm_access: { roles: [] } });
  assert.equal((await execute(id, bearer(runnerWithoutRole)))?.data.code, 'RUNNER_REQUIRED', 'the runner client alone is not enough');
  const runnerNotServiceAccount = issuer.mint({ aud: ['delegation-api'], azp: runnerClient, preferred_username: 'alice', realm_access: { roles: ['delegation:execute'] } });
  assert.equal((await execute(id, bearer(runnerNotServiceAccount)))?.data.code, 'RUNNER_REQUIRED', 'a human name is not a service account');
  const forged = await execute(id, bearer(issuer.mintForeign({ aud: ['delegation-api'], azp: runnerClient, preferred_username: `service-account-${runnerClient}`, realm_access: { roles: ['delegation:execute'] } })));
  assert.notEqual(forged?.status, 200, 'a runner token signed by another key is refused');
  assert.equal(seen.length, calls, 'no refused caller reached the provider');
});

test('P2-10: a revoked grant is never executed and the issuer is never asked', async () => {
  const owner = await user('alice'), created = await createGrant(owner), id = created!.data.grant.id, calls = seen.length;
  assert.equal((await handleDelegation('DELETE', `/api/delegation/grants/${id}`, undefined, owner))?.status, 200);
  const run = await execute(id, await runner());
  assert.notEqual(run?.status, 200);
  assert.equal(seen.length, calls);
});

test('P2-10: when the issuer refuses the exchange nothing is executed and the failure is not retried blindly', async () => {
  const created = await createGrant(await user('alice')), id = created!.data.grant.id, calls = seen.length;
  process.env.DELEGATION_ISSUER = 'http://untrusted.test/issuer';
  try {
    const run = await execute(id, await runner());
    assert.equal(run?.status, 503);
    assert.equal(run?.data.code, 'DELEGATION_EXCHANGE_FAILED');
    assert.equal(seen.length, calls, 'the provider was not called without a delegated token');
  } finally { if (saved.get('DELEGATION_ISSUER') === undefined) delete process.env.DELEGATION_ISSUER; else process.env.DELEGATION_ISSUER = saved.get('DELEGATION_ISSUER'); }
  assert.equal(issuerName(), saved.get('DELEGATION_ISSUER') || 'http://localhost:4000/api/delegation');
});

test('P2-10: a delegated bearer is refused by the provider check when it was never bound to a grant', async () => {
  const unbound = bearer(issuer.mint({ aud: ['provider-api'], azp: brokerClient, sub: 'alice-sub', scope: 'delegation.read' }));
  await assert.rejects(() => delegatedAuthorization(unbound, { provider: 'payments', accountId: accountIdFor('alice-sub', 'personal'), method: 'GET', path: '/wallet', body: {} }));
  const wrongClient = bearer(issuer.mint({ aud: ['provider-api'], azp: 'other-web', sub: 'alice-sub', scope: 'delegation.read' }));
  await assert.rejects(() => delegatedAuthorization(wrongClient, { provider: 'payments', accountId: accountIdFor('alice-sub', 'personal'), method: 'GET', path: '/wallet', body: {} }), (e: any) => e.code === 'INVALID_DELEGATED_PRINCIPAL');
});

test('P2-10: only the admin client writes the kill switch and only the worker reads it', async () => {
  const admin = bearer(await serviceToken(issuer, automationAdminClient, 'admin-secret', 'automation.admin'));
  const worker = bearer(await serviceToken(issuer, automationWorkerClient, 'worker-secret', 'automation.execute'));
  const adminNoScope = bearer(await serviceToken(issuer, automationAdminClient, 'admin-secret'));
  const path = '/api/delegation/automation/kill-switch';
  assert.equal((await handleDelegation('POST', path, { engaged: true, reason: 'p210 check' }, admin))?.status, 200);
  assert.equal((await handleDelegation('GET', path, undefined, worker))?.data.engaged, true);
  assert.equal((await handleDelegation('GET', path, undefined, admin))?.data.code, 'KILL_SWITCH_WORKER_REQUIRED');
  assert.equal((await handleDelegation('POST', path, { engaged: false }, worker))?.data.code, 'KILL_SWITCH_ADMIN_REQUIRED');
  assert.equal((await handleDelegation('POST', path, { engaged: false }, adminNoScope))?.data.code, 'KILL_SWITCH_ADMIN_REQUIRED');
  assert.equal((await handleDelegation('POST', path, { engaged: false }, await runner()))?.data.code, 'KILL_SWITCH_ADMIN_REQUIRED');
  // The right scope on the wrong client, and delegated (act) tokens, are refused: each guard is tested on its own.
  const workerWithAdminScope = bearer(await serviceToken(issuer, automationWorkerClient, 'worker-secret', 'automation.admin'));
  const adminWithWorkerScope = bearer(await serviceToken(issuer, automationAdminClient, 'admin-secret', 'automation.execute'));
  assert.equal((await handleDelegation('POST', path, { engaged: false }, workerWithAdminScope))?.data.code, 'KILL_SWITCH_ADMIN_REQUIRED');
  assert.equal((await handleDelegation('GET', path, undefined, adminWithWorkerScope))?.data.code, 'KILL_SWITCH_WORKER_REQUIRED');
  const delegatedAdmin = bearer(issuer.mint({ aud: ['delegation-api'], azp: automationAdminClient, scope: 'automation.admin', act: { sub: 'someone' } }));
  const delegatedWorker = bearer(issuer.mint({ aud: ['delegation-api'], azp: automationWorkerClient, scope: 'automation.execute', act: { sub: 'someone' } }));
  assert.equal((await handleDelegation('POST', path, { engaged: false }, delegatedAdmin))?.data.code, 'KILL_SWITCH_ADMIN_REQUIRED');
  assert.equal((await handleDelegation('GET', path, undefined, delegatedWorker))?.data.code, 'KILL_SWITCH_WORKER_REQUIRED');
  assert.equal((await handleDelegation('GET', path, undefined, await user('alice')))?.status, 401, 'a human sign-in is not an automation token');
  assert.equal((await handleDelegation('POST', path, { engaged: true }, admin))?.status, 400, 'engaging needs a reason');
  assert.equal((await handleDelegation('GET', path, undefined, worker))?.data.engaged, true, 'refused callers changed nothing');
});
