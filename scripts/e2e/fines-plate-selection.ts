/** Read-only authenticated plate-selection check against the isolated qualification stack. */
import assert from 'node:assert/strict';
import { demoPortOffset, gatewayUrl, keycloakIssuerUrl, profileServiceUrl, walletServiceUrl } from '../endpoints.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

assert.equal(demoPortOffset, 30000, 'Run through the isolated qualification stack.');
for (const [value, port] of [[gatewayUrl, 34000], [keycloakIssuerUrl, 38085], [profileServiceUrl, 34005], [walletServiceUrl, 34003]] as const) {
  const url = new URL(value); assert.equal(url.protocol, 'http:'); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); assert.equal(Number(url.port), port);
}
const login = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123', scope: 'openid' }) });
assert.equal(login.status, 200, 'Synthetic login failed.');
const token = (await login.json() as { access_token?: string }).access_token; assert.ok(token);
const auth = { Authorization: `Bearer ${token}` };
const accountsResponse = await fetch(`${gatewayUrl}/api/accounts`, { headers: auth }); assert.equal(accountsResponse.status, 200);
const accounts = await accountsResponse.json() as { accounts: Array<{ id: string; label: string }> };
const account = accounts.accounts.find(item => item.label === 'Personal account')?.id; assert.ok(account);
const headers = { ...auth, 'X-Account-Id': account };
const profileResponse = await fetch(`${profileServiceUrl}/profile`, { headers }); assert.equal(profileResponse.status, 200);
const profile = await profileResponse.json() as { profile: { smartCityAssets: { vehicles: Array<{ plate: string }> } } };
const plate = profile.profile.smartCityAssets.vehicles[0]?.plate; assert.ok(plate);
type Fine = { fineId: string; plateNumber: string; originalAmount: number; payableAmount: number; discountAmount: number };
for (const path of ['/fines/check', '/fines']) {
  const refused = await fetch(`${walletServiceUrl}${path}?plateNumber=${encodeURIComponent('Dubai X-00000')}`, { headers });
  assert.equal(refused.status, 404);
  const response = await fetch(`${walletServiceUrl}${path}?plateNumber=${encodeURIComponent(plate)}`, { headers });
  assert.equal(response.status, 200);
  const report = await response.json() as { plateNumber: string; fines: Fine[]; count: number; totalOriginal: number; totalPayable: number; totalDiscount: number };
  assert.equal(report.plateNumber, plate); assert.ok(report.fines.length > 0);
  assert.ok(report.fines.every(fine => fine.plateNumber === plate)); assert.equal(report.count, report.fines.length);
  for (const [field, total] of [['originalAmount', report.totalOriginal], ['payableAmount', report.totalPayable], ['discountAmount', report.totalDiscount]] as const) {
    assert.equal(report.fines.reduce((sum, fine) => sum + toMinor(fine[field]), 0), toMinor(total));
  }
  const defaultResponse = await fetch(`${walletServiceUrl}${path}`, { headers }); assert.equal(defaultResponse.status, 200);
  const defaultReport = await defaultResponse.json() as { plateNumber: string; fines: Fine[] };
  assert.equal(defaultReport.plateNumber, plate);
  assert.deepEqual(defaultReport.fines.map(fine => fine.fineId).sort(), report.fines.map(fine => fine.fineId).sort());
}
console.log('PASS: selected account plate returns only its fines and reconciled totals; another plate is refused.');
