import { HttpPolicy, HttpError, readJsonBody } from './http-policy.ts';
import http from 'node:http';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AccountDatabase } from '../../../services/provider-simulator/src/database.ts';
import { ProviderClient, UpstreamError } from './provider-client.ts';
import { actorFor, assetsFor, type Actor } from './context.ts';
import { verifyJwt } from './jwt.ts';
import { validateRequest } from '../../protocol-core/src/request-validation.ts';
import { currentProfile, currentPreferences, generatePromptContext } from '../../../services/service-profile/src/index.ts';
import { restaurants } from '../../../services/service-food/src/index.ts';
type Result = { status: number; data: any };
type Legacy = (method: string, path: string, query?: Record<string, string>, body?: any) => Result;
const clients = new Map<string, ProviderClient>();
const stores = new Map<string, AccountDatabase>();
const successful = (data: any): Result => ({ status: 200, data: { success: true, ...data } });
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
export async function integratedRequest(service: string, actor: Actor, method: string, path: string, query: Record<string, string>, body: any, legacy: Legacy): Promise<Result> {
  const db = storeFor(service), accounts = db.accounts(actor.sub);
  if (path === '/accounts' && method === 'GET') return successful({ accounts });
  if (!db.owns(actor.sub, actor.accountId)) return { status: 403, data: { success: false, code: 'ACCOUNT_FORBIDDEN', error: 'This account does not belong to the signed-in user.' } };
  const client = clientFor(service), asset = assetsFor(actor.accountId);
  const call = (provider: string, verb: string, route: string, data?: any, key?: string) => client.call(provider, actor, verb, route, data, key);
  const stableKey = (value: string) => createHash('sha256').update(`${actor.accountId}:${value}`).digest('hex');
  const charge = async (provider: string, reference: string, amount: number) => call('payments', 'POST', '/charges', { amountMinor: Math.round(amount * 100), merchant: provider, reference, source: 'wallet' }, stableKey(`charge:${provider}:${reference}`));
  const executePayable = async (provider:string,payable:any) => {
    const prefix=payable.kind==='RECHARGE'?'recharge':provider==='police'?'fine':'bill';
    const links=(await call('payments','GET','/billing-accounts')).billingAccounts;
    if(!links.some((b:any)=>b.status==='ACTIVE'&&b.provider===provider&&b.reference===payable.reference)) {
      try{await call('payments','POST','/billing-accounts',{provider,reference:payable.reference,nickname:`${provider.toUpperCase()} account`},stableKey(`${prefix}-link:${provider}:${payable.reference}`));}
      catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}
    }
    const created=await call('payments','POST','/payment-orders',{provider,payableId:payable.id,expectedPayableRevision:payable.revision,methodId:'wallet',expectedMethodVersion:1},stableKey(`${prefix}-order:${provider}:${payable.obligationId}:${payable.revision}:${actor.requestId}`));
    let order=(await call('payments','GET',`/payment-orders/${created.order.id}`)).order;
    if(order.state==='AWAITING_APPROVAL')order=(await call('payments','POST',`/payment-orders/${order.id}/approve`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`${prefix}-authorize:${order.id}`))).order;
    if(order.state==='AUTHORIZED')order=(await call('payments','POST',`/payment-orders/${order.id}/execute`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`${prefix}-execute:${order.id}`))).order;
    else if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state))order=(await call('payments','POST',`/payment-orders/${order.id}/recover`,{},stableKey(`${prefix}-recover:${order.id}:${actor.requestId}`))).order;
    if(order.state!=='SETTLED')throw new UpstreamError(order.fundsCaptured?502:409,order.failureCode||'PAYMENT_REQUIRES_REVIEW',order.fundsCaptured?'Payment was captured but settlement needs reconciliation. Inspect the original payment order.':'Payment stopped without capture. Review the original order.');
    return order;
  };
  const settleBill = async (provider: string, billId?: string) => {
    const { bills } = await call(provider, 'GET', '/bills');
    const bill = billId ? bills.find((b: any) => b.billId === billId) : bills[0];
    if (!bill) throw new UpstreamError(404, 'NOT_FOUND', 'Bill not found.');
    if (bill.status === 'PAID') return { success: true, bill, chargedAmount: 0, receipt: { billId: bill.billId, ...(bill.premiseId ? { premiseId: bill.premiseId } : {}), receiptNumber: bill.receiptNumber, amountPaid: bill.totalAmount.toFixed(2), currency: 'AED' } };
    if (bill.status !== 'UNPAID' || bill.expiresAt && Date.parse(bill.expiresAt) <= Date.now()) throw new UpstreamError(409, 'PAYABLE_UNAVAILABLE', 'This bill is no longer payable.');
    const payable=(await call(provider,'GET','/payables')).payables.find((p:any)=>p.obligationId===bill.billId);
    if(!payable||payable.status!=='UNPAID'||payable.amountMinor!==Math.round(bill.totalAmount*100)||body.expectedPayableRevision&&body.expectedPayableRevision!==payable.revision||body.expectedAmountMinor!==undefined&&body.expectedAmountMinor!==payable.amountMinor)throw new UpstreamError(409,'PAYABLE_CHANGED','The reviewed bill changed. Review its current terms again.');
    const order=await executePayable(provider,payable);
    const paid=(await call(provider,'GET','/bills')).bills.find((b:any)=>b.billId===bill.billId),wallet=await call('payments','GET','/wallet');
    return {success:true,bill:paid,receipt:{billId:bill.billId,receiptNumber:order.receipt.receiptNumber,amountPaid:(order.receipt.amountMinor/100).toFixed(2),currency:'AED',...(bill.premiseId?{premiseId:bill.premiseId}:{})},chargedAmount:order.quote.totalMinor/100,remainingBalance:wallet.balance};
  };
  const settleFines = async (fineIds?: string[]) => {
    const report = await call('police', 'GET', '/fines');
    const fines = fineIds ? report.fines.filter((f: any) => fineIds.includes(f.fineId)) : report.fines;
    if (fineIds && fineIds.length !== fines.length) throw new UpstreamError(404, 'NOT_FOUND', 'Unpaid fines not found.');
    if (!fines.length) return { success: true, amountPaid: 0, finesCleared: 0, receiptNumber: 'NO_FINES', remainingBalance: (await call('payments', 'GET', '/wallet')).balance };
    const ids=fines.map((f:any)=>f.fineId).sort();
    const currentItems=fines.map((f:any)=>({payableId:f.payableId,expectedRevision:f.payableRevision}));
    if(body.expectedPayables&&(body.expectedPayables.length!==currentItems.length||currentItems.some((i:any)=>!body.expectedPayables.some((p:any)=>p.payableId===i.payableId&&p.expectedRevision===i.expectedRevision))))throw new UpstreamError(409,'PAYABLE_CHANGED','The selected fine revisions changed. Review them again.');
    const payable=(await call('police','POST','/fine-selections',{items:body.expectedPayables||currentItems},stableKey(`fine-selection:${ids.join(',')}:${JSON.stringify(currentItems)}`))).payable;
    if(body.expectedAmountMinor!==undefined&&body.expectedAmountMinor!==payable.amountMinor)throw new UpstreamError(409,'PAYABLE_CHANGED','The reviewed fine amount changed.');
    const order=await executePayable('police',payable);
    return {success:true,receiptNumber:order.receipt.receiptNumber,finesCleared:ids.length,amountPaid:order.receipt.amountMinor/100,remainingBalance:(await call('payments','GET','/wallet')).balance};
  };
  const rechargeTarget = async (provider:string,reference:string,amountMinor:number,expectedTargetVersion?:number) => {
    const intentId=stableKey(`recharge-intent:${provider}:${actor.requestId}`);let payable;
    try{payable=(await call(provider,'GET',`/recharge-intents/${intentId}`)).payable;}
    catch(e){if(!(e instanceof UpstreamError)||e.status!==404)throw e;}
    if(payable){if(payable.reference!==reference||payable.amountMinor!==amountMinor||expectedTargetVersion!==undefined&&payable.recharge.targetVersion!==expectedTargetVersion)throw new UpstreamError(409,'RECHARGE_INTENT_CONFLICT','This request already has different recharge terms.');}
    else{
      const targets=(await call(provider,'GET','/recharge-targets')).targets,target=targets.find((t:any)=>t.reference===reference);
      if(!target)throw new UpstreamError(404,'RECHARGE_TARGET_NOT_FOUND','This provider target is not owned by the workspace.');
      payable=(await call(provider,'POST','/recharge-quotes',{targetReference:reference,amountMinor,expectedTargetVersion:expectedTargetVersion??target.version,intentId},stableKey(`recharge-quote:${intentId}`))).payable;
    }
    const order=await executePayable(provider,payable);return {success:true,transactionId:order.paymentId,newBalance:order.receipt.providerBalanceMinor/100,amountRecharged:order.receipt.amountMinor/100};
  };
  const recharge = async (amount: number) => rechargeTarget('rta',(await call('rta','GET','/salik')).tagNumber,Math.round(amount*100));
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
        const zone = zones.find((z: any) => z.id === body.zoneId);
        if (!zone || body.plateNumber !== asset.plate) throw new UpstreamError(400, 'INVALID_PARKING', 'Choose an available zone and an account-owned plate.');
        const payment = await charge('rta', `parking:${actor.requestId}`, zone.tariffPerHour * body.durationHours);
        return successfulWithoutDuplicate(await call('rta', method, '/parking/sessions', { ...body, paymentId: payment.charge.id, reference: actor.requestId }));
      }
      if (method === 'POST' && path === '/mobility/parking/extend') {
        const { meters } = await call('rta', 'GET', '/parking/sessions');
        const meter = meters.find((m: any) => m.ticketId === body.ticketId);
        const { zones } = await call('rta', 'GET', '/parking/zones');
        const zone = zones.find((z: any) => z.id === meter?.zoneId);
        if (!meter || !zone || meter.durationHours + body.additionalHours > 720) throw new UpstreamError(400, 'INVALID_PARKING', 'Review the parking duration and selected session.');
        const payment = await charge('rta', `parking-extension:${actor.requestId}`, zone.tariffPerHour * body.additionalHours);
        return successfulWithoutDuplicate(await call('rta', method, `/parking/sessions/${encodeURIComponent(body.ticketId)}/extensions`, { additionalHours: body.additionalHours, paymentId: payment.charge.id, reference: actor.requestId }));
      }
      if (method === 'POST' && path === '/mobility/salik/recharge') return successfulWithoutDuplicate(await recharge(body.amount));
      if (method === 'POST' && path === '/mobility/ev/start') return successfulWithoutDuplicate(await call('rta', method, '/ev/sessions', body));
      if (method === 'POST' && path === '/rides/book') return successfulWithoutDuplicate(await call('rta', method, '/rides/bookings', body));
      if (method === 'GET' && path.startsWith('/rides/track/')) return successfulWithoutDuplicate(await call('rta', method, `/rides/bookings/${encodeURIComponent(path.split('/').pop()!)}`));
    }
    if (service === 'service-food') {
      if (method === 'GET' && path === '/utilities/consumption') return successfulWithoutDuplicate(await call('dewa', method, '/consumption'));
      if (method === 'GET' && path === '/utilities/bill') {const bill=(await call('dewa',method,'/bills')).bills[0],payable=(await call('dewa',method,'/payables')).payables.find((p:any)=>p.obligationId===bill.billId);return successful({bill:{...bill,payableRevision:payable?.revision}});}
      if (method === 'POST' && path === '/utilities/pay') return successfulWithoutDuplicate(await settleBill('dewa', body.billId));
      if (method === 'GET' && ['/restaurants/search','/utilities/eco-advice'].includes(path)) return legacy(method, path, query, body);
      if (method === 'POST' && path === '/orders/create') {
        const restaurant = restaurants.find(r => r.id === body.restaurantId);
        const items = body.items.map((id: string) => restaurant?.items.find(item => item.id === id));
        if (!restaurant || items.some((item: any) => !item)) throw new UpstreamError(404, 'NOT_FOUND', 'Menu item not found.');
        const order = { orderId: randomUUID(), restaurantId: restaurant.id, restaurantName: restaurant.name, items, totalAmount: items.reduce((sum: number, item: any) => sum + Math.round(item.price * 100), 0) / 100, status: 'CONFIRMED', estimatedDeliveryTime: '25 min', timestamp: Date.now() };
        db.put(actor.accountId, 'order', order, order.orderId); return successful({ order });
      }
      if (method === 'GET' && path.startsWith('/orders/track/')) { const order = db.get(actor.accountId, 'order', path.split('/').pop()!); if (!order) throw new UpstreamError(404, 'NOT_FOUND', 'Order not found.'); return successful({ order }); }
    }
    if (service === 'service-wallet') {
      if (method === 'GET' && path === '/wallet/balance') return successfulWithoutDuplicate(await call('payments', method, '/wallet'));
      if (method === 'GET' && path === '/wallet/transactions') return successfulWithoutDuplicate(await call('payments', method, '/transactions'));
      if (method === 'GET' && path === '/fines/check') { const report = await call('police', method, '/fines'); return successful({ ...report, plateNumber: asset.plate, earlyDiscountAED: report.totalDiscount, discountLabel: 'Provider-reported discount' }); }
      if (method === 'POST' && path === '/wallet/topup') return successfulWithoutDuplicate(await call('payments', method, '/topups', { amountMinor: Math.round(body.amount * 100), source: 'demo_approved' }));
      if (method === 'POST' && path === '/wallet/pay') return successfulWithoutDuplicate(await charge('superapp', body.referenceId || actor.requestId, body.amount));
      if (method === 'POST' && path === '/fines/pay') return successfulWithoutDuplicate(await settleFines(body.fineIds));
      if (method === 'POST' && ['/pay/unified','/pay/multi-agency'].includes(path)) {
        // Persist the reviewed plan before dispatch. A lost response resumes these child IDs, never a new recharge.
        const intentId=stableKey(`unified:${actor.requestId}`),terms=JSON.stringify(body);
        let intent=db.get(actor.accountId,'checkout-intent',intentId);
        if(intent&&intent.terms!==terms)throw new UpstreamError(409,'CHECKOUT_INTENT_CONFLICT','This request already has different checkout terms.');
        if(!intent){
          const items:any[]=[];
          for(const p of (await call('dewa','GET','/payables')).payables)if(p.kind==='BILL'&&p.status==='UNPAID')items.push({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision});
          const fines=(await call('police','GET','/payables')).payables.filter((p:any)=>p.kind==='FINE'&&p.status==='UNPAID');
          if(fines.length){const p=(await call('police','POST','/fine-selections',{items:fines.map((p:any)=>({payableId:p.id,expectedRevision:p.revision}))},stableKey(`unified-fines:${intentId}`))).payable;items.push({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision});}
          let rechargeQuote;
          try{rechargeQuote=(await call('rta','GET',`/recharge-intents/${intentId}`)).payable;}catch(e){if(!(e instanceof UpstreamError)||e.status!==404)throw e;}
          if(!rechargeQuote){const target=(await call('rta','GET','/recharge-targets')).targets[0];rechargeQuote=(await call('rta','POST','/recharge-quotes',{targetReference:target.reference,amountMinor:10000,expectedTargetVersion:target.version,intentId},stableKey(`unified-recharge:${intentId}`))).payable;}
          items.push({provider:'rta',payableId:rechargeQuote.id,expectedPayableRevision:rechargeQuote.revision});
          const links=(await call('payments','GET','/billing-accounts')).billingAccounts;
          for(const item of items){const p=(await call(item.provider,'GET',`/payables/${encodeURIComponent(item.payableId)}`)).payable;if(!links.some((b:any)=>b.status==='ACTIVE'&&b.provider===p.provider&&b.reference===p.reference)){try{await call('payments','POST','/billing-accounts',{provider:p.provider,reference:p.reference,nickname:`${p.provider.toUpperCase()} account`},stableKey(`unified-link:${p.provider}:${p.reference}`));}catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}}}
          const planned={terms,input:{items,methodId:body.methodId||'wallet',expectedMethodVersion:body.expectedMethodVersion||1}};
          db.transaction(()=>{intent=db.get(actor.accountId,'checkout-intent',intentId);if(!intent){db.put(actor.accountId,'checkout-intent',planned,intentId);intent=planned;}});
          if(intent.terms!==terms)throw new UpstreamError(409,'CHECKOUT_INTENT_CONFLICT','This request already has different checkout terms.');
        }
        let group;
        if(intent.groupId)group=(await call('payments','GET',`/checkout-groups/${intent.groupId}`)).group;
        else{group=(await call('payments','POST','/checkout-groups',intent.input,stableKey(`unified-group:${intentId}`))).group;db.put(actor.accountId,'checkout-intent',{...intent,groupId:group.id},intentId);}
        group=(await call('payments','GET',`/checkout-groups/${group.id}`)).group;
        if(group.state==='AWAITING_APPROVAL')group=(await call('payments','POST',`/checkout-groups/${group.id}/approve`,{expectedVersion:group.version,approvalDigest:group.approvalDigest},stableKey(`unified-approve:${group.id}`))).group;
        if(group.state!=='COMPLETED')group=(await call('payments','POST',`/checkout-groups/${group.id}/execute`,{expectedVersion:group.version,approvalDigest:group.approvalDigest},`unified-run:${randomUUID()}`)).group;
        const steps=group.orders.filter((o:any)=>o.state==='SETTLED').map((o:any)=>({service:o.quote.payable.provider,orderId:o.id,receipt:o.receipt}));
        if(group.state!=='COMPLETED')return {status:group.state==='RECONCILIATION_REQUIRED'?502:409,data:{success:false,code:`CHECKOUT_${group.state}`,error:'Checkout stopped. Inspect its original child payments and continue this group after resolving the affected line.',group,steps}};
        const paid=(provider:string)=>group.orders.filter((o:any)=>o.quote.payable.provider===provider).reduce((sum:number,o:any)=>sum+o.quote.totalMinor,0)/100;
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
        const provider = match[1], route = `/${match[2]}${match[3] || ''}`;
        if (method === 'POST' && match[3]?.endsWith('/payments')) return successfulWithoutDuplicate(await settleBill(provider, match[3].split('/')[1]));
        if(method==='GET'&&route==='/bills'){const result=await call(provider,'GET','/bills'),payables=(await call(provider,'GET','/payables')).payables;return successful({bills:result.bills.map((bill:any)=>({...bill,payableRevision:payables.find((p:any)=>p.obligationId===bill.billId)?.revision}))});}
        return successfulWithoutDuplicate(await call(provider, method, route, method === 'POST' ? body : undefined));
      }
    }
    return { status: 404, data: { success: false, code: 'NOT_FOUND', error: 'Operation not found.' } };
  } catch (error) {
    const known = error instanceof UpstreamError;
    return { status: known ? error.status : 503, data: { success: false, code: known ? error.code : 'PROVIDER_UNAVAILABLE', error: known ? error.message : 'Provider integration unavailable.' } };
  }
}
const successfulWithoutDuplicate = (data: any): Result => ({ status: 200, data });
export function createApplicationServer(service: string, legacy: Legacy) {
  const policy = new HttpPolicy();
  return http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const send = (status: number, data: any) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
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
        if (typeof req.headers['x-request-id'] === 'string') actor.requestId = req.headers['x-request-id'].slice(0, 200);
      }
      const body = await readJsonBody(req);
      if (integrated && url.pathname !== '/accounts' && service !== 'service-telecom') {
        const invalid = validateRequest(service, req.method || 'GET', url.pathname, query, body);
        if (invalid) return send(invalid.status, invalid.data);
      }
      const result = integrated ? await integratedRequest(service, actor!, req.method || 'GET', url.pathname, query, body, legacy) : legacy(req.method || 'GET', url.pathname, query, body);
      send(result.status, result.data);
    } catch (error) { res.setHeader('Connection', 'close'); send(error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 503, { success: false, code: 'REQUEST_FAILED', error: error instanceof HttpError ? error.message : error instanceof SyntaxError ? 'Invalid JSON body' : 'Request could not be completed.' }); }
  });
}
