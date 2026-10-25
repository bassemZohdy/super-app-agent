import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brokerClient, runnerClient, automationWorkerClient, idpAlias } from './policy.ts';

/** Local demo reconciliation only; never deletes/recreates a human user. */
export async function configureDelegation(api: (path: string, method?: string, body?: any) => Promise<any>) {
  const origin = process.env.DELEGATION_KEYCLOAK_BACKCHANNEL || 'http://delegation-broker:4010';
  const issuer = process.env.DELEGATION_ISSUER || 'http://localhost:4000/api/delegation';
  const idp = { alias: idpAlias, providerId: 'jwt-authorization-grant', enabled: true, trustEmail: false, storeToken: false, config: {
    issuer, useJwksUrl: 'true', jwksUrl: `${origin}/api/delegation/jwks`, jwtAuthorizationGrantEnabled: 'true', jwtAuthorizationGrantAssertionReuseAllowed: 'false', jwtAuthorizationGrantMaxAllowedAssertionExpiration: '90', jwtAuthorizationGrantAssertionSignatureAlg: 'RS256', jwtAuthorizationGrantLimitAccessTokenExp: 'true', jwtAuthorizationGrantAllowedClockSkew: '0',
  } };
  const idps = await api('/identity-provider/instances');
  await api(idps.some((p: any) => p.alias === idpAlias) ? `/identity-provider/instances/${idpAlias}` : '/identity-provider/instances', idps.some((p: any) => p.alias === idpAlias) ? 'PUT' : 'POST', idp);
  const audience = (target: string) => ({ name: `${target}-audience`, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.custom.audience': target, 'access.token.claim': 'true', 'id.token.claim': 'false', 'introspection.token.claim': 'true' } });
  for (const name of ['delegation.read', 'delegation.write']) {
    const scope = { name, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' }, protocolMappers: [audience('provider-api'), audience('cityside-verifier')] };
    const found = (await api('/client-scopes')).find((s: any) => s.name === name);
    await api(found ? `/client-scopes/${found.id}` : '/client-scopes', found ? 'PUT' : 'POST', scope);
  }
  const repr = { clientId: brokerClient, name: 'Controlled demo delegation broker', enabled: true, protocol: 'openid-connect', publicClient: false, clientAuthenticatorType: 'client-jwt', standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false, fullScopeAllowed: false, defaultClientScopes: [], optionalClientScopes: ['delegation.read', 'delegation.write'], attributes: { 'oauth2.jwt.authorization.grant.enabled': 'true', 'oauth2.jwt.authorization.grant.idp': idpAlias, 'use.jwks.url': 'true', 'jwks.url': `${origin}/api/delegation/client-jwks`, 'token.endpoint.auth.signing.alg': 'RS256', 'access.token.lifespan': '90', 'use.refresh.tokens': 'false' } };
  let [found] = await api(`/clients?clientId=${brokerClient}`);
  await api(found ? `/clients/${found.id}` : '/clients', found ? 'PUT' : 'POST', repr);
  [found] = await api(`/clients?clientId=${brokerClient}`);
  // Remove realm-default scopes assigned at client creation, including hidden mappers.
  for (const kind of ['default', 'optional']) for (const scope of await api(`/clients/${found.id}/${kind}-client-scopes`)) if (!['delegation.read', 'delegation.write'].includes(scope.name) || kind === 'default') await api(`/clients/${found.id}/${kind}-client-scopes/${scope.id}`, 'DELETE');
  for (const scope of await api('/client-scopes')) if (['delegation.read', 'delegation.write'].includes(scope.name)) await api(`/clients/${found.id}/optional-client-scopes/${scope.id}`, 'PUT');
  const profiles = await api('/client-policies/profiles');
  profiles.profiles = [...(profiles.profiles || []).filter((p: any) => p.name !== 'cityside-delegation-downscope'), { name: 'cityside-delegation-downscope', executors: [{ executor: 'downscope-assertion-grant-enforcer', configuration: {} }] }];
  await api('/client-policies/profiles', 'PUT', profiles);
  const policies = await api('/client-policies/policies');
  policies.policies = [...(policies.policies || []).filter((p: any) => p.name !== 'cityside-delegation-downscope'), { name: 'cityside-delegation-downscope', enabled: true, conditions: [{ condition: 'identity-provider-alias', configuration: { identity_provider_aliases: [idpAlias] } }], profiles: ['cityside-delegation-downscope'] }];
  await api('/client-policies/policies', 'PUT', policies);
  for (const human of await api('/users?max=100')) {
    if (human.serviceAccountClientId || !human.enabled) continue;
    const links = await api(`/users/${human.id}/federated-identity`);
    const link = links.find((p: any) => p.identityProvider === idpAlias);
    if (link && link.userId !== `cityside:${human.id}`) throw new Error('Existing delegation identity link differs; refusing to overwrite it.');
    if (!link) await api(`/users/${human.id}/federated-identity/${idpAlias}`, 'POST', { identityProvider: idpAlias, userId: `cityside:${human.id}`, userName: human.username });
  }
  mkdirSync('.data/delegation', { recursive: true, mode: 0o700 });
  const secretPath = '.data/delegation/runner-secret';
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  let roles = await api('/roles');
  if (!roles.some((r: any) => r.name === 'delegation:execute')) { await api('/roles', 'POST', { name: 'delegation:execute', description: 'Execute existing explicitly consented demo grants only' }); roles = await api('/roles'); }
  const runner = { clientId: runnerClient, enabled: true, protocol: 'openid-connect', publicClient: false, clientAuthenticatorType: 'client-secret', secret: readFileSync(secretPath, 'utf8'), standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true, fullScopeAllowed: false, protocolMappers: [audience('delegation-api'), audience('cityside-verifier'), { name: 'runner-roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper', config: { 'claim.name': 'realm_access.roles', 'access.token.claim': 'true', multivalued: 'true', 'jsonType.label': 'String' } }] };
  let [r] = await api(`/clients?clientId=${runnerClient}`);
  await api(r ? `/clients/${r.id}` : '/clients', r ? 'PUT' : 'POST', runner);
  [r] = await api(`/clients?clientId=${runnerClient}`);
  const role = roles.find((item: any) => item.name === 'delegation:execute');
  await api(`/clients/${r.id}/scope-mappings/realm`, 'POST', [role]);
  const serviceUser = await api(`/clients/${r.id}/service-account-user`);
  await api(`/users/${serviceUser.id}/role-mappings/realm`, 'POST', [role]);
  // Per-execution automation worker: a service account that can only ask the broker for one execution credential.
  const workerScope = { name: 'automation.execute', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' } };
  const foundScope = (await api('/client-scopes')).find((s: any) => s.name === workerScope.name);
  await api(foundScope ? `/client-scopes/${foundScope.id}` : '/client-scopes', foundScope ? 'PUT' : 'POST', workerScope);
  const workerSecretPath = '.data/delegation/automation-worker-secret';
  if (!existsSync(workerSecretPath)) writeFileSync(workerSecretPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const worker = { clientId: automationWorkerClient, enabled: true, protocol: 'openid-connect', publicClient: false, clientAuthenticatorType: 'client-secret', secret: readFileSync(workerSecretPath, 'utf8'), standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true, fullScopeAllowed: false, defaultClientScopes: [], optionalClientScopes: ['automation.execute'], protocolMappers: [audience('delegation-api'), audience('provider-api'), audience('cityside-verifier'), { name: 'worker-username', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-property-mapper', config: { 'user.attribute': 'username', 'claim.name': 'preferred_username', 'access.token.claim': 'true', 'id.token.claim': 'false', 'jsonType.label': 'String' } }], attributes: { 'use.refresh.tokens': 'false', 'access.token.lifespan': '300' } };
  let [w] = await api(`/clients?clientId=${automationWorkerClient}`);
  await api(w ? `/clients/${w.id}` : '/clients', w ? 'PUT' : 'POST', worker);
  [w] = await api(`/clients?clientId=${automationWorkerClient}`);
  for (const kind of ['default', 'optional']) for (const scope of await api(`/clients/${w.id}/${kind}-client-scopes`)) if (scope.name !== 'automation.execute' || kind === 'default') await api(`/clients/${w.id}/${kind}-client-scopes/${scope.id}`, 'DELETE');
  const executeScope = (await api('/client-scopes')).find((s: any) => s.name === workerScope.name);
  await api(`/clients/${w.id}/optional-client-scopes/${executeScope.id}`, 'PUT');
  console.log('Demo JWT-grant IdP, private-key broker, scope policy, runner and existing-user links reconciled. No preview features enabled.');
}
