import { PaymentHistory } from './payment-history.ts';
import { PaymentReconciliation } from './payment-reconciliation.ts';
import { PaymentMandates } from './payment-mandates.ts';
import { IssuerScenarios,hasIssuerScenarioRun,type IssuerScenarioContext } from './issuer-scenarios.ts';
import { PaymentEvents } from './payment-events.ts';
import { PaymentRefunds } from './payment-refunds.ts';
import { ProviderReversals } from './provider-reversals.ts';
import { PaymentResourceUses } from './payment-resource-uses.ts';
import { PaymentIssuer } from './payment-issuer.ts';
import { CheckoutGroups } from './checkout-groups.ts';
import { PaymentOrders } from './payment-orders.ts';
import { WalletFunding } from './wallet-funding.ts';
import { PaymentClaims } from './payment-claims.ts';
import { ProviderRecharges } from './recharges.ts';
import { PayableAdmissions,rechargeTargetKey,assertPayableUnreserved } from './payable-admissions.ts';
import { ProviderPayables, type PayableProvider } from './payables.ts';
import { PaymentLedger } from './payment-ledger.ts';
import { paymentRegistry } from './payment-registry.ts';
import { randomUUID } from 'node:crypto';
import { AccountDatabase } from './database.ts';
import type { ProviderId } from './contracts.ts';
import { assetsFor, type Actor } from '../../../packages/backend-kit/src/context.ts';
import { parkingZones, evChargerStations, drivers, defaultUtilityAccount, activeUtilityBill, defaultEjariContract } from './fixtures.ts';
export type ApiResult = { status: number; data: any };
export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
const ok = (data: Record<string, any>): ApiResult => ({ status: 200, data: { success: true, ...data } });
const minor = (amount: number) => Math.round(amount * 100);
const major = (amount: number) => amount / 100;
export class ProviderEngine {
  readonly history?:PaymentHistory;readonly mandates?:PaymentMandates;readonly reconciliation?:PaymentReconciliation;
  readonly provider: ProviderId; readonly store: AccountDatabase; readonly ledger?: PaymentLedger; readonly resourceUses?: PaymentResourceUses; readonly payables?: ProviderPayables;readonly issuer?:PaymentIssuer;readonly orders?:PaymentOrders;readonly claims?:PaymentClaims;readonly admissions?:PayableAdmissions;readonly refunds?:PaymentRefunds;readonly reversals?:ProviderReversals;readonly groups?:CheckoutGroups;readonly funding?:WalletFunding;readonly recharges?:ProviderRecharges;
  constructor(provider: ProviderId, store: AccountDatabase, options: {businessClock?:()=>number;authorizationClock?:()=>number;issuerScenario?:IssuerScenarioContext} = {}) { this.provider = provider; this.store = store;if(provider==='payments'){if(options.issuerScenario)store.issuerScenarios=new IssuerScenarios(store,options.issuerScenario);else if(hasIssuerScenarioRun(store))throw new Error('An issuer scenario database requires its original isolated run context.');}if(provider!=='dld')store.events=new PaymentEvents(store,provider); if (provider === 'payments') { this.ledger = new PaymentLedger(store,options.authorizationClock); this.resourceUses = new PaymentResourceUses(store);this.mandates=new PaymentMandates(store,this.resourceUses);this.issuer=new PaymentIssuer(store,options.authorizationClock);this.orders=new PaymentOrders(store,this.issuer,this.ledger,this.resourceUses,options.authorizationClock);this.groups=new CheckoutGroups(this.orders);this.claims=new PaymentClaims(store);this.funding=new WalletFunding(store,this.issuer,this.ledger,this.resourceUses,options.authorizationClock);this.refunds=new PaymentRefunds(this.orders,this.funding,this.claims);this.reconciliation=new PaymentReconciliation(this.orders,this.funding,this.refunds);this.history=new PaymentHistory(store); } if(['dewa','etisalat','du','police'].includes(provider)) {this.payables=new ProviderPayables(store,provider as PayableProvider,options.businessClock);} if(['rta','etisalat','du'].includes(provider))this.recharges=new ProviderRecharges(store,provider as import('../../../packages/protocol-core/src/payments.ts').RechargeProvider,options.businessClock);if(this.payables||this.recharges)this.admissions=new PayableAdmissions(store,{inspect:(a,id,revision)=>this.obligationBook(id).inspect(a,id,revision),applyAdmitted:(a,p,paymentId,at)=>this.obligationBook(p.id).applyAdmitted(a,p,paymentId,at)},options.businessClock);if(this.admissions)this.reversals=new ProviderReversals(store,provider,this.admissions,this.payables,this.recharges); }
  private obligationBook(id:string){if(id.startsWith(`${this.provider}:recharge:`)&&this.recharges)return this.recharges;if(this.payables)return this.payables;return fail(404,'PAYABLE_NOT_FOUND','Payment obligation not found.');}
  seed(actor: Actor) {
    const db = this.store, account = actor.accountId;
    if (db.get(account, 'seed')) {
      if (['etisalat','du','police'].includes(this.provider) && !db.get(account, 'account-resources-v2')) db.transaction(() => this.seedAccountResources(actor));
      this.payables?.initializeHistory(account);
      return;
    }
    const asset = assetsFor(account);
    db.transaction(() => {
      if (this.provider === 'rta') db.put(account, 'salik', { balance: 14, tagNumber: asset.salikTag, status: 'ACTIVE', currency: 'AED' });
      if (this.provider === 'dewa') {
        db.put(account, 'consumption', { ...structuredClone(defaultUtilityAccount), premiseId: asset.premiseId, accountNumber: asset.utilityAccount, consumerName: actor.name, activeContract: asset.contractNumber });
        db.put(account, 'bill', { ...structuredClone(activeUtilityBill), billId: `DEWA-${account.slice(-8)}`, premiseId: asset.premiseId, accountNumber: asset.utilityAccount, status: 'UNPAID' });
      }
      if (this.provider === 'police') for (const [index, amount] of [270, 150].entries()) db.put(account, 'fine', {
        fineId: `FINE-${account.slice(-8)}-${index}`, agency: 'Dubai Police', plateNumber: asset.plate, violation: index ? 'Parking overstay' : 'Speeding', location: 'Dubai', date: new Date().toISOString(), originalAmount: index ? 150 : 300,
        discountAmount: index ? 0 : 30, payableAmount: amount, blackPoints: 0, status: 'UNPAID',
      }, `FINE-${account.slice(-8)}-${index}`);
      if (this.provider === 'dld') db.put(account, 'contract', { ...structuredClone(defaultEjariContract), tenantName: actor.name, contractNumber: asset.contractNumber, property: { ...defaultEjariContract.property, premiseId: asset.premiseId } });
      if (this.provider === 'payments' && !db.get(account, 'wallet')) db.put(account, 'wallet', { balanceMinor: 150000, currency: 'AED' });
      if (this.provider === 'etisalat' || this.provider === 'du') {
        const subscriptionId = `SUB-${this.provider}-${account.slice(-8)}`;
        db.put(account, 'subscription', { subscriptionId, provider: this.provider, planId: 'home_299', name: 'Home internet', status: 'ACTIVE', monthlyAmount: 299, currency: 'AED' }, subscriptionId);
        db.put(account, 'bill', { billId: `BILL-${this.provider}-${account.slice(-8)}`, subscriptionId, amountMinor: 29900, totalAmount: 299, currency: 'AED', status: 'UNPAID', dueDate: '2026-11-30' });
      }
      if (this.provider === 'payments') this.ledger!.initializeAccount(account);
      this.seedAccountResources(actor);
      db.put(account, 'seed', true);
    });
    this.payables?.initializeHistory(account);
  }
  private seedAccountResources(actor: Actor) {
    const db = this.store, account = actor.accountId, suffix = account.slice(-8);
    if (db.get(account, 'account-resources-v2') || !['etisalat','du','police'].includes(this.provider)) return;
    if (this.provider === 'police') {
      const id = `VEH-${suffix}`;
      if (!db.get(account, 'vehicle', id)) db.put(account, 'vehicle', { vehicleId: id, plateNumber: assetsFor(account).plate, status: 'ACTIVE', name: 'Demo registered vehicle' }, id);
    } else {
      const id = `PRE-${this.provider}-${suffix}`;
      if (!db.get(account, 'prepaid-line', id)) db.put(account, 'prepaid-line', { lineId: id, provider: this.provider, name: 'Prepaid mobile', phoneLabel: `Demo line ${suffix}`, balanceMinor: 5000, currency: 'AED', status: 'ACTIVE', denominationsMinor: [2500,5000,10000] }, id);
    }
    db.put(account, 'account-resources-v2', { version: 2 });
  }
  private proof(proof: any, merchant: string, reference: string, amountMinor: number) {
    if (!proof || proof.status !== 'CAPTURED' || proof.refunded || proof.merchant !== merchant || proof.reference !== reference || proof.amountMinor !== amountMinor) fail(409, 'INVALID_PAYMENT_PROOF', 'A matching captured payment is required.');
  }
  execute(actor: Actor, method: string, path: string, body: any, proof?: any, payableSnapshot?:import('../../../packages/protocol-core/src/payments.ts').Payable,gatewayOrder?:import('../../../packages/protocol-core/src/payments.ts').PaymentAuthorizationReview,refundReview?:import('../../../packages/protocol-core/src/payments.ts').PaymentRefund): ApiResult {
    if(this.provider==='payments'&&method==='POST'&&(path==='/charges'||/^\/charges\/[^/]+\/refunds$/.test(path))&&!this.store.db.isTransaction)return this.store.transaction(()=>this.execute(actor,method,path,body,proof,payableSnapshot,gatewayOrder,refundReview));
    const db = this.store, a = actor.accountId, asset = assetsFor(a);
    const now = () => new Date().toISOString();
    if(this.reversals&&/^\/payment-reversals\/[^/]+$/.test(path)){const id=path.split('/')[2];if(method==='GET')return ok({reversal:this.reversals.get(a,id)});if(method==='POST'){if(refundReview?.id!==id)fail(409,'REVERSAL_MISMATCH','The gateway refund identity must match this route.');return ok({reversal:this.reversals.apply(a,refundReview!)});}}
    if(this.recharges){if(method==='GET'&&/^\/recharge-intents\/[^/]+$/.test(path))return ok(this.recharges.byIntent(a,decodeURIComponent(path.split('/')[2])));if(method==='GET'&&path==='/recharge-targets')return ok({targets:this.recharges.targets(a)});if(method==='POST'&&path==='/recharge-quotes')return ok({payable:this.recharges.quote(a,body)});}
    if(this.admissions) {
      if(this.provider==='police'&&method==='POST'&&path==='/fine-selections')return ok({payable:this.payables!.selectFines(a,body.items)});
      const route=/^\/payables\/([^/]+)\/admissions(?:\/([^/]+)(?:\/(admit|cancel|payments|finish))?)?$/.exec(path);
      if(route){
        const payableId=decodeURIComponent(route[1]),id=route[2],action=route[3];
        if(!id&&method==='POST')return ok({admission:this.admissions!.prepare(a,payableId,body)});
        const admission=this.admissions!.get(a,id);if(admission.payable.id!==payableId)fail(409,'ADMISSION_MISMATCH','This reservation belongs to another obligation.');
        if(method==='GET'&&!action)return ok({admission});
        if(method==='POST'&&action==='admit')return ok({admission:this.admissions!.admit(a,id,gatewayOrder!)});
        if(method==='POST'&&action==='cancel')return ok({admission:this.admissions!.cancel(a,id,gatewayOrder!)});
        if(method==='POST'&&action==='finish')return ok({admission:this.admissions!.finish(a,id,gatewayOrder!)});
        if(method==='POST'&&action==='payments')return ok(this.admissions!.settle(a,id,body.paymentId,proof));
      }
      if(method === 'GET' && path === '/payables') return ok({payables:this.payables?.list(a)||[]});
      if(method === 'GET' && /^\/payables\/[^/]+$/.test(path)) { const payable=this.obligationBook(decodeURIComponent(path.split('/')[2])).get(a,decodeURIComponent(path.split('/')[2])); return ok({payable,settlementReference:`payable:${payable.revision}`}); }
      if(method === 'POST' && /^\/payables\/[^/]+\/reviews$/.test(path)) {
        const payable=this.obligationBook(decodeURIComponent(path.split('/')[2])).inspect(a,decodeURIComponent(path.split('/')[2]),body.expectedRevision);
        return ok({payable,settlementReference:`payable:${payable.revision}`});
      }
      if(method === 'POST' && /^\/payables\/[^/]+\/payments$/.test(path)) {if(decodeURIComponent(path.split('/')[2]).startsWith(`${this.provider}:recharge:`))fail(409,'ADMISSION_REQUIRED','Recharge requires its stored-order admission.');if(!this.payables)fail(404,'PAYABLE_NOT_FOUND','Payment obligation not found.');return ok(this.payables!.settle(a,decodeURIComponent(path.split('/')[2]),body.expectedRevision,body.paymentId,proof));}
    }
    if (this.provider === 'payments') {
      this.orders!.refresh(actor);this.funding!.refresh(actor);this.mandates!.list(actor);
      if(method==='GET'&&(path==='/payment-history'||path.startsWith('/payment-history/pages/')))return ok(this.history!.activity(actor,path.split('/')[3]));
      if(method==='GET'&&/^\/payment-history\/details\/(PAYMENT|FUNDING|REFUND|LEGACY|GROUP)\/[^/]+$/.test(path))return ok({operation:this.history!.detail(actor,path.split('/')[3] as import('../../../packages/protocol-core/src/payment-history.ts').HistoryKind,path.split('/')[4])});
      if(method==='GET'&&(path==='/payment-statement'||path.startsWith('/payment-statement/pages/')))return ok(this.history!.statement(actor,path.split('/')[3]));
      if(method==='GET'&&path==='/payment-reconciliation')return ok(this.reconciliation!.list(actor));
      if(method==='GET'&&path.startsWith('/payment-reconciliation/pages/'))return ok(this.reconciliation!.list(actor,decodeURIComponent(path.split('/')[3])));
      if(method==='GET'&&/^\/payment-reconciliation\/inspections\/[^/]+$/.test(path))return ok({inspection:this.reconciliation!.get(actor,path.split('/')[3])});
      if(method==='GET'&&/^\/payment-reconciliation\/audit\/(PAYMENT|FUNDING|REFUND|LEGACY)\/[^/]+$/.test(path))return ok({audit:this.reconciliation!.audit(actor,path.split('/')[3] as import('../../../packages/protocol-core/src/payment-reconciliation.ts').RecoveryKind,path.split('/')[4])});
      if(method==='GET'&&path==='/payment-mandates')return ok({mandates:this.mandates!.list(actor),executionEnabled:false});
      if(method==='POST'&&path==='/payment-mandates')return ok({mandate:this.mandates!.create(actor,body.policy)});
      const mandateRoute=/^\/payment-mandates\/([^/]+)(?:\/(history|revise|approve|revoke))?$/.exec(path);
      if(mandateRoute){const [,id,action]=mandateRoute;
        if(method==='GET')return ok(action==='history'?{history:this.mandates!.history(actor,id)}:{mandate:this.mandates!.get(actor,id)});
        if(method==='POST')return ok({mandate:action==='revise'?this.mandates!.revise(actor,id,body.expectedVersion,body.policy):action==='approve'?this.mandates!.approve(actor,id,body.expectedVersion,body.approvalDigest):this.mandates!.revoke(actor,id,body.expectedVersion)});
      }
      if(method==='GET'&&path==='/wallet-funding-orders')return ok({orders:this.funding!.list(actor)});
      if(method==='GET'&&/^\/wallet-funding-orders\/[^/]+$/.test(path))return ok({order:this.funding!.get(actor,path.split('/')[2])});
      if(method==='POST'&&path==='/wallet-funding-orders')return ok({order:this.funding!.create(actor,body)});
      if(method==='POST'&&/^\/wallet-funding-orders\/[^/]+\/(approve|challenge|cancel|execute)$/.test(path)){
        const [,,id,action]=path.split('/'),f=this.funding!;
        return ok({order:action==='approve'?f.approve(actor,id,body):action==='challenge'?f.challenge(actor,id,body,!!actor.authorization):action==='cancel'?f.cancel(actor,id,body.expectedVersion):f.execute(actor,id,body)});
      }
      if(method==='POST'&&path==='/topups'){
        const order=this.funding!.compatibility(actor,body.amountMinor,body.source);
        if(order.state!=='SETTLED')return {status:402,data:{success:false,code:order.failureCode||'PAYMENT_DECLINED',error:'The finite demo funding source could not fund this top-up. Inspect the wallet funding review.'}};
        return ok({transaction:db.get(a,'transaction',order.id),newBalance:order.receipt!.balanceMinor/100});
      }
      if(method==='GET'&&path==='/payment-events')return ok({events:db.events!.status(a)});
      if(method==='GET'&&path==='/payment-refunds')return ok({refunds:this.refunds!.list(actor)});
      if(method==='GET'&&/^\/payment-refunds\/[^/]+$/.test(path))return ok({refund:this.refunds!.get(actor,path.split('/')[2])});
      if(method==='POST'&&path==='/payment-refunds')return ok({refund:this.refunds!.create(actor,body)});
      if(method==='POST'&&/^\/payment-refunds\/[^/]+\/cancel$/.test(path))return ok({refund:this.refunds!.cancel(actor,path.split('/')[2],body.expectedVersion)});
      if(method==='GET'&&path==='/checkout-groups')return ok({groups:this.groups!.list(actor)});
      if(method==='GET'&&/^\/checkout-groups\/[^/]+$/.test(path))return ok({group:this.groups!.get(actor,path.split('/')[2])});
      if(method==='GET'&&path==='/payment-orders')return ok({orders:this.orders!.list(actor)});
      if(method==='GET'&&/^\/payment-orders\/[^/]+$/.test(path))return ok({order:this.orders!.get(actor,path.split('/')[2])});
      if(method==='POST'&&path==='/payment-orders')return ok({order:this.orders!.create(actor,body,payableSnapshot)});
      if(method==='POST'&&/^\/payment-orders\/[^/]+\/(approve|challenge|cancel)$/.test(path)) {
        const [, ,id,action]=path.split('/');
        return ok({order:action==='approve'?this.orders!.approve(actor,id,body,payableSnapshot):action==='challenge'?this.orders!.challenge(actor,id,body,payableSnapshot,!!actor.authorization):this.orders!.cancel(actor,id,body.expectedVersion)});
      }
      const registry = paymentRegistry(db, a, method, path, body, this.resourceUses!);
      if (registry) return ok({...registry,...(path==='/payment-methods'&&method==='GET'?{cardBalances:(registry.methods||[]).filter((m:any)=>m.kind==='card').map((m:any)=>this.issuer!.summary(a,m.id))}:{})});
      const wallet = this.ledger!.summary(a);
      if (method === 'GET' && path === '/wallet') return ok({ ...wallet, balance: major(wallet.balanceMinor) });
      if (method === 'GET' && path === '/transactions') {
        const transactions=db.list(a,'transaction').map(tx=>{
          const charge=db.get(a,'charge',tx.id),funding=db.db.prepare('SELECT id FROM wallet_funding_orders WHERE account_id=? AND id=?').get(a,tx.id),refund=db.db.prepare('SELECT body FROM payment_refunds WHERE account_id=? AND id=?').get(a,tx.id);
          if(!charge&&!funding&&!refund)return tx;
          const operation=this.history!.detail(actor,charge?(charge.orderId?'PAYMENT':'LEGACY'):funding?'FUNDING':'REFUND',charge?.orderId||tx.id);
          const q=refund?JSON.parse(String(refund.body)).quote:undefined,reference=charge?`charge:${charge.id}`:funding?`wallet-funding:${tx.id}`:`${q.origin==='PAYMENT'?'order-refund':'funding-refund'}:${tx.id}`;
          const journal=db.db.prepare('SELECT wallet_delta FROM payment_journal_entries WHERE account_id=? AND reference=? AND finalized=1').get(a,reference);
          return {...tx,status:operation.state,sourceLabel:operation.source.label,...(operation.source.last4?{sourceLast4:operation.source.last4}:{}),walletDeltaMinor:journal?Number(journal.wallet_delta):0,captureState:operation.captureState,settlementState:operation.settlementState,refundState:operation.refundState,completeReceipt:operation.completeReceipt,correlationReference:operation.correlationReference};
        });return ok({transactions,count:transactions.length});
      }
      if (method === 'GET' && path.startsWith('/charges/')) { const charge = db.get(a, 'charge', path.split('/')[2]); if (!charge) fail(404, 'NOT_FOUND', 'Payment not found.'); return ok({ charge:{...charge,...(this.claims!.get(a,charge.id)?{settlement:this.claims!.get(a,charge.id)}:{})} }); }
      if (method === 'POST' && path === '/charges') {
        const id = randomUUID();
        const declined = body.source === 'demo_declined' || (body.source === 'wallet' && wallet.availableMinor < body.amountMinor);
        const charge = { id, accountId: a, amountMinor: body.amountMinor, merchant: body.merchant, reference: body.reference, source: body.source, status: declined ? 'DECLINED' : 'CAPTURED', currency: 'AED', createdAt: now(), refunded: false };
        db.put(a, 'charge', charge, id);
        if(declined)this.store.events!.emitLegacyCapture(charge);
        if (declined) return { status: 402, data: { success: false, code: 'PAYMENT_DECLINED', error: 'The simulated payment was declined. Check the wallet balance or demo funding source.' } };
        const next = wallet.balanceMinor + (body.source === 'wallet' ? -body.amountMinor : 0);
        if (!Number.isSafeInteger(next) || next > 100_000_000) fail(400, 'BALANCE_LIMIT', 'Demo wallet balance limit exceeded.');
        this.ledger!.record(a, 'PAYMENT', `charge:${id}`, body.amountMinor, body.source === 'wallet' ? 'wallet' : 'external');
        const transaction = { id, type: 'PAYMENT', amount: major(body.amountMinor), currency: 'AED', purpose: body.reference, status: 'SETTLED', timestamp: Date.now(), referenceId: body.reference };
        db.put(a, 'transaction', transaction, id);
        this.store.events!.emitLegacyCapture(charge);
        return ok({ charge, transaction, remainingBalance: major(next) });
      }
      if (method === 'POST' && /^\/charges\/[^/]+\/refunds$/.test(path)) {
        const charge = db.get(a, 'charge', path.split('/')[2]);
        if (!charge) fail(404, 'NOT_FOUND', 'Payment not found.');
        if (charge.status !== 'CAPTURED' || charge.refunded) fail(409, 'NOT_REFUNDABLE', 'This payment cannot be refunded.');
        this.claims!.assertRefundable(a,charge.id);
        if(charge.orderId)fail(409,'ORDER_REFUND_REQUIRES_RECONCILIATION','Stored-order refunds require the original-source reconciliation workflow.');
        const next = wallet.balanceMinor + (charge.source === 'wallet' ? charge.amountMinor : 0);
        if (next > 100_000_000) fail(409, 'BALANCE_LIMIT', 'Demo wallet balance limit exceeded.');
        charge.refunded = true; charge.refundedAt = now();
        this.ledger!.record(a, 'REFUND', `refund:${charge.id}`, charge.amountMinor, charge.source === 'wallet' ? 'wallet' : 'external');
        db.put(a, 'charge', charge, charge.id);
        const refund = { id: randomUUID(), chargeId: charge.id, amountMinor: charge.amountMinor, currency: 'AED', status: 'REFUNDED', reason: body.reason };
        db.put(a, 'transaction', { id: refund.id, type: 'REFUND', amount: major(charge.amountMinor), currency: 'AED', purpose: body.reason, status: 'SETTLED', timestamp: Date.now() }, refund.id);
        this.store.events!.emitLegacyCapture(charge);
        return ok({ refund, remainingBalance: major(next) });
      }
    }
    if (this.provider === 'rta') {
      if (method === 'GET' && path === '/parking/zones') return ok({ zones: parkingZones, count: parkingZones.length });
      if (method === 'GET' && path === '/parking/sessions') { const meters = db.list(a, 'parking'); return ok({ meters, count: meters.length }); }
      if (method === 'POST' && path === '/parking/sessions') {
        const zone = parkingZones.find(z => z.id === body.zoneId);
        if (!zone) fail(404, 'NOT_FOUND', 'Parking zone not found.');
        if (body.plateNumber !== asset.plate) fail(403, 'PLATE_NOT_OWNED', 'This plate does not belong to the account.');
        this.proof(proof, 'rta', `parking:${body.reference}`, minor(zone.tariffPerHour) * body.durationHours);
        const meter = { ticketId: randomUUID(), zoneId: zone.id, zoneCode: zone.code, zoneName: zone.name, plateNumber: body.plateNumber, durationHours: body.durationHours, totalFee: major(minor(zone.tariffPerHour) * body.durationHours), startTime: Date.now(), expiresAt: Date.now() + body.durationHours * 3600000, status: 'ACTIVE' };
        db.put(a, 'parking', meter, meter.ticketId); return ok({ meter });
      }
      if (method === 'POST' && /^\/parking\/sessions\/[^/]+\/extensions$/.test(path)) {
        const meter = db.get(a, 'parking', path.split('/')[3]);
        if (!meter) fail(404, 'NOT_FOUND', 'Parking session not found.');
        if (meter.durationHours + body.additionalHours > 720) fail(400, 'DURATION_LIMIT', 'Maximum duration is 720 hours.');
        const zone = parkingZones.find(z => z.id === meter.zoneId)!;
        this.proof(proof, 'rta', `parking-extension:${body.reference}`, minor(zone.tariffPerHour) * body.additionalHours);
        meter.durationHours += body.additionalHours; meter.totalFee = major(minor(meter.totalFee) + minor(zone.tariffPerHour) * body.additionalHours); meter.expiresAt += body.additionalHours * 3600000;
        db.put(a, 'parking', meter, meter.ticketId); return ok({ meter });
      }
      if (method === 'GET' && path === '/salik') return ok(db.get(a, 'salik')!);
      if (method === 'POST' && path === '/salik/recharges') {
        assertPayableUnreserved(db,a,rechargeTargetKey('rta',db.get(a,'salik').tagNumber),this.recharges!.clock);
        this.proof(proof, 'rta', `salik:${body.reference}`, minor(body.amount));
        const salik = db.get(a, 'salik');if((salik.version||1)>=1000000)fail(409,'VERSION_LIMIT','The toll tag reached its demo version limit.');if(salik.status!=='ACTIVE')fail(409,'RECHARGE_TARGET_CHANGED','The toll tag is closed.');salik.version=(salik.version||1)+1;salik.balance = major(minor(salik.balance) + minor(body.amount));
        if (minor(salik.balance) > 100_000_000) fail(400, 'BALANCE_LIMIT', 'Demo toll balance limit exceeded.');
        db.put(a, 'salik', salik); return ok({ transactionId: body.paymentId, newBalance: salik.balance, amountRecharged: body.amount });
      }
      if (method === 'GET' && path === '/salik/passings') return ok({ passings: [] });
      if (method === 'GET' && path === '/ev/chargers') return ok({ chargers: evChargerStations });
      if (method === 'POST' && path === '/ev/sessions') {
        if (!evChargerStations.some(c => c.id === body.chargerId)) fail(404, 'NOT_FOUND', 'Charger not found.');
        if (body.plateNumber !== asset.plate) fail(403, 'PLATE_NOT_OWNED', 'This plate does not belong to the account.');
        const session = { id: randomUUID(), ...body, status: 'CHARGING', startedAt: now() }; db.put(a, 'ev', session, session.id); return ok({ session });
      }
      if (method === 'GET' && path === '/rides/options') return ok({ options: drivers });
      if (method === 'POST' && path === '/rides/bookings') {
        const driver = drivers.find(d => d.id === body.driverId); if (!driver) fail(404, 'NOT_FOUND', 'Driver not found.');
        const booking = { bookingId: randomUUID(), driver, status: 'CONFIRMED', pickup: body.pickup || 'Current location', dropoff: body.dropoff || 'Downtown', etaMinutes: driver.etaMinutes, estimatedArrival: `${driver.etaMinutes} min`, timestamp: Date.now() }; db.put(a, 'ride', booking, booking.bookingId); return ok({ booking });
      }
      if (method === 'GET' && path.startsWith('/rides/bookings/')) { const booking = db.get(a, 'ride', path.split('/')[3]); if (!booking) fail(404, 'NOT_FOUND', 'Booking not found.'); return ok({ booking }); }
      if (method === 'POST' && path === '/residential-permits') { if (body.contractNumber !== asset.contractNumber) fail(404, 'NOT_FOUND', 'Tenancy not found.'); const permit = { permitNumber: `PRM-${a.slice(-8)}`, zone: 'Downtown residential', status: 'ISSUED' }; db.put(a, 'permit', permit); return ok({ permit }); }
    }
    if (this.provider === 'dewa') {
      if (method === 'GET' && path === '/consumption') return ok({ account: db.get(a, 'consumption'), ecoStatus: 'Demo smart meter snapshot' });
      if (method === 'GET' && path === '/bills') return ok({ bills: this.billRecords(a) });
      if (method === 'POST' && /^\/bills\/[^/]+\/payments$/.test(path)) return this.payBill(a, path.split('/')[2], body.paymentId, proof);
      if (method === 'POST' && path === '/connections') { if (body.contractNumber !== asset.contractNumber) fail(404, 'NOT_FOUND', 'Tenancy not found.'); const connection = { premiseId: asset.premiseId, status: 'CONNECTED_ACTIVE', depositWaived: true }; db.put(a, 'connection', connection); return ok({ connection }); }
    }
    if (this.provider === 'etisalat' || this.provider === 'du') {
      if (method === 'GET' && path === '/prepaid') return ok({ lines: db.list(a, 'prepaid-line') });
      if (method === 'GET' && path === '/subscriptions') return ok({ subscriptions: db.list(a, 'subscription') });
      const plans = [{ planId: 'home_299', name: 'Home internet 250 Mbps', monthlyAmount: 299, currency: 'AED' }, { planId: 'home_399', name: 'Home internet 500 Mbps', monthlyAmount: 399, currency: 'AED' }];
      if (method === 'GET' && path === '/plans') return ok({ plans });
      if (method === 'GET' && path === '/bills') return ok({ bills: this.billRecords(a) });
      if (method === 'POST' && /^\/bills\/[^/]+\/payments$/.test(path)) return this.payBill(a, path.split('/')[2], body.paymentId, proof);
      if (method === 'POST' && /^\/subscriptions\/[^/]+\/plan$/.test(path)) {
        const subscription = db.get(a, 'subscription', path.split('/')[2]); const plan = plans.find(p => p.planId === body.planId);
        if (!subscription || !plan) fail(404, 'NOT_FOUND', 'Subscription or plan not found.');
        subscription.planId = plan.planId; subscription.monthlyAmount = plan.monthlyAmount; db.put(a, 'subscription', subscription, subscription.subscriptionId); return ok({ subscription });
      }
    }
    if (this.provider === 'police') {
      if (method === 'GET' && path === '/vehicles') return ok({ vehicles: db.list(a, 'vehicle') });
      const summaries=new Map(this.payables!.list(a).map(p=>[p.obligationId,p]));
      const fines = db.list(a, 'fine').filter(f => summaries.get(f.fineId)?.status === 'UNPAID').map(f=>({...f,payableAmount:summaries.get(f.fineId)!.amountMinor/100,discountAmount:summaries.get(f.fineId)!.discountMinor!/100,payableId:summaries.get(f.fineId)!.id,payableRevision:summaries.get(f.fineId)!.revision,paymentRestricted:summaries.get(f.fineId)!.paymentRestricted}));
      if (method === 'GET' && path === '/fines') return ok({ fines, count: fines.length, totalPayable: major(fines.reduce((sum, f) => sum + minor(f.payableAmount), 0)), totalOriginal: fines.reduce((sum, f) => sum + f.originalAmount, 0), totalDiscount: fines.reduce((sum, f) => sum + f.discountAmount, 0) });
      if (method === 'POST' && path === '/fine-payments') {
        const selected = fines.filter(f => body.fineIds.includes(f.fineId));
        if (selected.length !== body.fineIds.length) fail(404, 'NOT_FOUND', 'Unpaid fines not found.');
        for(const fine of selected) { this.payables!.assertUnreserved(a,`police:fine:${fine.fineId}`);const payable=this.payables!.inspect(a,`police:fine:${fine.fineId}`,summaries.get(fine.fineId)!.revision); if(payable.version! >= 1_000_000) fail(409,'VERSION_LIMIT','The obligation reached its demo revision limit.'); }
        const amount = selected.reduce((sum, f) => sum + minor(f.payableAmount), 0);
        this.proof(proof, 'police', `fines:${[...body.fineIds].sort().join(',')}`, amount);
        for (const fine of selected) db.put(a, 'fine', { ...fine, status: 'PAID', payableVersion:(fine.payableVersion||1)+1,paidAmount:fine.payableAmount, receiptNumber: body.paymentId, paidAt: now() }, fine.fineId);
        return ok({ receiptNumber: body.paymentId, finesCleared: selected.length, amountPaid: major(amount) });
      }
    }
    if (this.provider === 'dld') {
      const contract = db.get(a, 'contract');
      if (method === 'GET' && path === '/tenancy') return ok({ contract });
      if (method === 'POST' && path === '/move-ins') {
        if (body.contractNumber !== contract.contractNumber) fail(404, 'NOT_FOUND', 'Tenancy contract not found.');
        const proposal = { ejariContract: contract.contractNumber, unit: `${contract.property.building}, ${contract.property.unitNumber}`, residentialParking: { status: 'PENDING_ACTIVATION' } };
        db.put(a, 'move-in', proposal); return ok(proposal);
      }
    }
    return fail(404, 'NOT_FOUND', 'Operation not found.');
  }
  private payBill(account: string, billId: string, paymentId: string, proof: any) {
    const record=this.store.db.prepare("SELECT id,body FROM resources WHERE account_id=? AND kind='bill' AND json_extract(body,'$.billId')=?").get(account,billId);
    if (!record) return fail(404, 'NOT_FOUND', 'Bill not found.');
    const bill=JSON.parse(String(record.body));
    if (bill.status === 'PAID') fail(409, 'ALREADY_PAID', 'Bill is already settled.');
    if (bill.status !== 'UNPAID') fail(409,'PAYABLE_UNAVAILABLE','This bill is no longer payable.');
    const payable=this.payables!.list(account).find(p=>p.obligationId===billId)!;
    this.payables!.assertUnreserved(account,payable.id);
    this.payables!.inspect(account,payable.id,payable.revision);
    if(payable.version! >= 1_000_000) fail(409,'VERSION_LIMIT','The obligation reached its demo revision limit.');
    this.proof(proof, this.provider, `bill:${billId}`, minor(bill.totalAmount));
    bill.status = 'PAID'; bill.payableVersion=(bill.payableVersion||1)+1; bill.receiptNumber = paymentId; bill.paidAt = new Date().toISOString(); this.store.put(account, 'bill', bill,String(record.id));
    return ok({ bill, receipt: { billId, receiptNumber: paymentId, amountPaid: bill.totalAmount.toFixed(2), currency: 'AED' } });
  }
  private billRecords(account: string) { return this.store.db.prepare("SELECT body FROM resources WHERE account_id=? AND kind='bill' ORDER BY CASE WHEN id='current' THEN 0 ELSE 1 END,rowid DESC LIMIT 100").all(account).map(row=>JSON.parse(String(row.body))); }
}
