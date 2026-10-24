import { createHash, randomUUID } from 'node:crypto';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { PAYMENT_CONTRACT_VERSION, MAX_PAYMENT_MINOR, type BillerCandidate, type Payable, type PaymentPreview, type PaymentOverview } from '../../../packages/protocol-core/src/payments.ts';
const client = new ProviderClient('service-wallet', process.env.SERVICE_WALLET_CLIENT_SECRET || 'demo-wallet-secret');
export const paymentDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function paymentOverview(actor: Actor, source = client): Promise<PaymentOverview> {
  const read = (provider: string, path: string) => source.call(provider, actor, 'GET', path);
  const [methods, links, wallet, dewa, dewaBills, etisalat, etisalatBills, du, duBills, salik, fines, etisalatPrepaid, duPrepaid, vehicles, orders, funding, rtaTargets, etisalatTargets, duTargets, groups, refunds, events] = await Promise.all([
    read('payments','/payment-methods'), read('payments','/billing-accounts'), read('payments','/wallet'),
    read('dewa','/consumption'), read('dewa','/payables'), read('etisalat','/subscriptions'), read('etisalat','/payables'),
    read('du','/subscriptions'), read('du','/payables'), read('rta','/salik'), read('police','/payables'), read('etisalat','/prepaid'), read('du','/prepaid'), read('police','/vehicles'), read('payments','/payment-orders'),read('payments','/wallet-funding-orders'),read('rta','/recharge-targets'),read('etisalat','/recharge-targets'),read('du','/recharge-targets'),read('payments','/checkout-groups'),read('payments','/payment-refunds'),read('payments','/payment-events'),
  ]);
  const candidates: BillerCandidate[] = [{ provider: 'dewa', reference: dewa.account.accountNumber, label: `DEWA · ${dewa.account.accountNumber}` }, { provider: 'rta', reference: salik.tagNumber, label: `Salik · ${salik.tagNumber}` }];
  for (const [provider, data] of [['etisalat', etisalat], ['du', du]] as const) for (const subscription of data.subscriptions) {
    if (subscription.status === 'ACTIVE') candidates.push({ provider, reference: subscription.subscriptionId, label: `${provider} · ${subscription.name}` });
  }
  for (const [provider,data] of [['etisalat',etisalatPrepaid],['du',duPrepaid]] as const) for (const line of data.lines) if(line.status === 'ACTIVE') candidates.push({provider,reference:line.lineId,label:`${provider} · ${line.name}`,balanceMinor:line.balanceMinor});
  for (const vehicle of vehicles.vehicles) if(vehicle.status === 'ACTIVE') candidates.push({provider:'police',reference:vehicle.plateNumber,label:`Traffic fines · ${vehicle.plateNumber}`});
  const payables: Payable[] = [...dewaBills.payables,...etisalatBills.payables,...duBills.payables,...fines.payables];
  return { contractVersion: PAYMENT_CONTRACT_VERSION, accountId: actor.accountId, previewOnly: false, dependencies: [...methods.dependencies,...links.dependencies], methods: methods.methods, defaultMethodId: methods.defaultMethodId, presets: methods.presets,
    billingAccounts: links.billingAccounts, candidates, payables,rechargeTargets:[...rtaTargets.targets,...etisalatTargets.targets,...duTargets.targets], orders:orders.orders,checkoutGroups:groups.groups,refunds:refunds.refunds,events:events.events,fundingOrders:funding.orders,cardBalances:methods.cardBalances, wallet: { balanceMinor: wallet.balanceMinor, heldMinor: wallet.heldMinor, availableMinor: wallet.availableMinor, currency: 'AED' } };
}
export function buildPaymentPreview(overview: PaymentOverview, input: { payableId: string; methodId: string; expectedMethodVersion: number }, now = Date.now()): PaymentPreview {
  const payable = overview.payables.find(p => p.id === input.payableId);
  if (!payable || payable.status !== 'UNPAID' || payable.paymentRestricted) throw new UpstreamError(409, 'PAYABLE_UNAVAILABLE', 'Choose a current unpaid obligation.');
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
    if(method==='GET'&&path==='/api/payments/wallet-funding-orders')return {status:200,data:await client.call('payments',actor,'GET','/wallet-funding-orders')};
    if(method==='POST'&&path==='/api/payments/wallet-funding-orders'){const {accountId:_account,requestKey,...input}=body;return {status:200,data:await client.call('payments',actor,'POST','/wallet-funding-orders',input,`wallet-funding:${requestKey}`)};}
    const fundingAction=/^\/api\/payments\/wallet-funding-orders\/(approve|challenge|cancel|execute)$/.exec(path);
    if(method==='POST'&&fundingAction){const {accountId:_account,requestKey,orderId,...input}=body;return {status:200,data:await client.call('payments',actor,'POST',`/wallet-funding-orders/${encodeURIComponent(orderId)}/${fundingAction[1]}`,input,`wallet-funding:${requestKey}`)};}
    if(method==='POST'&&path==='/api/payments/refunds'){const {accountId:_account,requestKey,...input}=body;return {status:200,data:await client.call('payments',actor,'POST','/payment-refunds',input,`refund:${requestKey}`)};}
    const refundAction=/^\/api\/payments\/refunds\/(execute|recover|cancel)$/.exec(path);
    if(method==='POST'&&refundAction){const {accountId:_account,requestKey,orderId,...input}=body;return {status:200,data:await client.call('payments',actor,'POST',`/payment-refunds/${encodeURIComponent(orderId)}/${refundAction[1]}`,input,`refund:${requestKey}`)};}
    if(method==='POST'&&path==='/api/payments/checkout-groups'){const {accountId:_account,requestKey,...input}=body;return {status:200,data:await client.call('payments',actor,'POST','/checkout-groups',input,`checkout-group:${requestKey}`)};}
    const groupAction=/^\/api\/payments\/checkout-groups\/(approve|execute|cancel)$/.exec(path);
    if(method==='POST'&&groupAction){const {accountId:_account,requestKey,orderId,...input}=body;return {status:200,data:await client.call('payments',actor,'POST',`/checkout-groups/${encodeURIComponent(orderId)}/${groupAction[1]}`,input,`checkout-group:${requestKey}`)};}
    if(method==='GET'&&path==='/api/payments/orders')return {status:200,data:await client.call('payments',actor,'GET','/payment-orders')};
    if(method==='POST'&&path==='/api/payments/recharge-preview'){
      const issued=(await client.call(body.provider,actor,'POST','/recharge-quotes',{targetReference:body.targetReference,amountMinor:body.amountMinor,expectedTargetVersion:body.expectedTargetVersion,intentId:body.requestKey},`recharge-preview:${body.requestKey}`)).payable;
      const selection=(await client.call(body.provider,actor,'GET',`/payables/${encodeURIComponent(issued.id)}`)).payable;
      const overview=await paymentOverview(actor);overview.payables=[...overview.payables,selection];
      return {status:200,data:{success:true,preview:buildPaymentPreview(overview,{payableId:selection.id,methodId:body.methodId,expectedMethodVersion:body.expectedMethodVersion})}};
    }
    if(method==='POST'&&path==='/api/payments/fine-selection-preview'){
      const selection=(await client.call('police',actor,'POST','/fine-selections',{items:body.items},`fine-preview:${randomUUID()}`)).payable;
      const overview=await paymentOverview(actor);overview.payables=[...overview.payables,selection];
      return {status:200,data:{success:true,preview:buildPaymentPreview(overview,{payableId:selection.id,methodId:body.methodId,expectedMethodVersion:body.expectedMethodVersion})}};
    }
    if (method === 'POST' && path === '/api/payments/preview') return { status: 200, data: { success: true, preview: buildPaymentPreview(await paymentOverview(actor), body as { payableId: string; methodId: string; expectedMethodVersion: number }) } };
    if(method==='POST'&&path==='/api/payments/orders') {
      const {accountId:_account,requestKey,...input}=body;return {status:200,data:await client.call('payments',actor,'POST','/payment-orders',input,`payment-orders:${requestKey}`)};
    }
    const orderAction=/^\/api\/payments\/orders\/(approve|challenge|cancel|execute|recover)$/.exec(path);
    if(method==='POST'&&orderAction){
      const {accountId:_account,requestKey,orderId,...input}=body;return {status:200,data:await client.call('payments',actor,'POST',`/payment-orders/${encodeURIComponent(orderId)}/${orderAction[1]}`,input,`payment-orders:${requestKey}`)};
    }
    if (method === 'POST' && mutations[path]) {
      const { accountId: _account, requestKey, ...input } = body;
      return { status: 200, data: await client.call('payments', actor, 'POST', mutations[path], input, `payment-accounts:${requestKey}`) };
    }
    return { status: 404, data: { success: false, error: 'Payment route not found.' } };
  } catch (e) {
    return { status: e instanceof UpstreamError ? e.status : 503, data: { success: false, code: e instanceof UpstreamError ? e.code : 'PAYMENT_ACCOUNTS_UNAVAILABLE', error: e instanceof UpstreamError && e.status < 500 ? e.message : 'Payment accounts are unavailable. Refresh to inspect their current state before retrying.' } };
  }
}
