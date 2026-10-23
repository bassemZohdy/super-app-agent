import { actorContext } from '../../../packages/backend-kit/src/context.ts';
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
function confirmedReceipt(service: string, path: string, data: any): boolean {
  if (service === 'wallet') {
    if (path === '/wallet/pay') return record(data.transaction) && named(data.transaction.id) && finite(data.remainingBalance);
    if (path === '/wallet/topup') return record(data.transaction) && named(data.transaction.id) && finite(data.newBalance);
    if (path === '/fines/pay') return named(data.receiptNumber) && finite(data.amountPaid) && finite(data.remainingBalance) && Number.isInteger(data.finesCleared);
    if (path === '/pay/unified') return named(data.govTransactionHash) && named(data.settlementPlatform) && finite(data.grandTotal) && finite(data.remainingBalance);
  }
  if (service === 'ride') {
    if (path === '/rides/book') return record(data.booking) && named(data.booking.bookingId) && named(data.booking.status);
    if (path.startsWith('/mobility/parking/')) return record(data.meter) && named(data.meter.ticketId) && finite(data.meter.durationHours) && finite(data.meter.totalFee);
    if (path === '/mobility/salik/recharge') return named(data.transactionId) && finite(data.newBalance);
  }
  if (service === 'food') {
    if (path === '/orders/create') return record(data.order) && named(data.order.orderId) && finite(data.order.totalAmount);
    if (path === '/utilities/pay') return record(data.receipt) && named(data.receipt.billId) && named(data.receipt.receiptNumber) && named(data.receipt.amountPaid);
  }
  if (service === 'catalog' && path === '/housing/move-in') return named(data.ejariContract) && named(data.unit) && record(data.residentialParking) && named(data.residentialParking.permitNumber);
  if (service === 'profile' && path === '/profile/preferences') return record(data.preferences) && named(data.promptContext);
  return true;
}
export function callDomain(service: keyof typeof domainHandlers, method: string, path: string,
  query: Record<string, string> = {}, body: any = {}): Result {
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
    (!mutation || confirmedReceipt(service, path, result.data));
  if (succeeded) {
    if (step) step.state = 'SUCCEEDED';
    return result;
  }
  const rejected = valid && result.status >= 400 && result.status < 500;
  if (step) step.state = rejected ? 'FAILED' : 'UNKNOWN';
  const code = rejected ? (result.data.code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR' : 'DOMAIN_REJECTED')
    : mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE';
  throw new DomainOperationError(rejected ? result.status : 503, code, service);
}
export function executionOutcome(steps: Step[]): Outcome {
  return steps.some(step => step.state === 'UNKNOWN' || step.state === 'PENDING') ? 'UNKNOWN'
    : steps.some(step => step.state === 'SUCCEEDED') ? 'PARTIALLY_COMPLETED' : 'FAILED';
}


/** HTTP transport is explicit; provider mode never silently falls back to shared fixtures. */
export async function callDomainAsync(service: keyof typeof domainHandlers | 'telecom', method: string, path: string,
  query: Record<string, string> = {}, body: any = {}): Promise<Result> {
  if (process.env.DOMAIN_TRANSPORT !== 'http') {
    if (process.env.PROVIDER_INTEGRATION === 'true') throw new DomainOperationError(503, 'DOMAIN_TRANSPORT_MISCONFIGURED', service);
    if (service === 'telecom') throw new DomainOperationError(503, 'DOMAIN_UNAVAILABLE', service);
    return callDomain(service, method, path, query, body);
  }
  const actor = actorContext.getStore();
  if (!actor?.authorization) throw new DomainOperationError(401, 'AUTHENTICATION_REQUIRED', service);
  const mutation = method.toUpperCase() !== 'GET';
  if (mutation) await actor.assertLease?.();
  const step: Step | undefined = mutation ? { service, method, path, state: 'PENDING' } : undefined;
  if (step) context.getStore()?.push(step);
  const ports = { ride: 4001, food: 4002, wallet: 4003, catalog: 4004, profile: 4005, telecom: 4006 };
  const base = process.env[`SERVICE_${service.toUpperCase()}_URL`] || `http://localhost:${ports[service]}`;
  const url = new URL(path, base); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let result: Result;
  try {
    const response = await fetch(url, { method, signal: AbortSignal.timeout(60000),
      headers: { Authorization: actor.authorization, 'Content-Type': 'application/json', 'X-Account-Id': actor.accountId, 'X-Request-Id': actor.requestId },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
    });
    result = { status: response.status, data: await response.json() };
  } catch {
    if (step) step.state = 'UNKNOWN';
    throw new DomainOperationError(503, mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE', service);
  }
  const succeeded = result.status >= 200 && result.status < 300 && result.data?.success === true && !result.data.error &&
    (!mutation || confirmedReceipt(service, path, result.data));
  if (succeeded) { if (step) step.state = 'SUCCEEDED'; return result; }
  const rejected = result.status >= 400 && result.status < 500 && result.data?.code !== 'PROVIDER_OUTCOME_UNKNOWN';
  if (step) step.state = rejected ? 'FAILED' : 'UNKNOWN';
  throw new DomainOperationError(rejected ? result.status : 503, rejected ? 'DOMAIN_REJECTED' : mutation ? 'DOMAIN_OUTCOME_UNKNOWN' : 'DOMAIN_UNAVAILABLE', service);
}
