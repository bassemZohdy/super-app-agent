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
  const settleBill = async (provider: string, billId?: string) => {
    const { bills } = await call(provider, 'GET', '/bills');
    const bill = billId ? bills.find((b: any) => b.billId === billId) : bills[0];
    if (!bill) throw new UpstreamError(404, 'NOT_FOUND', 'Bill not found.');
    if (bill.status === 'PAID') return { success: true, bill, chargedAmount: 0, receipt: { billId: bill.billId, ...(bill.premiseId ? { premiseId: bill.premiseId } : {}), receiptNumber: bill.receiptNumber, amountPaid: bill.totalAmount.toFixed(2), currency: 'AED' } };
    if (bill.status !== 'UNPAID' || bill.expiresAt && Date.parse(bill.expiresAt) <= Date.now()) throw new UpstreamError(409, 'PAYABLE_UNAVAILABLE', 'This bill is no longer payable.');
    const payable=(await call(provider,'GET','/payables')).payables.find((p:any)=>p.obligationId===bill.billId);
    if(!payable||payable.status!=='UNPAID'||payable.amountMinor!==Math.round(bill.totalAmount*100)||body.expectedPayableRevision&&body.expectedPayableRevision!==payable.revision||body.expectedAmountMinor!==undefined&&body.expectedAmountMinor!==payable.amountMinor)throw new UpstreamError(409,'PAYABLE_CHANGED','The reviewed bill changed. Review its current terms again.');
    const links=(await call('payments','GET','/billing-accounts')).billingAccounts;
    if(!links.some((b:any)=>b.status==='ACTIVE'&&b.provider===provider&&b.reference===payable.reference)) {
      try{await call('payments','POST','/billing-accounts',{provider,reference:payable.reference,nickname:`${provider.toUpperCase()} account`},stableKey(`bill-link:${provider}:${payable.reference}`));}
      catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}
    }
    const created=await call('payments','POST','/payment-orders',{provider,payableId:payable.id,expectedPayableRevision:payable.revision,methodId:'wallet',expectedMethodVersion:1},stableKey(`bill-order:${provider}:${bill.billId}:${payable.revision}:${actor.requestId}`));
    let order=(await call('payments','GET',`/payment-orders/${created.order.id}`)).order;
    if(order.state==='AWAITING_APPROVAL')order=(await call('payments','POST',`/payment-orders/${order.id}/approve`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`bill-authorize:${order.id}`))).order;
    if(order.state==='AUTHORIZED')order=(await call('payments','POST',`/payment-orders/${order.id}/execute`,{expectedVersion:order.version,approvalDigest:order.approvalDigest},stableKey(`bill-execute:${order.id}`))).order;
    else if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state))order=(await call('payments','POST',`/payment-orders/${order.id}/recover`,{},stableKey(`bill-recover:${order.id}:${actor.requestId}`))).order;
    if(order.state!=='SETTLED')throw new UpstreamError(order.fundsCaptured?502:409,order.failureCode||'PAYMENT_REQUIRES_REVIEW',order.fundsCaptured?'Payment was captured but settlement needs reconciliation. Inspect the original payment order.':'Bill payment stopped without capture. Review the original order.');
    const paid=(await call(provider,'GET','/bills')).bills.find((b:any)=>b.billId===bill.billId),wallet=await call('payments','GET','/wallet');
    return {success:true,bill:paid,receipt:{billId:bill.billId,receiptNumber:order.receipt.receiptNumber,amountPaid:(order.receipt.amountMinor/100).toFixed(2),currency:'AED',...(bill.premiseId?{premiseId:bill.premiseId}:{})},chargedAmount:order.quote.totalMinor/100,remainingBalance:wallet.balance};
  };
  const settleFines = async (fineIds?: string[]) => {
    const report = await call('police', 'GET', '/fines');
    const fines = fineIds ? report.fines.filter((f: any) => fineIds.includes(f.fineId)) : report.fines;
    if (fineIds && fineIds.length !== fines.length) throw new UpstreamError(404, 'NOT_FOUND', 'Unpaid fines not found.');
    if (!fines.length) return { success: true, amountPaid: 0, finesCleared: 0, receiptNumber: 'NO_FINES', remainingBalance: (await call('payments', 'GET', '/wallet')).balance };
    const ids = fines.map((f: any) => f.fineId).sort();
    const amount = fines.reduce((sum: number, f: any) => sum + Math.round(f.payableAmount * 100), 0) / 100;
    const payment = await charge('police', `fines:${ids.join(',')}`, amount);
    const result = await call('police', 'POST', '/fine-payments', { fineIds: ids, paymentId: payment.charge.id }, stableKey(`fines:${ids.join(',')}`));
    return { ...result, remainingBalance: payment.remainingBalance };
  };
  const recharge = async (amount: number) => {
    const reference = actor.requestId;
    const payment = await charge('rta', `salik:${reference}`, amount);
    return call('rta', 'POST', '/salik/recharges', { amount, paymentId: payment.charge.id, reference }, stableKey(`salik:${reference}`));
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
      if (method === 'POST' && path === '/pay/unified') {
        const steps: any[] = [];
        try {
          const utility = await settleBill('dewa'); steps.push({ service: 'dewa', receipt: utility.receipt });
          const fines = await settleFines(); steps.push({ service: 'police', receipt: fines.receiptNumber });
          const toll = await recharge(100); steps.push({ service: 'rta', receipt: toll.transactionId });
          const grandTotal = utility.chargedAmount + fines.amountPaid + 100;
          return successful({ govTransactionHash: actor.requestId, settlementPlatform: 'Demo payment gateway', grandTotal, breakdown: { utilities: utility.chargedAmount, fines: fines.amountPaid, salik: 100 }, remainingBalance: (await call('payments', 'GET', '/wallet')).balance, steps });
        } catch { return { status: 502, data: { success: false, code: 'PROVIDER_OUTCOME_UNKNOWN', outcome: 'UNKNOWN', error: 'Settlement stopped. Check provider payment status before retrying.', steps } }; }
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
