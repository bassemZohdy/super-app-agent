import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { join } from 'node:path';
import { verifyJwt, type JwtClaims } from '../../../packages/backend-kit/src/jwt.ts';
import { logEvent } from '../../../packages/backend-kit/src/redact.ts';
import { brokerClient, runnerClient, DelegationError, deny, digest, tokenHash,grantInput } from './policy.ts';
import { GrantStore } from './store.ts';
import { PermitStore, type ExecutionView, type Permit } from './permits.ts';
import { issueExecutionCredential, MintRefused, type AutomationDeps } from './automation.ts';
import { assertionTimes, keyMaterial, signedJwt } from './keys.ts';
import { EligibilityClient,EligibilityReadError,eligibilityEnforced } from '../../../packages/backend-kit/src/eligibility-client.ts';
import { actorFor } from '../../../packages/backend-kit/src/context.ts';
const eligibilityReader=new EligibilityClient();
async function currentEligibility(owner:string,accountId:string,epoch?:string,authorization?:string){
  if(!eligibilityEnforced())return undefined;
  try{return (await eligibilityReader.require(actorFor({sub:owner},accountId,authorization),epoch)).epoch;}
  catch(e){throw new DelegationError(e instanceof EligibilityReadError&&[403,409].includes(e.status)?e.status:503,'ELIGIBILITY_DENIED','Current owner/workspace permission does not authorize this grant. Create new consent after access is restored.');}
}

