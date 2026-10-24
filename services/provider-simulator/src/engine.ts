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
  readonly provider: ProviderId; readonly store: AccountDatabase;
  constructor(provider: ProviderId, store: AccountDatabase) { this.provider = provider; this.store = store; }
  seed(actor: Actor) {
    const db = this.store, account = actor.accountId;
    if (db.get(account, 'seed')) return;
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
      if (this.provider === 'payments') db.put(account, 'wallet', { balanceMinor: 150000, currency: 'AED' });
      if (this.provider === 'etisalat' || this.provider === 'du') {
        const subscriptionId = `SUB-${this.provider}-${account.slice(-8)}`;
        db.put(account, 'subscription', { subscriptionId, provider: this.provider, planId: 'home_299', name: 'Home internet', status: 'ACTIVE', monthlyAmount: 299, currency: 'AED' }, subscriptionId);
        db.put(account, 'bill', { billId: `BILL-${this.provider}-${account.slice(-8)}`, subscriptionId, amountMinor: 29900, totalAmount: 299, currency: 'AED', status: 'UNPAID', dueDate: '2026-11-30' });
      }
      db.put(account, 'seed', true);
    });
  }
  private proof(proof: any, merchant: string, reference: string, amountMinor: number) {
    if (!proof || proof.status !== 'CAPTURED' || proof.refunded || proof.merchant !== merchant || proof.reference !== reference || proof.amountMinor !== amountMinor) fail(409, 'INVALID_PAYMENT_PROOF', 'A matching captured payment is required.');
  }
  execute(actor: Actor, method: string, path: string, body: any, proof?: any): ApiResult {
    const db = this.store, a = actor.accountId, asset = assetsFor(a);
    const now = () => new Date().toISOString();
    if (this.provider === 'payments') {
      const wallet = db.get(a, 'wallet');
      if (method === 'GET' && path === '/wallet') return ok({ ...wallet, balance: major(wallet.balanceMinor) });
      if (method === 'GET' && path === '/transactions') { const transactions = db.list(a, 'transaction'); return ok({ transactions, count: transactions.length }); }
      if (method === 'GET' && path.startsWith('/charges/')) { const charge = db.get(a, 'charge', path.split('/')[2]); if (!charge) fail(404, 'NOT_FOUND', 'Payment not found.'); return ok({ charge }); }
      if (method === 'POST' && (path === '/charges' || path === '/topups')) {
        const id = randomUUID(), topup = path === '/topups';
        const declined = body.source === 'demo_declined' || (!topup && body.source === 'wallet' && wallet.balanceMinor < body.amountMinor);
        const charge = { id, accountId: a, amountMinor: body.amountMinor, merchant: body.merchant, reference: body.reference, source: body.source, status: declined ? 'DECLINED' : 'CAPTURED', currency: 'AED', createdAt: now(), refunded: false };
        if (!topup) db.put(a, 'charge', charge, id);
        if (declined) return { status: 402, data: { success: false, code: 'PAYMENT_DECLINED', error: 'The simulated payment was declined. Check the wallet balance or demo funding source.' } };
        const next = wallet.balanceMinor + (topup ? body.amountMinor : body.source === 'wallet' ? -body.amountMinor : 0);
        if (!Number.isSafeInteger(next) || next > 100_000_000) fail(400, 'BALANCE_LIMIT', 'Demo wallet balance limit exceeded.');
        wallet.balanceMinor = next; db.put(a, 'wallet', wallet);
        const transaction = { id, type: topup ? 'TOPUP' : 'PAYMENT', amount: major(body.amountMinor), currency: 'AED', purpose: body.reference || 'Demo wallet reload', status: 'SETTLED', timestamp: Date.now(), referenceId: body.reference };
        db.put(a, 'transaction', transaction, id);
        return topup ? ok({ transaction, newBalance: major(next) }) : ok({ charge, transaction, remainingBalance: major(next) });
      }
      if (method === 'POST' && /^\/charges\/[^/]+\/refunds$/.test(path)) {
        const charge = db.get(a, 'charge', path.split('/')[2]);
        if (!charge) fail(404, 'NOT_FOUND', 'Payment not found.');
        if (charge.status !== 'CAPTURED' || charge.refunded) fail(409, 'NOT_REFUNDABLE', 'This payment cannot be refunded.');
        const next = wallet.balanceMinor + (charge.source === 'wallet' ? charge.amountMinor : 0);
        if (next > 100_000_000) fail(409, 'BALANCE_LIMIT', 'Demo wallet balance limit exceeded.');
        wallet.balanceMinor = next; charge.refunded = true; charge.refundedAt = now();
        db.put(a, 'wallet', wallet); db.put(a, 'charge', charge, charge.id);
        const refund = { id: randomUUID(), chargeId: charge.id, amountMinor: charge.amountMinor, currency: 'AED', status: 'REFUNDED', reason: body.reason };
        db.put(a, 'transaction', { id: refund.id, type: 'REFUND', amount: major(charge.amountMinor), currency: 'AED', purpose: body.reason, status: 'SETTLED', timestamp: Date.now() }, refund.id);
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
        this.proof(proof, 'rta', `salik:${body.reference}`, minor(body.amount));
        const salik = db.get(a, 'salik'); salik.balance = major(minor(salik.balance) + minor(body.amount));
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
      if (method === 'GET' && path === '/bills') return ok({ bills: [db.get(a, 'bill')] });
      if (method === 'POST' && /^\/bills\/[^/]+\/payments$/.test(path)) return this.payBill(a, path.split('/')[2], body.paymentId, proof);
      if (method === 'POST' && path === '/connections') { if (body.contractNumber !== asset.contractNumber) fail(404, 'NOT_FOUND', 'Tenancy not found.'); const connection = { premiseId: asset.premiseId, status: 'CONNECTED_ACTIVE', depositWaived: true }; db.put(a, 'connection', connection); return ok({ connection }); }
    }
    if (this.provider === 'etisalat' || this.provider === 'du') {
      if (method === 'GET' && path === '/subscriptions') return ok({ subscriptions: db.list(a, 'subscription') });
      const plans = [{ planId: 'home_299', name: 'Home internet 250 Mbps', monthlyAmount: 299, currency: 'AED' }, { planId: 'home_399', name: 'Home internet 500 Mbps', monthlyAmount: 399, currency: 'AED' }];
      if (method === 'GET' && path === '/plans') return ok({ plans });
      if (method === 'GET' && path === '/bills') return ok({ bills: [db.get(a, 'bill')] });
      if (method === 'POST' && /^\/bills\/[^/]+\/payments$/.test(path)) return this.payBill(a, path.split('/')[2], body.paymentId, proof);
      if (method === 'POST' && /^\/subscriptions\/[^/]+\/plan$/.test(path)) {
        const subscription = db.get(a, 'subscription', path.split('/')[2]); const plan = plans.find(p => p.planId === body.planId);
        if (!subscription || !plan) fail(404, 'NOT_FOUND', 'Subscription or plan not found.');
        subscription.planId = plan.planId; subscription.monthlyAmount = plan.monthlyAmount; db.put(a, 'subscription', subscription, subscription.subscriptionId); return ok({ subscription });
      }
    }
    if (this.provider === 'police') {
      const fines = db.list(a, 'fine').filter(f => f.status === 'UNPAID');
      if (method === 'GET' && path === '/fines') return ok({ fines, count: fines.length, totalPayable: major(fines.reduce((sum, f) => sum + minor(f.payableAmount), 0)), totalOriginal: fines.reduce((sum, f) => sum + f.originalAmount, 0), totalDiscount: fines.reduce((sum, f) => sum + f.discountAmount, 0) });
      if (method === 'POST' && path === '/fine-payments') {
        const selected = fines.filter(f => body.fineIds.includes(f.fineId));
        if (selected.length !== body.fineIds.length) fail(404, 'NOT_FOUND', 'Unpaid fines not found.');
        const amount = selected.reduce((sum, f) => sum + minor(f.payableAmount), 0);
        this.proof(proof, 'police', `fines:${[...body.fineIds].sort().join(',')}`, amount);
        for (const fine of selected) db.put(a, 'fine', { ...fine, status: 'PAID', receiptNumber: body.paymentId, paidAt: now() }, fine.fineId);
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
    const bill = this.store.get(account, 'bill');
    if (bill?.billId !== billId) fail(404, 'NOT_FOUND', 'Bill not found.');
    if (bill.status !== 'UNPAID') fail(409, 'ALREADY_PAID', 'Bill is already settled.');
    this.proof(proof, this.provider, `bill:${billId}`, minor(bill.totalAmount));
    bill.status = 'PAID'; bill.receiptNumber = paymentId; bill.paidAt = new Date().toISOString(); this.store.put(account, 'bill', bill);
    return ok({ bill, receipt: { billId, receiptNumber: paymentId, amountPaid: bill.totalAmount.toFixed(2), currency: 'AED' } });
  }
}
