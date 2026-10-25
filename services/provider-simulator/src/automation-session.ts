/** What an admitted per-execution token may still call while the existing checkout chain finishes
 *  its own order. The allowlist is exact: one payable, its admission and settlement, and (at the
 *  gateway) the one order and charge of that execution. Everything else stays denied. */
import type { ProviderId } from './contracts.ts';

export type SessionOperation = { accountId: string; payableId: string; executionId: string };
export function sessionAllows(provider: ProviderId, accountId: string, method: string, path: string, op: SessionOperation,
  gateway?: () => { orderId: string; paymentId?: string } | undefined): boolean {
  if (accountId !== op.accountId) return false;
  if (provider === 'payments') {
    const known = gateway?.();
    if (!known || method !== 'GET') return false;
    const order = /^\/payment-orders\/([^/]+)$/.exec(path), charge = /^\/charges\/([^/]+)$/.exec(path);
    return !!order && decodeURIComponent(order[1]) === known.orderId || !!charge && !!known.paymentId && decodeURIComponent(charge[1]) === known.paymentId;
  }
  const match = /^\/payables\/([^/]+)(?:\/admissions(?:\/[^/]+(?:\/(admit|payments|finish|cancel))?)?)?$/.exec(path);
  if (!match || decodeURIComponent(match[1]) !== op.payableId) return false;
  if (method === 'GET') return true;
  // POST: open the admission (the collection itself) or act on one of its steps.
  return method === 'POST' && (/\/admissions$/.test(path) || match[2] !== undefined);
}