export const delegationEnabled = () => process.env.DELEGATION_ENABLED === 'true';
let singleton: GrantStore | undefined;
export const grantStore = () => singleton ||= new GrantStore(process.env.DELEGATION_DB_PATH || join('.data/delegation', 'grants.sqlite'));
export const issuerName = () => process.env.DELEGATION_ISSUER || 'http://localhost:4000/api/delegation';
type Reply = { status: number; data: any };
function checkedEndpoint(raw: string) { const u = new URL(raw); if (u.username || u.password || !['http:', 'https:'].includes(u.protocol) || (process.env.NODE_ENV === 'production' && u.protocol !== 'https:')) throw new Error('Invalid delegation endpoint'); return u; }
async function user(authorization?: string) {
  let c: JwtClaims;
  try { c = await verifyJwt(authorization, 'agent-core'); } catch { throw new DelegationError(401, 'USER_AUTHENTICATION_REQUIRED', 'Sign in to manage consent.'); }
  if (c.azp !== 'superapp-shell' || !c.realm_access?.roles?.includes('superapp-user') || c.act !== undefined || String(c.preferred_username || '').startsWith('service-account-')) deny('INTERACTIVE_USER_REQUIRED');
  return c;
}
export async function delegatedAuthorization(authorization: string | undefined, input: { provider: string; accountId: string; method: string; path: string; body: Record<string, unknown> }): Promise<JwtClaims> {
  const c = await verifyJwt(authorization, 'provider-api');
  if (c.azp !== brokerClient || c.act !== undefined || !['delegation.read', 'delegation.write'].some(scope => String(c.scope || '').split(' ').includes(scope))) deny('INVALID_DELEGATED_PRINCIPAL');
  const operation = { provider: input.provider, method: input.method, path: input.path, body: input.body } as Parameters<GrantStore['authorize']>[4];
  if (!String(c.scope).split(' ').includes(input.method === 'GET' ? 'delegation.read' : 'delegation.write')) deny('SCOPE_REQUIRED');
  const fingerprint=tokenHash(authorization!.slice(7)),grant=grantStore().boundGrant(fingerprint);await currentEligibility(grant.owner,grant.accountId,grant.eligibilityEpoch||'1:1');
  grantStore().authorize(fingerprint, c.sub, c.azp, input.accountId, operation);
  return c;
}
async function exchange(grant: ReturnType<GrantStore['get']>, operationId: string) {
  await currentEligibility(grant.owner,grant.accountId,grant.eligibilityEpoch||'1:1');
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) throw new Error('Keycloak issuer required');
  const time = assertionTimes(grant.expiresAt);
  if (time.exp <= time.iat) deny('GRANT_INACTIVE');
  const scope = grant.method === 'GET' ? 'delegation.read' : 'delegation.write';
  const assertion = signedJwt('issuer', { ...time, iss: issuerName(), sub: `cityside:${grant.owner}`, aud: issuer, scope, delegation_grant_id: grant.id, intended_client: brokerClient });
  const clientAssertion = signedJwt('client', { ...assertionTimes(Date.now() + 60000), iss: brokerClient, sub: brokerClient, aud: issuer });
  const response = await fetch(checkedEndpoint(process.env.KEYCLOAK_TOKEN_URL || `${issuer}/protocol/openid-connect/token`), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: brokerClient, assertion, scope, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: clientAssertion }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string; error_description?: string };
    // OAuth errors are bounded diagnostics only; assertions and tokens are never logged.
    logEvent('error', 'Delegation exchange rejected', { status: response.status, error: String(error.error || '').slice(0, 100), error_description: String(error.error_description || '').replace(/[A-Za-z0-9_-]{60,}/g, '[redacted]').slice(0, 250) });
    throw new DelegationError(503, 'DELEGATION_EXCHANGE_FAILED', `Keycloak rejected the delegated exchange (${response.status}).`);
  }
  const data = await response.json() as { access_token: string; refresh_token?: string };
  if (data.refresh_token || typeof data.access_token !== 'string') throw new Error('Unexpected delegated response');
  const authorization = `Bearer ${data.access_token}`, c = await verifyJwt(authorization, 'provider-api');
  const aud = typeof c.aud === 'string' ? [c.aud] : c.aud;
  if (c.sub !== grant.owner || c.azp !== brokerClient || c.exp > time.exp || c.act !== undefined || String(c.scope || '').split(' ').filter(Boolean).some(value => value !== scope) || !String(c.scope || '').split(' ').includes(scope) || !Array.isArray(aud) || aud.some(value => !['provider-api', 'cityside-verifier'].includes(value)) || (c.realm_access?.roles?.length || 0) > 0) deny('ISSUED_TOKEN_MISMATCH');
  await currentEligibility(grant.owner,grant.accountId,grant.eligibilityEpoch||'1:1');
  grantStore().bind(tokenHash(data.access_token), { grantId: grant.id, version: grant.version, sub: c.sub, actor: c.azp, exp: c.exp, operationId, requestDigest: digest({ provider: grant.provider, method: grant.method, path: grant.path, body: grant.body }) });
  return authorization;
}
async function execute(id: string, requestKey: unknown, authorization?: string): Promise<Reply> {
  let c: JwtClaims;
  try { c = await user(authorization); } catch {
    c = await verifyJwt(authorization, 'delegation-api');
    if (c.azp !== runnerClient || !c.realm_access?.roles?.includes('delegation:execute') || !String(c.preferred_username || '').startsWith('service-account-')) deny('RUNNER_REQUIRED');
  }
  const store = grantStore(), g = store.active(id);
  if (c.azp !== runnerClient && g.owner !== c.sub) deny('GRANT_NOT_FOUND');
  await currentEligibility(g.owner,g.accountId,g.eligibilityEpoch||'1:1');
  if (typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) throw new DelegationError(400, 'IDEMPOTENCY_REQUIRED', 'Provide a stable execution key of 8–100 letters, digits, underscores or hyphens.');
  const { job, replay } = store.start(id, requestKey);
  if (replay) {
    if (job.state === 'completed') return { status: 200, data: { success: true, replay: true, operationId: job.id, result: job.result } };
    throw new DelegationError(409, 'RECONCILIATION_REQUIRED', 'This execution is pending or uncertain. Inspect operation status before doing anything else.');
  }
  store.audit(id, 'execution.initiator', { operationId: job.id, sub: c.sub, client: c.azp });
  try {
    const bearer = await exchange(g, job.id);
    const ports: Record<string, number> = { rta: 4101, dewa: 4102, etisalat: 4103, du: 4104, police: 4105, dld: 4106, payments: 4107 };
    const target = new URL(`/v1/accounts/${encodeURIComponent(g.accountId)}${g.path}`, checkedEndpoint(process.env[`PROVIDER_${g.provider.toUpperCase()}_URL`] || `http://localhost:${ports[g.provider]}`));
    const response = await fetch(target, { method: g.method, redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: bearer, 'Content-Type': 'application/json', 'Idempotency-Key': `delegation-${job.id}` }, ...(g.method === 'POST' ? { body: JSON.stringify(g.body) } : {}) });
    const result = await response.json() as { success?: boolean };
    const success = response.ok && result.success === true;
    store.finish(job, result, success);
    return { status: success ? 200 : response.status, data: { success, operationId: job.id, result,
      ...(!success ? { code: 'DELEGATED_PROVIDER_REJECTED', error: 'The provider could not authorize or complete this operation. Inspect its status before retrying.' } : {}) } };
  } catch (e) {
    store.finish(job, { code: e instanceof DelegationError ? e.code : 'EXECUTION_OUTCOME_UNKNOWN' }, false);
    throw e;
  }
}

