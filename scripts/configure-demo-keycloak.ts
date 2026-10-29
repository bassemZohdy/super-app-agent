import { keycloakRootUrl } from './endpoints.ts';
import { CLIENT_SECRET_VARIABLES } from './realm-client-secrets.ts';
/** Reconcile only the checked-in demo realm configuration; preserve existing user/provider data. */
import { readFileSync } from 'node:fs';
import { configureDelegation } from '../services/delegation/src/keycloak-config.ts';
const root = keycloakRootUrl;
const realm = JSON.parse(readFileSync(new URL('../services/keycloak/realm-export.json', import.meta.url), 'utf8'));
const response = await fetch(`${root}/realms/master/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN || 'admin', password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin' }) });
if (!response.ok) throw new Error('Local demo Keycloak admin authentication failed.');
const admin = (await response.json() as any).access_token;
async function api(path: string, method = 'GET', body?: any): Promise<any> {
  const result = await fetch(`${root}/admin/realms/${realm.realm}${path}`, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!result.ok) throw new Error(`Keycloak demo reconciliation failed: ${method} ${path} (${result.status})`);
  return result.status === 204 || result.headers.get('Content-Length') === '0' ? undefined : result.json().catch(() => undefined);
}
for (const role of realm.roles.realm) {
  const existing = await api('/roles');
  if (!existing.some((r: any) => r.name === role.name)) await api('/roles', 'POST', role);
}
const allRoles = await api('/roles');
for (const client of realm.clients) {
  const carried = CLIENT_SECRET_VARIABLES[client.clientId]?.variable;
  if (carried && process.env[carried]) client.secret = process.env[carried];
  const existing = await api(`/clients?clientId=${encodeURIComponent(client.clientId)}`);
  if (existing.length) await api(`/clients/${existing[0].id}`, 'PUT', { ...existing[0], ...client });
  else await api('/clients', 'POST', client);
}
for (const user of realm.users) {
  let id: string;
  if (user.serviceAccountClientId) {
    const [client] = await api(`/clients?clientId=${encodeURIComponent(user.serviceAccountClientId)}`);
    id = (await api(`/clients/${client.id}/service-account-user`)).id;
  } else {
    let users = await api(`/users?username=${encodeURIComponent(user.username)}&exact=true`);
    if (!users.length) { const { realmRoles: _roles, ...representation } = user; await api('/users', 'POST', representation); users = await api(`/users?username=${encodeURIComponent(user.username)}&exact=true`); }
    id = users[0].id;
  }
  const roles = allRoles.filter((role: any) => user.realmRoles.includes(role.name));
  if (roles.length) await api(`/users/${id}/role-mappings/realm`, 'POST', roles);
}
console.log('Demo Keycloak clients, audiences and service roles reconciled. Existing users and provider data preserved.');
if (process.env.DELEGATION_ENABLED === 'true') await configureDelegation(api);
