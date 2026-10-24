import { randomUUID } from 'node:crypto';
import { cardPresets, type PaymentMethod, type BillingAccount } from '../../../packages/protocol-core/src/payments.ts';
import type { AccountDatabase } from './database.ts';
export class PaymentRegistryError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const reject = (status: number, code: string, message: string): never => { throw new PaymentRegistryError(status, code, message); };
export function walletMethod(accountId: string): PaymentMethod {
  return { id: 'wallet', accountId, kind: 'wallet', nickname: 'Cityside wallet', status: 'ACTIVE', version: 1, currency: 'AED' };
}
export function paymentRegistry(db: AccountDatabase, accountId: string, method: string, path: string, body: Record<string, any>) {
  const rows = (kind: string, inactive: string) => db.db.prepare("SELECT body FROM resources WHERE account_id=? AND kind=? ORDER BY CASE WHEN json_extract(body,'$.status')=? THEN 1 ELSE 0 END,rowid DESC LIMIT 100").all(accountId,kind,inactive).map(row => JSON.parse(String(row.body)));
  const methods = () => [walletMethod(accountId), ...rows('payment-method', 'REMOVED') as PaymentMethod[]];
  const nextVersion = (current: number) => current >= 1_000_000 ? reject(409, 'VERSION_LIMIT', 'This record reached its demo version limit.') : current + 1;
  const getMethod = (id: string, expectedVersion: number): PaymentMethod => {
    const found = id === 'wallet' ? walletMethod(accountId) : db.get<PaymentMethod>(accountId, 'payment-method', id);
    if (!found) return reject(404, 'METHOD_NOT_FOUND', 'Payment method not found for this account.');
    if (found.version !== expectedVersion) return reject(409, 'METHOD_CHANGED', 'This payment method changed. Refresh before continuing.');
    return found;
  };
  if (method === 'GET' && path === '/payment-methods') return { methods: methods(), defaultMethodId: db.get<string>(accountId, 'default-method') || 'wallet', presets: cardPresets };
  if (method === 'POST' && path === '/payment-methods') {
    if (methods().filter(m => m.kind === 'card' && m.status !== 'REMOVED').length >= 20) return reject(409, 'METHOD_LIMIT', 'The demo supports up to 20 saved cards per account.');
    const preset = cardPresets.find(p => p.id === body.preset)!;
    const current = new Date();
    const item: PaymentMethod = { id: `pm_${randomUUID()}`, accountId, kind: 'card', nickname: body.nickname.trim(), version: 1,
      status: preset.id === 'expired' ? 'EXPIRED' : 'ACTIVE', currency: 'AED', preset: preset.id, last4: preset.last4,
      expiresMonth: 12, expiresYear: current.getUTCFullYear() + (preset.id === 'expired' ? -1 : 3), createdAt: current.toISOString() };
    db.put(accountId, 'payment-method', item, item.id); return { method: item };
  }
  if (method === 'POST' && path === '/payment-methods/default') {
    const item = getMethod(body.methodId, body.expectedVersion);
    if (item.status !== 'ACTIVE') return reject(409, 'METHOD_UNAVAILABLE', 'Choose an active payment method.');
    db.put(accountId, 'default-method', item.id); return { defaultMethodId: item.id };
  }
  if (method === 'POST' && path === '/payment-methods/status') {
    const item = getMethod(body.methodId, body.expectedVersion);
    if (item.kind === 'wallet') return reject(409, 'WALLET_FIXED', 'The wallet cannot be removed or disabled.');
    if (item.status === 'REMOVED' || item.status === 'EXPIRED' && body.status !== 'REMOVED') return reject(409, 'METHOD_UNAVAILABLE', 'This card cannot be reactivated.');
    if (body.status === 'REMOVED' && db.get(accountId, 'default-method') === item.id) return reject(409, 'DEFAULT_METHOD_IN_USE', 'Choose another default before removing this card.');
    // Tombstones preserve historical references. No automatic fallback is selected.
    item.status = body.status; item.version = nextVersion(item.version); db.put(accountId, 'payment-method', item, item.id); return { method: item };
  }
  if (method === 'GET' && path === '/billing-accounts') return { billingAccounts: rows('billing-account', 'ARCHIVED') };
  if (method === 'POST' && path === '/billing-accounts') {
    const links = rows('billing-account', 'ARCHIVED') as BillingAccount[];
    if (links.some(l => l.status === 'ACTIVE' && l.provider === body.provider && l.reference === body.reference)) return reject(409, 'BILLER_ALREADY_LINKED', 'This biller account is already linked.');
    if (links.filter(l => l.status === 'ACTIVE').length >= 30) return reject(409, 'BILLER_LIMIT', 'The demo supports up to 30 biller links per account.');
    const link: BillingAccount = { id: `ba_${randomUUID()}`, accountId, provider: body.provider, reference: body.reference, nickname: body.nickname.trim(), status: 'ACTIVE', version: 1, createdAt: new Date().toISOString() };
    db.put(accountId, 'billing-account', link, link.id); return { billingAccount: link };
  }
  if (method === 'POST' && path === '/billing-accounts/archive') {
    const link = db.get<BillingAccount>(accountId, 'billing-account', body.billingAccountId);
    if (!link) return reject(404, 'BILLER_NOT_FOUND', 'Biller account not found for this account.');
    if (link.version !== body.expectedVersion) return reject(409, 'BILLER_CHANGED', 'This biller account changed. Refresh before continuing.');
    link.status = 'ARCHIVED'; link.version = nextVersion(link.version); db.put(accountId, 'billing-account', link, link.id); return { billingAccount: link };
  }
  return undefined;
}
