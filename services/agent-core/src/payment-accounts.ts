import { createHash, randomUUID } from 'node:crypto';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { PAYMENT_CONTRACT_VERSION, MAX_PAYMENT_MINOR, type BillingAccount, type BillerCandidate, type Payable, type PaymentMethod, type PaymentPreview, type PaymentOverview } from '../../../packages/protocol-core/src/payments.ts';
import { toMinor } from '../../../packages/protocol-core/src/request-validation.ts';
const client = new ProviderClient('service-wallet', process.env.SERVICE_WALLET_CLIENT_SECRET || 'demo-wallet-secret');
export const paymentDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function paymentOverview(actor: Actor, source = client): Promise<PaymentOverview> {
  const read = (provider: string, path: string) => source.call(provider, actor, 'GET', path);
  const [methods, links, wallet, dewa, dewaBills, etisalat, etisalatBills, du, duBills, salik, fines] = await Promise.all([
    read('payments','/payment-methods'), read('payments','/billing-accounts'), read('payments','/wallet'),
    read('dewa','/consumption'), read('dewa','/bills'), read('etisalat','/subscriptions'), read('etisalat','/bills'),
    read('du','/subscriptions'), read('du','/bills'), read('rta','/salik'), read('police','/fines'),
  ]);
  const candidates: BillerCandidate[] = [{ provider: 'dewa', reference: dewa.account.accountNumber, label: `DEWA · ${dewa.account.accountNumber}` }, { provider: 'rta', reference: salik.tagNumber, label: `Salik · ${salik.tagNumber}` }];
  for (const [provider, data] of [['etisalat', etisalat], ['du', du]] as const) for (const subscription of data.subscriptions) {
    if (subscription.status === 'ACTIVE') candidates.push({ provider, reference: subscription.subscriptionId, label: `${provider} · ${subscription.name}` });
  }
  for (const plate of new Set<string>(fines.fines.map((fine: { plateNumber: string }) => fine.plateNumber))) candidates.push({ provider: 'police', reference: plate, label: `Traffic fines · ${plate}` });
  const payables: Payable[] = [];
  for (const [provider, bills] of [['dewa',dewaBills.bills], ['etisalat',etisalatBills.bills], ['du',duBills.bills]] as const) for (const bill of bills) {
    if (!['UNPAID','PAID'].includes(bill.status)) continue;
    const reference = provider === 'dewa' ? dewa.account.accountNumber : bill.subscriptionId;
    const amountMinor = toMinor(bill.totalAmount);
    payables.push({ id: `${provider}:bill:${bill.billId}`, provider, reference, label: `${provider.toUpperCase()} bill ${bill.billId}`, amountMinor, currency: 'AED', status: bill.status,
      revision: paymentDigest([provider,reference,bill.billId,bill.status,amountMinor,bill.dueDate]), ...(bill.dueDate ? { dueDate: bill.dueDate } : {}) });
  }
  for (const fine of fines.fines) {
    const amountMinor = toMinor(fine.payableAmount);
    payables.push({ id: `police:fine:${fine.fineId}`, provider: 'police', reference: fine.plateNumber, label: `${fine.violation} · ${fine.fineId}`, amountMinor, currency: 'AED', status: 'UNPAID', revision: paymentDigest([fine.fineId,fine.plateNumber,fine.status,amountMinor,fine.discountAmount]) });
  }
  return { contractVersion: PAYMENT_CONTRACT_VERSION, accountId: actor.accountId, previewOnly: true, methods: methods.methods, defaultMethodId: methods.defaultMethodId, presets: methods.presets,
    billingAccounts: links.billingAccounts, candidates, payables, wallet: { balanceMinor: wallet.balanceMinor, heldMinor: wallet.heldMinor, availableMinor: wallet.availableMinor, currency: 'AED' } };
}
export function buildPaymentPreview(overview: PaymentOverview, input: { payableId: string; methodId: string; expectedMethodVersion: number }, now = Date.now()): PaymentPreview {
  const payable = overview.payables.find(p => p.id === input.payableId);
  if (!payable || payable.status !== 'UNPAID') throw new UpstreamError(409, 'PAYABLE_UNAVAILABLE', 'Choose a current unpaid obligation.');
  const billingAccount = overview.billingAccounts.find(b => b.status === 'ACTIVE' && b.accountId === overview.accountId && b.provider === payable.provider && b.reference === payable.reference);
  if (!billingAccount) throw new UpstreamError(409, 'BILLER_NOT_LINKED', 'Link this owned biller account before reviewing payment.');
  const source = overview.methods.find(m => m.id === input.methodId && m.accountId === overview.accountId);
  if (!source || source.status !== 'ACTIVE') throw new UpstreamError(409, 'METHOD_UNAVAILABLE', 'Choose an active payment method for this account.');
  if (source.version !== input.expectedMethodVersion) throw new UpstreamError(409, 'METHOD_CHANGED', 'The payment method changed. Refresh before reviewing.');
  if (source.kind === 'card' && (source.expiresYear! < new Date(now).getUTCFullYear() || source.expiresYear === new Date(now).getUTCFullYear() && source.expiresMonth! < new Date(now).getUTCMonth() + 1)) throw new UpstreamError(409, 'METHOD_EXPIRED', 'This card is expired.');
  if (!Number.isSafeInteger(payable.amountMinor) || payable.amountMinor < 1 || payable.amountMinor > MAX_PAYMENT_MINOR) throw new UpstreamError(409, 'INVALID_AMOUNT', 'The payable amount is outside the demo limit.');
  const snapshot: Omit<PaymentPreview, 'digest'> = { contractVersion: PAYMENT_CONTRACT_VERSION, previewOnly: true as const, accountId: overview.accountId, id: `preview_${randomUUID()}`,
    payable: structuredClone(payable), billingAccount: structuredClone(billingAccount), source: structuredClone(source), amountMinor: payable.amountMinor, feeMinor: 0, totalMinor: payable.amountMinor,
    currency: 'AED' as const, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() };
  return { ...snapshot, digest: paymentDigest(snapshot) };
}
const mutations: Record<string, string> = { '/api/payments/methods': '/payment-methods', '/api/payments/methods/status': '/payment-methods/status', '/api/payments/methods/default': '/payment-methods/default', '/api/payments/billing-accounts': '/billing-accounts', '/api/payments/billing-accounts/archive': '/billing-accounts/archive' };
export async function handlePaymentAccounts(actor: Actor, method: string, path: string, body: Record<string, any>) {
  if (!path.startsWith('/api/payments/')) return undefined;
  if (process.env.PROVIDER_INTEGRATION !== 'true') return { status: 503, data: { success: false, code: 'INTEGRATED_DEMO_REQUIRED', error: 'Payment accounts require the provider-backed demo.' } };
  try {
    if (method === 'GET' && path === '/api/payments/overview') return { status: 200, data: { success: true, ...await paymentOverview(actor) } };
    if (method === 'POST' && path === '/api/payments/preview') return { status: 200, data: { success: true, preview: buildPaymentPreview(await paymentOverview(actor), body as { payableId: string; methodId: string; expectedMethodVersion: number }) } };
    if (method === 'POST' && mutations[path]) {
      const { accountId: _account, requestKey, ...input } = body;
      return { status: 200, data: await client.call('payments', actor, 'POST', mutations[path], input, `payment-accounts:${requestKey}`) };
    }
    return { status: 404, data: { success: false, error: 'Payment route not found.' } };
  } catch (e) {
    return { status: e instanceof UpstreamError ? e.status : 503, data: { success: false, code: e instanceof UpstreamError ? e.code : 'PAYMENT_ACCOUNTS_UNAVAILABLE', error: e instanceof UpstreamError && e.status < 500 ? e.message : 'Payment accounts are unavailable. Refresh to inspect their current state before retrying.' } };
  }
}