let permitSingleton: PermitStore | undefined;
const permitStore = () => permitSingleton ||= new PermitStore(grantStore().db);
/** The provider read is made with the worker's own token, so the provider authenticates the exact workload. */
async function readExecutionView(runId: string, executionId: string, authorization: string): Promise<ExecutionView> {
  const base = checkedEndpoint(process.env.PROVIDER_PAYMENTS_URL || 'http://localhost:4107');
  const response = await fetch(new URL(`/internal/automation-runs/${runId}/execution/${encodeURIComponent(executionId)}`, base), { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: authorization } });
  if (!response.ok) throw new DelegationError(response.status === 404 ? 404 : response.status === 403 ? 403 : 503, 'AUTOMATION_EXECUTION_UNAVAILABLE', 'The prepared execution could not be read; no credential is issued.');
  const data = await response.json() as { execution?: ExecutionView };
  if (!data.execution) throw new DelegationError(503, 'AUTOMATION_EXECUTION_UNAVAILABLE', 'The prepared execution could not be read; no credential is issued.');
  return data.execution;
}
async function mintExecutionToken(permit: Permit) {
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) throw new Error('Keycloak issuer required');
  const time = assertionTimes(permit.expiresAt), scope = 'delegation.write';
  const assertion = signedJwt('issuer', { ...time, iss: issuerName(), sub: `cityside:${permit.owner}`, aud: issuer, scope, automation_permit_id: permit.id, intended_client: brokerClient });
  const clientAssertion = signedJwt('client', { ...assertionTimes(Date.now() + 60000), iss: brokerClient, sub: brokerClient, aud: issuer });
  const response = await fetch(checkedEndpoint(process.env.KEYCLOAK_TOKEN_URL || `${issuer}/protocol/openid-connect/token`), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: brokerClient, assertion, scope, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: clientAssertion }),
  });
  if (!response.ok) {
    logEvent('error', 'Automation credential exchange rejected', { status: response.status });
    if (response.status >= 400 && response.status < 500) throw new MintRefused(`rejected ${response.status}`);
    throw new Error(`exchange failed ${response.status}`);
  }
  const data = await response.json() as { access_token: string; refresh_token?: string };
  if (data.refresh_token || typeof data.access_token !== 'string') throw new Error('Unexpected delegated response');
  const c = await verifyJwt(`Bearer ${data.access_token}`, 'provider-api');
  if (c.act !== undefined || (c.realm_access?.roles?.length || 0) > 0) deny('ISSUED_TOKEN_MISMATCH');
  return { accessToken: data.access_token, sub: c.sub, azp: String(c.azp), exp: c.exp, fingerprint: tokenHash(data.access_token) };
}
const automationDeps = (): AutomationDeps => ({
  permits: permitStore(), readView: readExecutionView, mint: mintExecutionToken,
  eligible: async view => { await currentEligibility(view.ownerSub, view.accountId); },
});
async function automationCredential(path: string, body: any, authorization?: string): Promise<Reply> {
  const route = /^\/api\/delegation\/automation\/executions\/([A-Za-z0-9_-]{1,200})\/credential$/.exec(path);
  if (!route) return { status: 404, data: { success: false, code: 'NOT_FOUND' } };
  let claims: JwtClaims;
  try { claims = await verifyJwt(authorization, 'delegation-api'); } catch { throw new DelegationError(401, 'AUTOMATION_WORKER_REQUIRED', 'A valid automation workload token is required.'); }
  const out = await issueExecutionCredential(automationDeps(), { ...claims, azp: String(claims.azp) }, authorization!, { runId: body?.runId, executionId: route[1] });
  return { status: 200, data: { success: true, ...out } };
}
export async function handleDelegation(method: string, path: string, body: any, authorization?: string): Promise<Reply | undefined> {
  if (!path.startsWith('/api/delegation')) return undefined;
  if (!delegationEnabled()) return { status: 404, data: { success: false, code: 'DELEGATION_DISABLED' } };
  if (process.env.NODE_ENV === 'production') return { status: 503, data: { success: false, code: 'DEMO_PROFILE_ONLY' } };
  try {
    if (method === 'GET' && ['/api/delegation/jwks', '/api/delegation/client-jwks'].includes(path)) return { status: 200, data: { keys: [keyMaterial(path.endsWith('/client-jwks') ? 'client' : 'issuer').jwk] } };
    if (path === '/api/delegation/authorize' && method === 'POST') { const claims = await delegatedAuthorization(authorization, body); return { status: 200, data: { success: true, sub: claims.sub, actor: claims.azp } }; }
    if (path.startsWith('/api/delegation/automation/')) return method === 'POST' ? await automationCredential(path, body, authorization) : { status: 404, data: { success: false, code: 'NOT_FOUND' } };
    const executePath = /^\/api\/delegation\/grants\/([a-f0-9-]{36})\/execute$/.exec(path);
    if (executePath && method === 'POST') return await execute(executePath[1], body.requestKey, authorization);
    const c = await user(authorization), store = grantStore();
    const narrowPath = /^\/api\/delegation\/grants\/([a-f0-9-]{36})\/narrow$/.exec(path);
    if (narrowPath && method === 'POST') return { status: 200, data: { success: true, grant: store.narrow(narrowPath[1], c.sub, body) } };
    if (path === '/api/delegation/grants') {
      if (method === 'GET') return { status: 200, data: { success: true, grants: store.list(c.sub) } };
      if (method === 'POST') {const input=grantInput(c.sub,body),epoch=await currentEligibility(c.sub,input.accountId,undefined,authorization);return { status: 201, data: { success: true, grant: store.create(c.sub,input,epoch) } };}
    }
    const item = /^\/api\/delegation\/grants\/([a-f0-9-]{36})(\/(?:history|operations))?$/.exec(path);
    if (item) {
      if (method === 'DELETE' && !item[2]) return { status: 200, data: { success: true, grant: store.revoke(item[1], c.sub) } };
      if (method === 'GET') return { status: 200, data: { success: true, ...(item[2] === '/history' ? { history: store.history(item[1], c.sub) } : item[2] === '/operations' ? { operations: store.jobs(item[1], c.sub) } : { grant: store.get(item[1], c.sub) }) } };
    }
    return { status: 404, data: { success: false, code: 'NOT_FOUND' } };
  } catch (e) { return { status: e instanceof DelegationError ? e.status : 503, data: { success: false, code: e instanceof DelegationError ? e.code : 'DELEGATION_UNAVAILABLE', error: e instanceof DelegationError ? e.message : 'Delegation is unavailable; no additional execution is permitted.' } }; }
}
