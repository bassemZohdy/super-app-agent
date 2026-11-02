import { Telemetry,correlation } from './observability.ts';
import { HttpPolicy, HttpError, readJsonBody, isPlainJsonObject } from './http-policy.ts';
import { EligibilityClient,EligibilityReadError,eligibilityEnforced } from './eligibility-client.ts';
import http from 'node:http';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AccountDatabase } from '../../../services/provider-simulator/src/database.ts';
import { ProviderClient, UpstreamError } from './provider-client.ts';
import { actorFor, assetsFor, actorContext, type Actor } from './context.ts';
import { verifyJwt } from './jwt.ts';
import { validateRequest, toMinor } from '../../protocol-core/src/request-validation.ts';
import type { CheckoutGroupView } from '../../protocol-core/src/payments.ts';
import { currentProfile, currentPreferences, generatePromptContext } from '../../../services/service-profile/src/index.ts';
import { restaurants } from '../../../services/service-food/src/index.ts';
type PayableRevision = { payableId: string; expectedRevision: string };
type ReviewedGroupPayable = PayableRevision & { provider: 'dewa' | 'police' };
type Payable = { id: string; kind: string; provider: string; status: string; reference: string; revision: string; obligationId: string; amountMinor: number; currency: string };
type Bill = { billId: string; status: string; totalAmount: number; receiptNumber: string; expiresAt?: string; premiseId?: string; accountNumber?: string };
type Fine = { fineId: string; plateNumber: string; payableId: string; payableRevision: string };
type BillingAccount = { status: string; provider: string; reference: string };
type RechargeTarget = { reference: string; version: number };
type Zone = { id: string; tariffPerHour: number };
type Meter = { ticketId: string; zoneId: string; durationHours: number };
type PlannedItem = { provider: string; payableId: string; expectedPayableRevision: string };
// Documentary shape of the JSON request body. Fields are the ones these routes read; runtime is unchanged.
type RequestBody = {
  billId: string; operationId: string; expectedPayables: PayableRevision[]; expectedPayableRevision: string; expectedAmountMinor: number;
  zoneId: string; plateNumber: string; durationHours: number; additionalHours: number; ticketId: string; amount: number;
  restaurantId: string; items: string[]; referenceId: string; fineIds: string[]; methodId: string; expectedMethodVersion: number;
  lineId: string; expectedTag: string; targetReference: string; amountMinor: number; expectedTargetVersion: number; mobility: Record<string, unknown>; ui: Record<string, unknown>;
};
type Result = { status: number; data: unknown };
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
function sameFineSelection(value: unknown, ids: string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as { kind?: unknown; provider?: unknown; id?: unknown; reference?: unknown; revision?: unknown; obligationId?: unknown; items?: unknown };
  if (selection.kind !== 'FINE_SET' || selection.provider !== 'police' || typeof selection.id !== 'string' || !selection.id ||
    typeof selection.reference !== 'string' || !selection.reference || typeof selection.revision !== 'string' || !selection.revision || typeof selection.obligationId !== 'string' || !selection.obligationId || !Array.isArray(selection.items)) return false;
  const selected: unknown[] = selection.items.map((item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? (item as { obligationId?: unknown }).obligationId : undefined);
  return selected.length === ids.length && selected.every(id => typeof id === 'string' && ids.includes(id)) && new Set(selected).size === ids.length;
}
type Legacy = (method: string, path: string, query?: Record<string, string>, body?: RequestBody) => Result;
const clients = new Map<string, ProviderClient>();
const stores = new Map<string, AccountDatabase>();
const eligibilityReader=new EligibilityClient();
const successful = (data: Record<string, unknown>): Result => ({ status: 200, data: { success: true, ...data } });
function clientFor(service: string) {
  let client = clients.get(service);
  if (!client) { client = new ProviderClient(service, process.env[`${service.replace(/-/g, '_').toUpperCase()}_CLIENT_SECRET`] || process.env.SERVICE_CLIENT_SECRET || ''); clients.set(service, client); }
  return client;
}
function storeFor(service: string) {
  let store = stores.get(service);
  if (!store) { store = new AccountDatabase(join(process.env.APP_DATA_DIR || '.data/application', `${service}.sqlite`)); stores.set(service, store); }
  return store;
}
export async function integratedRequest(service: string, actor: Actor, method: string, path: string, query: Record<string, string>, body: RequestBody, legacy: Legacy): Promise<Result> {
  const db = storeFor(service), accounts = db.accounts(actor.sub);
  if (path === '/accounts' && method === 'GET') return eligibilityEnforced()?successful(await clientFor(service).call('payments',actor,'GET','/v1/accounts')):successful({ accounts });
  if (!db.owns(actor.sub, actor.accountId)) return { status: 403, data: { success: false, code: 'ACCOUNT_FORBIDDEN', error: 'This account does not belong to the signed-in user.' } };
  const client = clientFor(service), asset = assetsFor(actor.accountId);
  if(eligibilityEnforced())try{actor.eligibilityEpoch=(await eligibilityReader.require(actor)).epoch;}catch(e){return {status:e instanceof EligibilityReadError&&e.status===403?403:503,data:{success:false,code:e instanceof EligibilityReadError&&e.status===403?'ACCOUNT_RESTRICTED':'ELIGIBILITY_UNAVAILABLE',error:'Current owner/workspace eligibility does not admit this request. History is retained.'}};}
  const call = (provider: string, verb: string, route: string, data?: unknown, key?: string) => client.call(provider, actor, verb, route, data, key);
  const ownedUtility = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value) && (value as Bill).accountNumber === asset.utilityAccount && ((value as Bill).premiseId === undefined || (value as Bill).premiseId === asset.premiseId);
  const stableKey = (value: string) => createHash('sha256').update(`${actor.accountId}:${value}`).digest('hex');
  const charge = async (provider: string, reference: string, amount: number) => call('payments', 'POST', '/charges', { amountMinor: Math.round(amount * 100), merchant: provider, reference, source: 'wallet' }, stableKey(`charge:${provider}:${reference}`));
  const executePayable = async (provider:string,payable:Payable, verifyOrder?: (order: unknown) => boolean) => {
    const prefix=payable.kind==='RECHARGE'?'recharge':provider==='police'?'fine':'bill';
    const links=(await call('payments','GET','/billing-accounts')).billingAccounts;
    if(!links.some((b:BillingAccount)=>b.status==='ACTIVE'&&b.provider===provider&&b.reference===payable.reference)) {
      try{await call('payments','POST','/billing-accounts',{provider,reference:payable.reference,nickname:`${provider.toUpperCase()} account`},stableKey(`${prefix}-link:${provider}:${payable.reference}`));}
      catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}
    }
    const created=await call('payments','POST','/payment-orders',{provider,payableId:payable.id,expectedPayableRevision:payable.revision,methodId:'wallet',expectedMethodVersion:1},stableKey(`${prefix}-order:${provider}:${payable.obligationId}:${payable.revision}:${actor.requestId}`));
    const originalId=created?.order?.id;
    if(typeof originalId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(originalId))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original payment order could not be confirmed. Inspect the original payment order.');
    let order=(await call('payments','GET',`/payment-orders/${originalId}`)).order;
    let originalQuote: string | undefined, originalDigest: string | undefined;
    const verify = () => { if (!order||order.id!==originalId||order.ownerSub!==actor.sub||order.accountId!==actor.accountId||typeof order.approvalDigest!=='string'||!/^[a-f0-9]{64}$/.test(order.approvalDigest)||order.quote?.currency!=='AED'||order.quote?.source?.id!=='wallet'||order.quote?.source?.accountId!==actor.accountId||order.quote?.source?.kind!=='wallet'||order.quote?.source?.version!==1||verifyOrder&&!verifyOrder(order)||originalQuote!==undefined&&(order.approvalDigest!==originalDigest||canonicalJson(order.quote)!==originalQuote)) throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original payment order could not be confirmed. Inspect the original payment order.'); };
    verify();
    originalQuote=canonicalJson(order.quote); originalDigest=order.approvalDigest;
    const quoteHash=createHash('sha256').update(originalQuote).digest('hex');
    db.transaction(()=>{
      const saved=db.get<{ownerSub:string;approvalDigest:string;quoteHash:string}>(actor.accountId,'payment-quote-binding',originalId);
      if(saved){
        if(saved.ownerSub!==actor.sub||saved.approvalDigest!==originalDigest||saved.quoteHash!==quoteHash)throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original payment order could not be confirmed. Inspect the original payment order.');
      }else db.put(actor.accountId,'payment-quote-binding',{ownerSub:actor.sub,approvalDigest:originalDigest,quoteHash},originalId);
    });
    if(order.state==='AWAITING_APPROVAL')order=(await call('payments','POST',`/payment-orders/${order.id}/approve`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`${prefix}-authorize:${order.id}`))).order;
    verify();
    if(order.state==='AUTHORIZED')order=(await call('payments','POST',`/payment-orders/${order.id}/execute`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`${prefix}-execute:${order.id}`))).order;
    else if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state))order=(await call('payments','POST',`/payment-orders/${order.id}/recover`,{},stableKey(`${prefix}-recover:${order.id}:${actor.requestId}`))).order;
    verify();
    if(order.state!=='SETTLED')throw new UpstreamError(order.fundsCaptured?502:409,order.failureCode||'PAYMENT_REQUIRES_REVIEW',order.fundsCaptured?'Payment was captured but settlement needs reconciliation. Inspect the original payment order.':'Payment stopped without capture. Review the original order.');
    return order;
  };
  const settleBill = async (provider: string, billId?: string) => {
    const { bills } = await call(provider, 'GET', '/bills');
    if (!Array.isArray(bills)) throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The bills could not be read.');
    const bill: Bill | undefined = bills.find((b: Bill) => (billId === undefined || b?.billId === billId) && (provider !== 'dewa' || ownedUtility(b)));
    if (!bill) throw new UpstreamError(404, 'NOT_FOUND', 'Bill not found.');
    if (bill.status === 'PAID') {
      if (body.expectedAmountMinor !== undefined && body.expectedAmountMinor !== Math.round(bill.totalAmount * 100))
        throw new UpstreamError(409, 'PAYABLE_CHANGED', 'The reviewed bill changed. Review its current terms again.');
      return { success: true, bill, chargedAmount: 0, receipt: { billId: bill.billId, ...(bill.premiseId ? { premiseId: bill.premiseId } : {}), receiptNumber: bill.receiptNumber, amountPaid: bill.totalAmount.toFixed(2), currency: 'AED' } };
    }
    if (bill.status !== 'UNPAID' || bill.expiresAt && Date.parse(bill.expiresAt) <= Date.now()) throw new UpstreamError(409, 'PAYABLE_UNAVAILABLE', 'This bill is no longer payable.');
    const payable=(await call(provider,'GET','/payables')).payables.find((p:Payable)=>p.obligationId===bill.billId);
    if(!payable||payable.kind!=='BILL'||payable.provider!==provider||provider==='dewa'&&payable.reference!==asset.utilityAccount||typeof payable.id!=='string'||!payable.id||typeof payable.reference!=='string'||!payable.reference||typeof payable.revision!=='string'||!payable.revision||!Number.isSafeInteger(payable.amountMinor)||payable.amountMinor<0||payable.status!=='UNPAID'||payable.amountMinor!==Math.round(bill.totalAmount*100)||body.expectedPayableRevision&&body.expectedPayableRevision!==payable.revision||body.expectedAmountMinor!==undefined&&body.expectedAmountMinor!==payable.amountMinor)throw new UpstreamError(409,'PAYABLE_CHANGED','The reviewed bill changed. Review its current terms again.');
    const sameOrder=(value:unknown)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return false;
      const order=value as {quote?:{totalMinor?:unknown;payable?:Payable}}, quoted=order.quote?.payable;
      return !!quoted&&quoted.kind==='BILL'&&quoted.provider===provider&&quoted.id===payable.id&&quoted.revision===payable.revision&&quoted.obligationId===bill.billId&&quoted.reference===payable.reference&&quoted.amountMinor===payable.amountMinor&&order.quote?.totalMinor===payable.amountMinor;
    };
    const order=await executePayable(provider,payable,sameOrder);
    if(!order.receipt||typeof order.receipt.receiptNumber!=='string'||!order.receipt.receiptNumber||order.receipt.obligationId!==bill.billId||order.receipt.amountMinor!==payable.amountMinor||order.receipt.currency!=='AED')throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The bill settlement could not be confirmed. Inspect the original payment order.');
    const paid=(await call(provider,'GET','/bills')).bills.find((b:Bill)=>b.billId===bill.billId),wallet=await call('payments','GET','/wallet');
    return {success:true,bill:paid,receipt:{billId:bill.billId,receiptNumber:order.receipt.receiptNumber,amountPaid:(order.receipt.amountMinor/100).toFixed(2),currency:'AED',...(bill.premiseId?{premiseId:bill.premiseId}:{})},chargedAmount:order.quote.totalMinor/100,remainingBalance:wallet.balance};
  };
  const settleFines = async (fineIds?: string[]) => {
    const report = await call('police', 'GET', '/fines');
    if (!Array.isArray(report.fines)) throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The selected fines could not be confirmed.');
    const fines = fineIds ? report.fines.filter((f: Fine) => fineIds.includes(f.fineId)) : report.fines;
    if (fineIds && fineIds.length !== fines.length) throw new UpstreamError(404, 'NOT_FOUND', 'Unpaid fines not found.');
    if (fines.some((fine: Fine) => !fine || fine.plateNumber !== asset.plate)) throw new UpstreamError(404, 'NOT_FOUND', 'Unpaid fines not found for the account plate.');
    if (!fines.length) return { success: true, amountPaid: 0, finesCleared: 0, fineIds: [], receiptNumber: 'NO_FINES', remainingBalance: (await call('payments', 'GET', '/wallet')).balance };
    const ids=fines.map((f:Fine)=>f.fineId).sort();
    const currentItems=fines.map((f:Fine)=>({payableId:f.payableId,expectedRevision:f.payableRevision}));
    if(body.expectedPayables&&(body.expectedPayables.length!==currentItems.length||currentItems.some((i:PayableRevision)=>!body.expectedPayables.some((p:PayableRevision)=>p.payableId===i.payableId&&p.expectedRevision===i.expectedRevision))))throw new UpstreamError(409,'PAYABLE_CHANGED','The selected fine revisions changed. Review them again.');
    const payable=(await call('police','POST','/fine-selections',{items:body.expectedPayables||currentItems},stableKey(`fine-selection:${ids.join(',')}:${JSON.stringify(currentItems)}`))).payable;
    if(!sameFineSelection(payable,ids)||payable.reference!==asset.plate||!Number.isSafeInteger(payable.amountMinor)||payable.amountMinor<0)throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The selected fines could not be confirmed.');
    if(body.expectedAmountMinor!==undefined&&body.expectedAmountMinor!==payable.amountMinor)throw new UpstreamError(409,'PAYABLE_CHANGED','The reviewed fine amount changed.');
    const sameOrder=(value:unknown)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return false;
      const order=value as {quote?:{totalMinor?:unknown;payable?:Payable}}, quoted=order.quote?.payable;
      return !!quoted&&sameFineSelection(quoted,ids)&&quoted.id===payable.id&&quoted.revision===payable.revision&&quoted.obligationId===payable.obligationId&&quoted.reference===payable.reference&&quoted.amountMinor===payable.amountMinor&&order.quote?.totalMinor===payable.amountMinor;
    };
    const order=await executePayable('police',payable,sameOrder);
    const settled=order?.quote?.payable, receipt=order?.receipt;
    if(!sameFineSelection(settled,ids)||settled.id!==payable.id||settled.revision!==payable.revision||settled.obligationId!==payable.obligationId||settled.amountMinor!==payable.amountMinor||
      !receipt||typeof receipt.receiptNumber!=='string'||!receipt.receiptNumber||receipt.obligationId!==settled.obligationId||receipt.amountMinor!==payable.amountMinor||receipt.currency!=='AED')
      throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The fine settlement could not be confirmed. Inspect the original payment order.');
    return {success:true,receiptNumber:receipt.receiptNumber,finesCleared:ids.length,fineIds:ids,amountPaid:receipt.amountMinor/100,remainingBalance:(await call('payments','GET','/wallet')).balance};
  };
  const rechargeTarget = async (provider:string,reference:string,amountMinor:number,expectedTargetVersion?:number) => {
    const intentId=stableKey(`recharge-intent:${provider}:${actor.requestId}`);let payable, requiredVersion=expectedTargetVersion;
    try{payable=(await call(provider,'GET',`/recharge-intents/${intentId}`)).payable;}
    catch(e){if(!(e instanceof UpstreamError)||e.status!==404)throw e;}
    if(payable){if(payable.reference!==reference||payable.amountMinor!==amountMinor||expectedTargetVersion!==undefined&&payable.recharge?.targetVersion!==expectedTargetVersion)throw new UpstreamError(409,'RECHARGE_INTENT_CONFLICT','This request already has different recharge terms.');}
    else{
      const targets=(await call(provider,'GET','/recharge-targets')).targets,target=targets.find((t:RechargeTarget)=>t.reference===reference);
      if(!target)throw new UpstreamError(404,'RECHARGE_TARGET_NOT_FOUND','This provider target is not owned by the workspace.');
      requiredVersion=expectedTargetVersion??target.version;
      payable=(await call(provider,'POST','/recharge-quotes',{targetReference:reference,amountMinor,expectedTargetVersion:expectedTargetVersion??target.version,intentId},stableKey(`recharge-quote:${intentId}`))).payable;
    }
    const recharge=payable?.recharge;
    if(!payable||payable.kind!=='RECHARGE'||payable.provider!==provider||payable.reference!==reference||payable.amountMinor!==amountMinor||payable.currency!=='AED'||
      typeof payable.id!=='string'||!payable.id||typeof payable.revision!=='string'||!payable.revision||typeof payable.obligationId!=='string'||!payable.obligationId||
      !recharge||recharge.kind!==(provider==='rta'?'TOLL':'PREPAID')||!Number.isSafeInteger(recharge.targetVersion)||recharge.targetVersion<1||requiredVersion!==undefined&&recharge.targetVersion!==requiredVersion||
      !Number.isSafeInteger(recharge.balanceBeforeMinor)||recharge.balanceBeforeMinor<0||!Number.isSafeInteger(recharge.balanceBeforeMinor+amountMinor))
      throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The recharge quote could not be confirmed.');
    const sameOrder=(value:unknown)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return false;
      const order=value as {quote?:{totalMinor?:unknown;payable?:Payable & {recharge?:{kind?:unknown;targetVersion?:unknown;balanceBeforeMinor?:unknown};currency?:unknown}}}, quoted=order.quote?.payable;
      return !!quoted&&quoted.kind==='RECHARGE'&&quoted.provider===provider&&quoted.id===payable.id&&quoted.revision===payable.revision&&quoted.obligationId===payable.obligationId&&quoted.reference===reference&&quoted.amountMinor===amountMinor&&quoted.currency==='AED'&&order.quote?.totalMinor===amountMinor&&quoted.recharge?.kind===recharge.kind&&quoted.recharge?.targetVersion===recharge.targetVersion&&quoted.recharge?.balanceBeforeMinor===recharge.balanceBeforeMinor;
    };
    const order=await executePayable(provider,payable,sameOrder), receipt=order?.receipt;
    if(!receipt||typeof order.paymentId!=='string'||!order.paymentId||receipt.receiptNumber!==order.paymentId||receipt.obligationId!==payable.obligationId||receipt.amountMinor!==amountMinor||receipt.currency!=='AED'||receipt.targetReference!==reference||receipt.providerBalanceMinor!==recharge.balanceBeforeMinor+amountMinor)
      throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The recharge settlement could not be confirmed. Inspect the original payment order.');
    return {success:true,transactionId:order.paymentId,newBalance:receipt.providerBalanceMinor/100,amountRecharged:receipt.amountMinor/100};
  };
  const recharge = async (amount: number, expectedTag?: string) => {
    const tagNumber = (await call('rta', 'GET', '/salik')).tagNumber;
    if (expectedTag !== undefined && expectedTag !== tagNumber) throw new UpstreamError(409, 'PAYABLE_CHANGED', 'The reviewed toll tag changed.');
    return { ...await rechargeTarget('rta', tagNumber, Math.round(amount * 100)), tagId: tagNumber };
  };
  try {
    if (service === 'service-profile') {
      const profile = { ...structuredClone(currentProfile), userId: actor.sub, username: actor.username, displayName: actor.name, email: '', avatarUrl: '', emiratesId: undefined, uaePassVerified: false, vipTier: 'Standard' as const, residencyStatus: 'Demo resident', smartCityAssets: { vehicles: [{ plate: asset.plate, model: 'Tesla Model Y (EV)', salikTag: asset.salikTag }], premises: [{ premiseId: asset.premiseId, ejariNumber: asset.contractNumber, community: 'Downtown Dubai', unit: actor.accountId === accounts[0].id ? 'Personal home' : 'Household home' }] } };
      let preferences = db.get(actor.accountId, 'preferences') || structuredClone(currentPreferences);
      if (path === '/profile' && method === 'GET') return successful({ profile });
      if (path === '/profile/preferences' && method === 'POST') {
        preferences = { ...preferences, ...body, mobility: { ...preferences.mobility, ...body.mobility }, ui: { ...preferences.ui, ...body.ui } };
        db.put(actor.accountId, 'preferences', preferences);
      }
      if (path === '/profile/preferences') return successful({ preferences, promptContext: generatePromptContext(profile, preferences) });
      if (path === '/profile/prompt-context') return successful({ profile, preferences, promptContext: generatePromptContext(profile, preferences) });
    }
    if (service === 'service-ride') {
      const exact: Record<string, string> = { '/mobility/parking/zones': '/parking/zones', '/mobility/parking/active': '/parking/sessions', '/mobility/salik/balance': '/salik', '/mobility/salik/passings': '/salik/passings', '/mobility/ev/chargers': '/ev/chargers', '/rides/options': '/rides/options' };
      if (method === 'GET' && exact[path]) return successfulWithoutDuplicate(await call('rta', method, exact[path]));
      if (method === 'POST' && path === '/mobility/parking/activate') {
        const { zones } = await call('rta', 'GET', '/parking/zones');
        const zone = zones.find((z: Zone) => z.id === body.zoneId);
        if (!zone || body.plateNumber !== asset.plate) throw new UpstreamError(400, 'INVALID_PARKING', 'Choose an available zone and an account-owned plate.');
        const payment = await charge('rta', `parking:${actor.requestId}`, zone.tariffPerHour * body.durationHours);
        return successfulWithoutDuplicate(await call('rta', method, '/parking/sessions', { ...body, paymentId: payment.charge.id, reference: actor.requestId }));
      }
      if (method === 'POST' && path === '/mobility/parking/extend') {
        const { meters } = await call('rta', 'GET', '/parking/sessions');
        const meter = meters.find((m: Meter) => m.ticketId === body.ticketId);
        const { zones } = await call('rta', 'GET', '/parking/zones');
        const zone = zones.find((z: Zone) => z.id === meter?.zoneId);
        if (!meter || !zone || meter.durationHours + body.additionalHours > 720) throw new UpstreamError(400, 'INVALID_PARKING', 'Review the parking duration and selected session.');
        const payment = await charge('rta', `parking-extension:${actor.requestId}`, zone.tariffPerHour * body.additionalHours);
        return successfulWithoutDuplicate(await call('rta', method, `/parking/sessions/${encodeURIComponent(body.ticketId)}/extensions`, { additionalHours: body.additionalHours, paymentId: payment.charge.id, reference: actor.requestId }));
      }
      if (method === 'POST' && path === '/mobility/salik/recharge') return successfulWithoutDuplicate(await recharge(body.amount, body.expectedTag));
      if (method === 'POST' && path === '/mobility/ev/start') return successfulWithoutDuplicate(await call('rta', method, '/ev/sessions', body));
      if (method === 'POST' && path === '/rides/book') return successfulWithoutDuplicate(await call('rta', method, '/rides/bookings', body));
      if (method === 'GET' && path.startsWith('/rides/track/')) return successfulWithoutDuplicate(await call('rta', method, `/rides/bookings/${encodeURIComponent(path.split('/').pop()!)}`));
    }
    if (service === 'service-food') {
      if (method === 'GET' && path === '/utilities/consumption') {
        const result = await call('dewa', method, '/consumption');
        if (!ownedUtility(result.account)) throw new UpstreamError(404, 'NOT_FOUND', 'Utility account not found.');
        return successfulWithoutDuplicate(result);
      }
      if (method === 'GET' && path === '/utilities/bill') {
        const bills = (await call('dewa', method, '/bills')).bills;
        if (!Array.isArray(bills)) throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The bills could not be read.');
        const bill = bills.find(ownedUtility);
        if (!bill) throw new UpstreamError(404, 'NOT_FOUND', 'Bill not found.');
        const payables = (await call('dewa', method, '/payables')).payables;
        if (!Array.isArray(payables)) throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The bill payable could not be read.');
        const payable = payables.find((p: Payable) => p?.obligationId === bill.billId && p.provider === 'dewa' && p.kind === 'BILL' && p.reference === asset.utilityAccount);
        return successful({ bill: { ...bill, payableId: payable?.id, payableRevision: payable?.revision } });
      }
      if (method === 'POST' && path === '/utilities/pay') {
        if (body.operationId !== undefined) throw new UpstreamError(400, 'VALIDATION_ERROR', 'Offline operation identities are not supported in integrated provider mode.');
        return successfulWithoutDuplicate(await settleBill('dewa', body.billId));
      }
      if (method === 'GET' && ['/restaurants/search','/utilities/eco-advice'].includes(path)) return legacy(method, path, query, body);
      if (method === 'POST' && path === '/orders/create') {
        const restaurant = restaurants.find(r => r.id === body.restaurantId);
        const items = body.items.map((id: string) => restaurant?.items.find(item => item.id === id));
        if (!restaurant || items.some((item) => !item)) throw new UpstreamError(404, 'NOT_FOUND', 'Menu item not found.');
        const order = { orderId: randomUUID(), restaurantId: restaurant.id, restaurantName: restaurant.name, items, totalAmount: items.reduce((sum: number, item) => sum + Math.round(item!.price * 100), 0) / 100, status: 'CONFIRMED', estimatedDeliveryTime: '25 min', timestamp: Date.now() };
        db.put(actor.accountId, 'order', order, order.orderId); return successful({ order });
      }
      if (method === 'GET' && path.startsWith('/orders/track/')) { const order = db.get(actor.accountId, 'order', path.split('/').pop()!); if (!order) throw new UpstreamError(404, 'NOT_FOUND', 'Order not found.'); return successful({ order }); }
    }
    if (service === 'service-wallet') {
      if (method === 'GET' && path === '/wallet/balance') return successfulWithoutDuplicate(await call('payments', method, '/wallet'));
      if (method === 'GET' && path === '/wallet/transactions') return successfulWithoutDuplicate(await call('payments', method, '/transactions'));
      if (method === 'GET' && (path === '/fines/check' || path === '/fines')) {
        if (query.plateNumber !== undefined && query.plateNumber !== asset.plate) throw new UpstreamError(404, 'NOT_FOUND', 'The selected plate is not available in this account.');
        const report = await call('police', method, '/fines');
        type PlateFine = { plateNumber: string; originalAmount: number; payableAmount: number; discountAmount: number };
        if (!Array.isArray(report.fines) || report.fines.some((fine: PlateFine) => !fine || typeof fine.plateNumber !== 'string' || !fine.plateNumber)) throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The selected plate report could not be confirmed.');
        const fines: PlateFine[] = report.fines.filter((fine: PlateFine) => fine.plateNumber === asset.plate);
        let original = 0, payable = 0, discount = 0;
        try {
          for (const fine of fines) { const a = toMinor(fine.originalAmount), b = toMinor(fine.payableAmount), c = toMinor(fine.discountAmount); if (a !== b + c) throw new Error('Inconsistent fine'); original += a; payable += b; discount += c; }
          if (![original, payable, discount].every(Number.isSafeInteger)) throw new Error('Invalid total');
        } catch { throw new UpstreamError(503, 'PROVIDER_UNAVAILABLE', 'The selected plate report could not be confirmed.'); }
        return successful({ ...report, fines, count: fines.length, totalOriginal: original / 100, totalPayable: payable / 100, totalDiscount: discount / 100, plateNumber: asset.plate, earlyDiscountAED: discount / 100, discountLabel: 'Provider-reported discount' });
      }
      if (method === 'POST' && path === '/wallet/topup') return successfulWithoutDuplicate(await call('payments', method, '/topups', { amountMinor: Math.round(body.amount * 100), source: 'demo_approved' }));
      if (method === 'POST' && path === '/wallet/pay') return successfulWithoutDuplicate(await charge('superapp', body.referenceId || actor.requestId, body.amount));
      if (method === 'POST' && path === '/fines/pay') return successfulWithoutDuplicate(await settleFines(body.fineIds));
      if (method === 'POST' && ['/pay/unified','/pay/multi-agency'].includes(path)) {
        if (body.operationId !== undefined) throw new UpstreamError(400, 'VALIDATION_ERROR', 'Offline operation identities are not supported in integrated provider mode.');
        if((body.targetReference===undefined)!==(body.expectedTargetVersion===undefined))throw new UpstreamError(400,'VALIDATION_ERROR','Select a recharge target and its reviewed version together.');
        const selected=body.expectedPayables as ReviewedGroupPayable[] | undefined;
        if(!Array.isArray(selected)||selected.length>30)throw new UpstreamError(400,'VALIDATION_ERROR','Select the reviewed bills and fines.');
        const selectedKeys=new Set<string>();
        for(const item of selected){if(!item||!['dewa','police'].includes(item.provider)||typeof item.payableId!=='string'||!item.payableId||typeof item.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(item.expectedRevision))throw new UpstreamError(400,'VALIDATION_ERROR','Select the reviewed bills and fines.');const key=JSON.stringify([item.provider,item.payableId]);if(selectedKeys.has(key))throw new UpstreamError(400,'VALIDATION_ERROR','A reviewed item cannot be selected twice.');selectedKeys.add(key);}
        const reviewItems=body.items as unknown;
        if(!Array.isArray(reviewItems)||!reviewItems.length)throw new UpstreamError(400,'VALIDATION_ERROR','Review the checkout amounts.');
        let reviewedTotal=0;
        try{for(const item of reviewItems){if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid item');reviewedTotal+=toMinor((item as {amount:number}).amount);}if(!Number.isSafeInteger(reviewedTotal)||reviewedTotal<=0)throw new Error('Invalid total');}
        catch{throw new UpstreamError(400,'VALIDATION_ERROR','Review the checkout amounts.');}
        // Persist the reviewed plan before dispatch. A lost response resumes these child IDs, never a new recharge.
        const intentId=stableKey(`unified:${actor.requestId}`),terms=JSON.stringify(body);
        let intent=db.get(actor.accountId,'checkout-intent',intentId);
        if(intent&&intent.terms!==terms)throw new UpstreamError(409,'CHECKOUT_INTENT_CONFLICT','This request already has different checkout terms.');
        if(!intent){
          const items:PlannedItem[]=[];
          const bills=(await call('dewa','GET','/payables')).payables, availableFines=(await call('police','GET','/payables')).payables;
          if(!Array.isArray(bills)||!Array.isArray(availableFines))throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The reviewed payables could not be read.');
          const fines:Payable[]=[];
          for(const item of selected){const candidates=(item.provider==='dewa'?bills:availableFines).filter((p:Payable)=>p.id===item.payableId&&p.provider===item.provider);const p=candidates[0];if(candidates.length!==1||!p||p.kind!==(item.provider==='dewa'?'BILL':'FINE')||p.status!=='UNPAID'||p.revision!==item.expectedRevision||item.provider==='police'&&p.reference!==asset.plate||item.provider==='dewa'&&p.reference!==asset.utilityAccount)throw new UpstreamError(409,'PAYABLE_CHANGED','A selected payable changed. Review current terms again.');if(item.provider==='dewa')items.push({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision});else fines.push(p);}
          if(fines.length){const p=(await call('police','POST','/fine-selections',{items:fines.map((p:Payable)=>({payableId:p.id,expectedRevision:p.revision}))},stableKey(`unified-fines:${intentId}`))).payable;const ids=fines.map(f=>f.obligationId);if(!ids.every(id=>typeof id==='string'&&!!id)||!sameFineSelection(p,ids)||p.reference!==asset.plate||!Number.isSafeInteger(p.amountMinor)||p.amountMinor!==fines.reduce((sum,f)=>sum+f.amountMinor,0))throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The selected fines could not be confirmed.');items.push({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision});}
          let rechargeQuote;
          try{rechargeQuote=(await call('rta','GET',`/recharge-intents/${intentId}`)).payable;}catch(e){if(!(e instanceof UpstreamError)||e.status!==404)throw e;}
          if(!rechargeQuote){
            const targets=(await call('rta','GET','/recharge-targets')).targets;
            if(!Array.isArray(targets))throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The recharge targets could not be read.');
            if(body.targetReference===undefined&&targets.length!==1)throw new UpstreamError(409,'RECHARGE_TARGET_REQUIRED','Choose a specific recharge target before checkout.');
            const matches=body.targetReference===undefined?targets:targets.filter((t:RechargeTarget)=>t.reference===body.targetReference);
            if(matches.length>1)throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The selected recharge target could not be confirmed.');
            const target=matches[0];
            if(!target)throw new UpstreamError(404,'RECHARGE_TARGET_NOT_FOUND','The selected recharge target is not owned by the workspace.');
            if(typeof target.reference!=='string'||!target.reference||!Number.isSafeInteger(target.version)||target.version<1)throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The recharge target could not be confirmed.');
            if(body.expectedTargetVersion!==undefined&&body.expectedTargetVersion!==target.version)throw new UpstreamError(409,'PAYABLE_CHANGED','The selected recharge target changed. Review it again.');
            rechargeQuote=(await call('rta','POST','/recharge-quotes',{targetReference:target.reference,amountMinor:10000,expectedTargetVersion:target.version,intentId},stableKey(`unified-recharge:${intentId}`))).payable;
            if(rechargeQuote?.reference!==target.reference||rechargeQuote?.recharge?.targetVersion!==target.version)throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The recharge quote could not be confirmed.');
          }else if(body.targetReference!==undefined&&(rechargeQuote.reference!==body.targetReference||rechargeQuote.recharge?.targetVersion!==body.expectedTargetVersion))throw new UpstreamError(409,'RECHARGE_INTENT_CONFLICT','This checkout already has different recharge terms.');
          if(rechargeQuote?.provider!=='rta'||rechargeQuote.kind!=='RECHARGE'||rechargeQuote.currency!=='AED'||rechargeQuote.amountMinor!==10000||typeof rechargeQuote.id!=='string'||!rechargeQuote.id||typeof rechargeQuote.revision!=='string'||!rechargeQuote.revision||typeof rechargeQuote.reference!=='string'||!rechargeQuote.reference||rechargeQuote.recharge?.kind!=='TOLL'||!Number.isSafeInteger(rechargeQuote.recharge?.targetVersion)||rechargeQuote.recharge.targetVersion<1)throw new UpstreamError(503,'PROVIDER_UNAVAILABLE','The recharge quote could not be confirmed.');
          items.push({provider:'rta',payableId:rechargeQuote.id,expectedPayableRevision:rechargeQuote.revision});
          const current:Payable[]=[];let currentTotal=0;
          for(const item of items){const p=(await call(item.provider,'GET',`/payables/${encodeURIComponent(item.payableId)}`)).payable;if(!p||p.provider!==item.provider||p.id!==item.payableId||p.revision!==item.expectedPayableRevision||item.provider==='dewa'&&p.reference!==asset.utilityAccount||item.provider==='police'&&p.reference!==asset.plate||p.status!=='UNPAID'||p.currency!=='AED'||!Number.isSafeInteger(p.amountMinor)||p.amountMinor<0)throw new UpstreamError(409,'PAYABLE_CHANGED','The checkout items changed. Review current terms again.');current.push(p);currentTotal+=p.amountMinor;}
          if(!Number.isSafeInteger(currentTotal)||currentTotal!==reviewedTotal)throw new UpstreamError(409,'PAYABLE_CHANGED','The checkout total changed. Review current terms again.');
          const links=(await call('payments','GET','/billing-accounts')).billingAccounts;
          for(const p of current){if(!links.some((b:BillingAccount)=>b.status==='ACTIVE'&&b.provider===p.provider&&b.reference===p.reference)){try{await call('payments','POST','/billing-accounts',{provider:p.provider,reference:p.reference,nickname:`${p.provider.toUpperCase()} account`},stableKey(`unified-link:${p.provider}:${p.reference}`));}catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}}}
          const planned={terms,input:{items,methodId:body.methodId||'wallet',expectedMethodVersion:body.expectedMethodVersion||1}};
          db.transaction(()=>{intent=db.get(actor.accountId,'checkout-intent',intentId);if(!intent){db.put(actor.accountId,'checkout-intent',planned,intentId);intent=planned;}});
          if(intent.terms!==terms)throw new UpstreamError(409,'CHECKOUT_INTENT_CONFLICT','This request already has different checkout terms.');
        }
        let group: CheckoutGroupView;
        if(!intent.groupId){
          group=(await call('payments','POST','/checkout-groups',intent.input,stableKey(`unified-group:${intentId}`))).group;
          if(typeof group?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(group.id))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original checkout could not be confirmed.');
          db.transaction(()=>{const saved=db.get(actor.accountId,'checkout-intent',intentId);if(saved.groupId&&saved.groupId!==group.id)throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original checkout could not be confirmed.');intent={...saved,groupId:group.id};db.put(actor.accountId,'checkout-intent',intent,intentId);});
        }
        const groupId=intent.groupId;
        if(typeof groupId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(groupId))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original checkout could not be confirmed.');
        group=(await call('payments','GET',`/checkout-groups/${groupId}`)).group;
        const verifyGroup=()=>{
          const invalid=()=>{throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','The original checkout could not be confirmed. Inspect its original child payments.');};
          if(!group||group.id!==groupId||group.accountId!==actor.accountId||group.ownerSub!==actor.sub||group.currency!=='AED'||typeof group.approvalDigest!=='string'||!/^[a-f0-9]{64}$/.test(group.approvalDigest)||
            group.source?.id!==intent.input.methodId||group.source?.accountId!==actor.accountId||group.source?.version!==intent.input.expectedMethodVersion||group.source?.currency!=='AED'||group.source?.status!=='ACTIVE'||group.source?.kind!==(intent.input.methodId==='wallet'?'wallet':'card')||
            !Array.isArray(group.orders)||!Array.isArray(group.orderIds)||!Array.isArray(group.excluded)||!Array.isArray(intent.input.items)||intent.input.items.length<1||intent.input.items.length>10||group.orders.length<1||group.orders.length>10||group.orders.length!==group.orderIds.length||new Set(group.orderIds).size!==group.orderIds.length)invalid();
          const represented=new Set<string>(), childIds=new Set<string>();let total=0;
          for(const child of group.orders){
            const quote=child?.quote,p=quote?.payable,key=JSON.stringify([p?.provider,p?.id]);
            const planned=intent.input.items.find((item:PlannedItem)=>item.provider===p?.provider&&item.payableId===p?.id&&item.expectedPayableRevision===p?.revision);
            if(!planned||represented.has(key)||typeof child.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(child.id)||childIds.has(child.id)||!group.orderIds.includes(child.id)||child.accountId!==actor.accountId||child.ownerSub!==actor.sub||typeof child.approvalDigest!=='string'||!/^[a-f0-9]{64}$/.test(child.approvalDigest)||canonicalJson(quote.source)!==canonicalJson(group.source)||quote.currency!=='AED'||!Number.isSafeInteger(quote.totalMinor)||quote.totalMinor<0||group.state==='COMPLETED'&&(child.state!=='SETTLED'||child.sourceFinalizationPending))invalid();
            if(child.state==='SETTLED'&&(!child.receipt||typeof child.paymentId!=='string'||!child.paymentId||child.receipt.receiptNumber!==child.paymentId||typeof p.obligationId!=='string'||!p.obligationId||child.receipt.obligationId!==p.obligationId||child.receipt.amountMinor!==quote.totalMinor||child.receipt.currency!=='AED'||p.kind==='RECHARGE'&&(child.receipt.targetReference!==p.reference||!p.recharge||child.receipt.providerBalanceMinor!==p.recharge.balanceBeforeMinor+quote.totalMinor)))invalid();
            represented.add(key);childIds.add(child.id);total+=quote.totalMinor;
          }
          for(const excluded of group.excluded){const key=JSON.stringify([excluded?.provider,excluded?.payableId]);if(excluded?.reason!=='ALREADY_PAID'||represented.has(key)||!intent.input.items.some((item:PlannedItem)=>item.provider===excluded.provider&&item.payableId===excluded.payableId))invalid();represented.add(key);}
          if(represented.size!==intent.input.items.length||!Number.isSafeInteger(total)||total!==group.totalMinor||total!==reviewedTotal)invalid();
          const projection={id:group.id,accountId:group.accountId,ownerSub:group.ownerSub,source:group.source,currency:group.currency,totalMinor:group.totalMinor,approvalDigest:group.approvalDigest,orderIds:group.orderIds,excluded:group.excluded,orders:group.orders.map((child:{id:string;approvalDigest:string;quote:unknown})=>({id:child.id,approvalDigest:child.approvalDigest,quote:child.quote}))};
          const binding=createHash('sha256').update(canonicalJson(projection)).digest('hex');
          db.transaction(()=>{const saved=db.get<{binding:string}>(actor.accountId,'checkout-group-binding',groupId);if(saved&&saved.binding!==binding)invalid();if(!saved)db.put(actor.accountId,'checkout-group-binding',{binding},groupId);});
        };
        verifyGroup();
        if(group.state==='AWAITING_APPROVAL')group=(await call('payments','POST',`/checkout-groups/${groupId}/approve`,{expectedVersion:group.version,approvalDigest:group.approvalDigest},stableKey(`unified-approve:${groupId}`))).group;
        verifyGroup();
        if(group.state!=='COMPLETED')group=(await call('payments','POST',`/checkout-groups/${groupId}/execute`,{expectedVersion:group.version,approvalDigest:group.approvalDigest},`unified-run:${randomUUID()}`)).group;
        verifyGroup();
        const steps=group.orders.filter(o=>o.state==='SETTLED').map(o=>({service:o.quote.payable.provider,orderId:o.id,receipt:o.receipt}));
        if(group.state!=='COMPLETED')return {status:group.state==='RECONCILIATION_REQUIRED'?502:409,data:{success:false,code:`CHECKOUT_${group.state}`,error:'Checkout stopped. Inspect its original child payments and continue this group after resolving the affected line.',group,steps}};
        const paid=(provider:string)=>group.orders.filter(o=>o.quote.payable.provider===provider).reduce((sum,o)=>sum+o.quote.totalMinor,0)/100;
        return successful({group,govTransactionHash:group.id,settlementPlatform:'Demo payment gateway',grandTotal:group.totalMinor/100,breakdown:{utilities:paid('dewa'),fines:paid('police'),salik:paid('rta')},remainingBalance:(await call('payments','GET','/wallet')).balance,steps});
      }
    }
    if (service === 'service-catalog') {
      if (method === 'GET' && path === '/housing/ejari') return successfulWithoutDuplicate(await call('dld', method, '/tenancy'));
      if (method === 'POST' && path === '/housing/move-in') {
        const proposal = await call('dld', 'POST', '/move-ins', body);
        const { connection } = await call('dewa', 'POST', '/connections', body);
        const { permit } = await call('rta', 'POST', '/residential-permits', body);
        return successful({ ...proposal, dewaConnected: connection, residentialParking: permit });
      }
      if (method === 'GET') return legacy(method, path, query, body);
    }
    if (service === 'service-telecom') {
      const prepaid=/^\/telecom\/(etisalat|du)\/prepaid(\/recharges)?$/.exec(path);
      if(prepaid){const invalid=validateRequest('service-telecom',method,path,query,body);if(invalid)return invalid;if(method==='GET'&&!prepaid[2])return successful(await call(prepaid[1],'GET','/prepaid'));if(method==='POST'&&prepaid[2])return successfulWithoutDuplicate(await rechargeTarget(prepaid[1],body.lineId,body.amountMinor,body.expectedTargetVersion));}

      const match = /^\/telecom\/(etisalat|du)\/(subscriptions|plans|bills)(\/[^/]+\/(?:payments|plan))?$/.exec(path);
      if (match) {
        const invalid = validateRequest('service-telecom', method, path, query, body);
        if (invalid) return invalid;
        const provider = match[1], route = `/${match[2]}${match[3] || ''}`;
        if (method === 'POST' && match[3]?.endsWith('/payments')) return successfulWithoutDuplicate(await settleBill(provider, match[3].split('/')[1]));
        if(method==='GET'&&route==='/bills'){const result=await call(provider,'GET','/bills'),payables=(await call(provider,'GET','/payables')).payables;return successful({bills:result.bills.map((bill:Bill)=>({...bill,payableRevision:payables.find((p:Payable)=>p.obligationId===bill.billId)?.revision}))});}
        return successfulWithoutDuplicate(await call(provider, method, route, method === 'POST' ? body : undefined));
      }
    }
    return { status: 404, data: { success: false, code: 'NOT_FOUND', error: 'Operation not found.' } };
  } catch (error) {
    const known = error instanceof UpstreamError;
    return { status: known ? error.status : 503, data: { success: false, code: known ? error.code : 'PROVIDER_UNAVAILABLE', error: known ? error.message : 'Provider integration unavailable.' } };
  }
}
const successfulWithoutDuplicate = (data: unknown): Result => ({ status: 200, data });
export function createApplicationServer(service: string, legacy: Legacy) {
  const policy = new HttpPolicy();
  const telemetry=new Telemetry(service);
  const server=http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, telemetry.handler(async (req, res) => {
    const suppliedRequestId = req.headers['x-request-id'];
    const requestId = correlation()?.requestId || (typeof suppliedRequestId === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID());
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-Id': requestId }); res.end(JSON.stringify(data)); };
    try {
      const release = policy.admit(req.socket.remoteAddress || 'unknown'); res.once('finish', release); res.once('close', release);
      const url = new URL(req.url || '/', 'http://application');
      const query = Object.fromEntries(url.searchParams);
      const integrated = process.env.PROVIDER_INTEGRATION === 'true';
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', service, integration: integrated ? 'rest-providers' : 'legacy-fixtures' });
      let actor: Actor | undefined;
      if (integrated) {
        const user = await verifyJwt(req.headers.authorization, process.env.KEYCLOAK_AUDIENCE || 'agent-core').catch(() => undefined);
        if (!user || !user.realm_access?.roles?.includes('superapp-user') || String(user.preferred_username || '').startsWith('service-account-')) return send(401, { success: false, code: 'UNAUTHENTICATED', error: 'A signed-in user token is required.' });
        const account = req.headers['x-account-id'];
        actor = actorFor({ sub: user.sub, preferred_username: user.preferred_username, name: user.name }, typeof account === 'string' ? account : undefined, req.headers.authorization);
        actor.requestId = requestId;
      }
      const parsed = await readJsonBody(req);
      // A request body is always a JSON object in every mode; arrays and scalars are rejected before routing.
      if (!isPlainJsonObject(parsed)) return send(400, { success: false, code: 'VALIDATION_ERROR', error: 'Invalid request input' });
      const body = parsed as RequestBody;
      if (integrated) {
        const invalid = validateRequest(service, req.method || 'GET', url.pathname, query, body);
        if (invalid) return send(invalid.status, invalid.data);
      }
      const result = integrated ? await actorContext.run(actor!,()=>integratedRequest(service, actor!, req.method || 'GET', url.pathname, query, body, legacy)) : legacy(req.method || 'GET', url.pathname, query, body);
      send(result.status, result.data);
    } catch (error) { res.setHeader('Connection', 'close'); send(error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 503, { success: false, code: 'REQUEST_FAILED', error: error instanceof HttpError ? error.message : error instanceof SyntaxError ? 'Invalid JSON body' : 'Request could not be completed.' }); }
  },{ready:()=>{if(typeof legacy!=='function')throw Error('Handler unavailable');if(process.env.PROVIDER_INTEGRATION==='true')storeFor(service).db.prepare('SELECT 1').get();}}));
  server.once('close',()=>{telemetry.close();stores.get(service)?.close();stores.delete(service);});return server;
}
