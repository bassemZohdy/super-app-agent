import { hasEffectEvidence, isAuthorityDenial, isPriorEffectCode, isUncertainOutcomeCode } from '../../../packages/backend-kit/src/outcome.ts';
import { boundedJsonResponse } from '../../../packages/backend-kit/src/bounded-json.ts';
import { tracedFetch as fetch,inSpan,routeName } from '../../../packages/backend-kit/src/observability.ts';
import { SERVICE_PORTS } from '../../../packages/backend-kit/src/local-endpoints.ts';
import { actorContext } from '../../../packages/backend-kit/src/context.ts';
import { toMinor } from '../../../packages/protocol-core/src/request-validation.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { executeRideRequest } from '../../service-ride/src/index.ts';
import { executeFoodRequest } from '../../service-food/src/index.ts';
import { executeWalletRequest } from '../../service-wallet/src/index.ts';
import { executeCatalogRequest } from '../../service-catalog/src/index.ts';
import { executeProfileRequest } from '../../service-profile/src/index.ts';

type Result = { status: number; data: any };
type Handler = (method: string, path: string, query?: Record<string, string>, body?: any) => Result;
export type Step = { service: string; method: string; path: string; state: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' };
export type Outcome = 'FAILED' | 'PARTIALLY_COMPLETED' | 'UNKNOWN';
export const domainHandlers: Record<'ride' | 'food' | 'wallet' | 'catalog' | 'profile', Handler> = {
  ride: executeRideRequest, food: executeFoodRequest, wallet: executeWalletRequest,
  catalog: executeCatalogRequest, profile: executeProfileRequest,
};
const context = new AsyncLocalStorage<Step[]>();
export async function trackDomainOperations<T>(steps: Step[], run: () => Promise<T>): Promise<T> {
  return context.run(steps, run);
}
export class DomainOperationError extends Error {
  statusCode: number;
  code: string;
  constructor(status: number, code: string, service: string) {
    super(`The ${service} operation did not complete successfully.`);
    this.name = 'DomainOperationError';
    this.statusCode = status;
    this.code = code;
  }
}
// Minimum fields needed to present a mutation as confirmed. Full output-schema
// conformance remains P1-14; an incomplete write receipt is conservatively UNKNOWN.
const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const named = (value: any) => typeof value === 'string' && value.length > 0;
const finite = (value: any) => typeof value === 'number' && Number.isFinite(value);
// Only mutations with an explicit receipt contract may be dispatched through this adapter.
const writeRoutes: Record<string, ReadonlySet<string>> = {
  wallet: new Set(['/wallet/pay', '/wallet/topup', '/fines/pay', '/pay/unified', '/pay/multi-agency']),
  ride: new Set(['/rides/book', '/mobility/parking/activate', '/mobility/parking/extend', '/mobility/salik/recharge']),
  food: new Set(['/orders/create', '/utilities/pay']),
  catalog: new Set(['/housing/move-in']),
  profile: new Set(['/profile/preferences']),
};
function requireKnownWrite(service: string, method: string, path: string): void {
  if (method.toUpperCase() === 'GET') return;
  if (method.toUpperCase() === 'POST' && (writeRoutes[service]?.has(path) || service === 'telecom' && /^\/telecom\/(?:etisalat|du)\/bills\/[^/]+\/payments$/.test(path))) return;
  throw new DomainOperationError(400, 'DOMAIN_OPERATION_UNSUPPORTED', service);
}
// A mutation is only a definite rejection when the response actually says so. A timeout, an explicitly unknown outcome,
// contradictory success, or an empty/malformed body cannot prove that the provider did not apply the effect.
function definiteRejection(status: number, data: unknown, mutation: boolean): boolean {
  if (status < 400 || status >= 500) return false;
  if (!mutation) return true;
  if (status === 401 || status === 408 || status === 429 || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const payload = data as Record<string, unknown>;
  if (payload.success === true || hasEffectEvidence(payload)) return false;
  if (isAuthorityDenial(status, payload.code) || isUncertainOutcomeCode(payload.code) || isPriorEffectCode(payload.code)) return false;
  return payload.success === false || named(payload.error);
}
function confirmedReceipt(service: string, path: string, data: any, body: unknown): boolean {
  if (service === 'telecom') {
    const match = /^\/telecom\/(?:etisalat|du)\/bills\/([^/]+)\/payments$/.exec(path);
    if (match) {
      let billId: string;
      try { billId = decodeURIComponent(match[1]); } catch { return false; }
      const receipt = data.receipt;
      if (!(record(receipt) && named(billId) && receipt.billId === billId && named(receipt.receiptNumber) &&
        typeof receipt.amountPaid === 'string' && /^(?:0|[1-9]\d*)\.\d{2}$/.test(receipt.amountPaid) && receipt.currency === 'AED')) return false;
      const expected = body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).expectedAmountMinor : undefined;
      if (expected === undefined) return true;
      if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) return false;
      return receipt.amountPaid === `${Math.floor(expected / 100)}.${String(expected % 100).padStart(2, '0')}`;
    }
  }
  if (service === 'wallet') {
    if (path === '/wallet/pay' || path === '/wallet/topup') {
      if (!record(body) || !record(data.transaction)) return false;
      const request = body as { amount?: unknown; referenceId?: unknown }, tx = data.transaction;
      if (!named(tx.id) || tx.type !== (path === '/wallet/pay' ? 'PAYMENT' : 'TOPUP') || tx.currency !== (process.env.PROVIDER_INTEGRATION === 'true' ? 'AED' : 'USD') || tx.status !== 'SETTLED' ||
        typeof request.amount !== 'number' || typeof tx.amount !== 'number') return false;
      try {
        const amount = toMinor(request.amount), balance = toMinor(path === '/wallet/pay' ? data.remainingBalance : data.newBalance);
        if (amount <= 0 || toMinor(tx.amount) !== amount || balance < 0) return false;
        if (process.env.PROVIDER_INTEGRATION === 'true' && path === '/wallet/pay') {
          const actor = actorContext.getStore(), capture = data.charge;
          const reference = request.referenceId === undefined ? actor?.requestId : request.referenceId;
          if (!actor || !record(capture) || !named(reference) || capture.id !== tx.id || capture.accountId !== actor.accountId || capture.amountMinor !== amount || capture.currency !== 'AED' || capture.status !== 'CAPTURED' || capture.refunded !== false || capture.merchant !== 'superapp' || capture.reference !== reference || (request.referenceId !== undefined && (capture.operationId !== actor.requestId || tx.operationId !== actor.requestId)) || capture.source !== 'wallet') return false;
        }
        return true;
      } catch { return false; }
    }
    if (path === '/fines/pay') {
      if (!record(body)) return false;
      const request = body as { fineIds?: unknown; expectedAmountMinor?: unknown; operationId?: unknown };
      if (request.operationId !== undefined && (!named(request.operationId) || data.operationId !== request.operationId)) return false;
      const requested = request.fineIds;
      if (!Array.isArray(requested) || requested.length === 0 || !requested.every(named) || new Set(requested).size !== requested.length ||
        !named(data.receiptNumber) || !finite(data.remainingBalance) || data.finesCleared !== requested.length ||
        !Array.isArray(data.fineIds) || data.fineIds.length !== requested.length ||
        !data.fineIds.every((id: unknown) => named(id) && requested.includes(id)) || new Set(data.fineIds).size !== requested.length) return false;
      let paidMinor: number;
      try { paidMinor = toMinor(data.amountPaid); } catch { return false; }
      return request.expectedAmountMinor === undefined || (typeof request.expectedAmountMinor === 'number' && Number.isSafeInteger(request.expectedAmountMinor) && request.expectedAmountMinor >= 0 && paidMinor === request.expectedAmountMinor);
    }
    if (path === '/pay/unified' || path === '/pay/multi-agency') {
      if (!named(data.govTransactionHash) || !named(data.settlementPlatform) || !record(body)) return false;
      const request = body as { items?: unknown; operationId?: unknown };
      if (request.operationId !== undefined && (!named(request.operationId) || data.operationId !== request.operationId)) return false;
      const items = request.items;
      if (!Array.isArray(items) || items.length === 0) return false;
      try {
        const amounts = items.map(item => {
          if (!record(item)) throw new RangeError('Invalid settlement item');
          return toMinor(item.amount);
        });
        const total = amounts.reduce((sum, amount) => sum + amount, 0);
        return Number.isSafeInteger(total) && total > 0 && toMinor(data.grandTotal) === total && toMinor(data.remainingBalance) >= 0;
      } catch { return false; }
    }
  }
  if (service === 'ride') {
    if (path === '/rides/book') {
      if (!record(body) || !record(data.booking) || !record(data.booking.driver)) return false;
      const request = body as { driverId?: unknown; pickup?: unknown; dropoff?: unknown; expectedFareMinor?: unknown }, booking = data.booking;
      try { if (request.expectedFareMinor !== undefined && (!Number.isSafeInteger(request.expectedFareMinor) || toMinor(booking.fare) !== request.expectedFareMinor)) return false; } catch { return false; }
      return named(request.driverId) && booking.driver.id === request.driverId && named(booking.bookingId) && ['DISPATCHED', 'CONFIRMED'].includes(booking.status) &&
        (request.pickup === undefined || (named(request.pickup) && booking.pickup === request.pickup)) &&
        (request.dropoff === undefined || (named(request.dropoff) && booking.dropoff === request.dropoff));
    }
    if (path === '/mobility/parking/activate' || path === '/mobility/parking/extend') {
      if (!record(body) || !record(data.meter)) return false;
      const request = body as { zoneId?: unknown; plateNumber?: unknown; durationHours?: unknown; ticketId?: unknown; additionalHours?: unknown }, meter = data.meter;
      if (!named(meter.ticketId) || !named(meter.zoneId) || !named(meter.zoneCode) || !named(meter.zoneName) || !named(meter.plateNumber) ||
        meter.status !== 'ACTIVE' || !Number.isSafeInteger(meter.durationHours) || meter.durationHours <= 0 ||
        !Number.isSafeInteger(meter.expiresAt) || meter.expiresAt < 0 || meter.expiresAt > 8640000000000000) return false;
      try { if (typeof meter.totalFee !== 'number' || toMinor(meter.totalFee) < 0) return false; } catch { return false; }
      if (path === '/mobility/parking/activate') return named(request.zoneId) && named(request.plateNumber) &&
        Number.isSafeInteger(request.durationHours) && meter.zoneId === request.zoneId && meter.plateNumber === request.plateNumber && meter.durationHours === request.durationHours;
      return named(request.ticketId) && Number.isSafeInteger(request.additionalHours) && (request.additionalHours as number) > 0 &&
        meter.ticketId === request.ticketId && Number.isSafeInteger(data.previousDurationHours) && data.previousDurationHours > 0 &&
        meter.durationHours === data.previousDurationHours + (request.additionalHours as number);
    }
    if (path === '/mobility/salik/recharge') {
      if (!named(data.transactionId) || !finite(data.newBalance)) return false;
      if (!record(body)) return true;
      const request = body as { expectedTag?: unknown; amount?: unknown; operationId?: unknown };
      if (request.operationId !== undefined && (!named(request.operationId) || data.operationId !== request.operationId)) return false;
      if (request.expectedTag === undefined) return true;
      if (!named(request.expectedTag) || data.tagId !== request.expectedTag || typeof request.amount !== 'number') return false;
      try {
        const expected = toMinor(request.amount);
        return (data.rechargedAmount !== undefined || data.amountRecharged !== undefined) &&
          (data.rechargedAmount === undefined || toMinor(data.rechargedAmount) === expected) &&
          (data.amountRecharged === undefined || toMinor(data.amountRecharged) === expected);
      } catch { return false; }
    }
  }
  if (service === 'food') {
    if (path === '/orders/create') {
      if (!record(body) || !record(data.order)) return false;
      const request = body as { restaurantId?: unknown; items?: unknown; deliveryAddress?: unknown; expectedAmountMinor?: unknown; expectedItemPriceMinor?: unknown; expectedDeliveryFeeMinor?: unknown }, order = data.order;
      if (!named(request.restaurantId) || order.restaurantId !== request.restaurantId || !named(order.orderId) ||
        !['ACCEPTED_BY_KITCHEN', 'CONFIRMED'].includes(order.status) || !Array.isArray(request.items) || request.items.length === 0 ||
        !request.items.every(named) || !Array.isArray(order.items) ||
        (request.deliveryAddress !== undefined && (!named(request.deliveryAddress) || order.deliveryAddress !== request.deliveryAddress))) return false;
      const counts = new Map<string, number>();
      for (const id of request.items) counts.set(id, (counts.get(id) ?? 0) + 1);
      let singleItemPrice: number | undefined;
      for (const line of order.items) {
        if (!record(line)) return false;
        if (!record(line.item) && Object.hasOwn(line, 'quantity')) return false;
        const item = record(line.item) ? line.item : line;
        const quantity = record(line.item) ? line.quantity : 1;
        if (!named(item.id) || !Number.isSafeInteger(quantity) || quantity <= 0) return false;
        if (order.items.length === 1 && quantity === 1 && typeof item.price === 'number') singleItemPrice = item.price;
        const remaining = (counts.get(item.id) ?? 0) - quantity;
        if (remaining < 0) return false;
        counts.set(item.id, remaining);
      }
      try {
        const total = toMinor(order.totalAmount);
        if (request.expectedItemPriceMinor !== undefined || request.expectedDeliveryFeeMinor !== undefined) {
          if (!Number.isSafeInteger(request.expectedItemPriceMinor) || !Number.isSafeInteger(request.expectedDeliveryFeeMinor) || singleItemPrice === undefined || toMinor(singleItemPrice) !== request.expectedItemPriceMinor || total - toMinor(singleItemPrice) !== request.expectedDeliveryFeeMinor) return false;
        }
        return [...counts.values()].every(count => count === 0) && total >= 0 && (request.expectedAmountMinor === undefined || Number.isSafeInteger(request.expectedAmountMinor) && total === request.expectedAmountMinor);
      }
      catch { return false; }
    }
    if (path === '/utilities/pay') {
      if (!record(body) || !record(data.receipt)) return false;
      const request = body as { billId?: unknown; expectedAmountMinor?: unknown; operationId?: unknown }, receipt = data.receipt;
      if (request.operationId !== undefined && (!named(request.operationId) || data.operationId !== request.operationId)) return false;
      if (!named(request.billId) || receipt.billId !== request.billId || !named(receipt.receiptNumber) || typeof receipt.amountPaid !== 'string') return false;
      const amount = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?( AED)?$/.exec(receipt.amountPaid);
      if (!amount || (amount[3] ? receipt.currency !== undefined && receipt.currency !== 'AED' : receipt.currency !== 'AED')) return false;
      let paidMinor: number;
      try { paidMinor = toMinor(Number(amount[1] + (amount[2] ? `.${amount[2]}` : ''))); } catch { return false; }
      return request.expectedAmountMinor === undefined || (typeof request.expectedAmountMinor === 'number' && Number.isSafeInteger(request.expectedAmountMinor) && request.expectedAmountMinor >= 0 && paidMinor === request.expectedAmountMinor);
    }
  }
  if (service === 'catalog' && path === '/housing/move-in') {
    if (!record(body)) return false;
    const request = body as { contractNumber?: unknown; expectedPremiseId?: unknown };
    return named(request.contractNumber) && data.ejariContract === request.contractNumber && named(data.unit) &&
      record(data.dewaConnected) && named(data.dewaConnected.premiseId) && data.dewaConnected.status === 'CONNECTED_ACTIVE' &&
      data.dewaConnected.depositWaived === true && (request.expectedPremiseId === undefined || (named(request.expectedPremiseId) && data.dewaConnected.premiseId === request.expectedPremiseId)) && record(data.residentialParking) &&
      named(data.residentialParking.permitNumber) && data.residentialParking.status === 'ISSUED';
  }
  if (service === 'profile' && path === '/profile/preferences') return record(data.preferences) && named(data.promptContext);
  return false;
}
export function callDomain(service: keyof typeof domainHandlers, method: string, path: string,
  query: Record<string, string> = {}, body: any = {}): Result {
  requireKnownWrite(service, method, path);
  const mutation = method.toUpperCase() !== 'GET';
  const step: Step | undefined = mutation ? { service, method, path, state: 'PENDING' } : undefined;
  if (step) context.getStore()?.push(step);
  let result: Result;
  try { result = domainHandlers[service](method, path, query, body); }
  catch {
    if (step) step.state = 'UNKNOWN';
    throw new DomainOperationError(503, mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE', service);
  }
  const valid = result && Number.isInteger(result.status) && result.data && typeof result.data === 'object';
  const succeeded = valid && result.status >= 200 && result.status < 300 &&
    result.data.success === true && !Object.hasOwn(result.data, 'error') &&
    (!mutation || confirmedReceipt(service, path, result.data, body));
  if (succeeded) {
    if (step) step.state = 'SUCCEEDED';
    return result;
  }
  const rejected = valid && definiteRejection(result.status, result.data, mutation);
  if (step) step.state = rejected ? 'FAILED' : 'UNKNOWN';
  const code = rejected ? (['VALIDATION_ERROR', 'PROFILE_REVISION_CHANGED'].includes(result.data.code) ? result.data.code : 'DOMAIN_REJECTED')
    : mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE';
  throw new DomainOperationError(rejected ? result.status : 503, code, service);
}
export function executionOutcome(steps: Step[]): Outcome {
  return steps.some(step => step.state === 'UNKNOWN' || step.state === 'PENDING') ? 'UNKNOWN'
    : steps.some(step => step.state === 'SUCCEEDED') ? 'PARTIALLY_COMPLETED' : 'FAILED';
}


/** HTTP transport is explicit; provider mode never silently falls back to shared fixtures. */
async function callDomainRequest(service: keyof typeof domainHandlers | 'telecom', method: string, path: string,
  query: Record<string, string> = {}, body: any = {}): Promise<Result> {
  if (process.env.DOMAIN_TRANSPORT !== 'http') {
    if (process.env.PROVIDER_INTEGRATION === 'true') throw new DomainOperationError(503, 'DOMAIN_TRANSPORT_MISCONFIGURED', service);
    if (service === 'telecom') throw new DomainOperationError(503, 'DOMAIN_UNAVAILABLE', service);
    return callDomain(service, method, path, query, body);
  }
  const actor = actorContext.getStore();
  if (!actor?.authorization) throw new DomainOperationError(401, 'AUTHENTICATION_REQUIRED', service);
  // Domain routes are root-relative; an absolute, network-path or backslash URL can replace the configured service origin.
  if (!/^\/(?!\/)/.test(path) || /[\\?#\x00-\x1f\x7f]/.test(path)) throw new DomainOperationError(400, 'DOMAIN_PATH_INVALID', service);
  const ports = SERVICE_PORTS;
  const base = process.env[`SERVICE_${service.toUpperCase()}_URL`] || `http://localhost:${ports[service]}`;
  let origin: URL, url: URL;
  try { origin = new URL(base); url = new URL(path, origin); }
  catch { throw new DomainOperationError(503, 'DOMAIN_TRANSPORT_MISCONFIGURED', service); }
  if (url.origin !== origin.origin) throw new DomainOperationError(400, 'DOMAIN_PATH_INVALID', service);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  requireKnownWrite(service, method, path);
  const mutation = method.toUpperCase() !== 'GET';
  if (mutation) await actor.assertLease?.();
  const step: Step | undefined = mutation ? { service, method, path, state: 'PENDING' } : undefined;
  if (step) context.getStore()?.push(step);
  let result: Result;
  try {
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: actor.authorization, 'Content-Type': 'application/json', 'X-Account-Id': actor.accountId, 'X-Request-Id': actor.requestId, 'X-Operation-Id': actor.requestId, ...(mutation && actor.eligibilityEpoch ? { 'X-Eligibility-Epoch': actor.eligibilityEpoch } : {}) },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
    });
    result = { status: response.status, data: await boundedJsonResponse(response) };
  } catch {
    if (step) step.state = 'UNKNOWN';
    throw new DomainOperationError(503, mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE', service);
  }
  const succeeded = result.status >= 200 && result.status < 300 && result.data?.success === true && !Object.hasOwn(result.data, 'error') &&
    (!mutation || confirmedReceipt(service, path, result.data, body));
  if (succeeded) { if (step) step.state = 'SUCCEEDED'; return result; }
  const rejected = definiteRejection(result.status, result.data, mutation);
  if (step) step.state = rejected ? 'FAILED' : 'UNKNOWN';
  throw new DomainOperationError(rejected ? result.status : 503, rejected ? (result.data?.code === 'PROFILE_REVISION_CHANGED' ? 'PROFILE_REVISION_CHANGED' : 'DOMAIN_REJECTED') : mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE', service);
}

/** One tool span per domain operation; IDs carry provenance, never authority. */
export async function callDomainAsync(...args:Parameters<typeof callDomainRequest>):Promise<Result>{return inSpan(`DOMAIN ${args[0]} ${routeName(args[2])}`,'tool',()=>callDomainRequest(...args),r=>r.status);}
