/**
 * Read-only inspection of one payment order (SIM-06).
 *
 * The inspector never mutates state. It reports the order, the ledger and card
 * balances, the settlement claim and concrete mismatch reasons, so an operator
 * can explain a failpoint or recovery without an unrestricted balance control.
 */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { PaymentLedger } from './payment-ledger.ts';
import type { PaymentIssuer } from './payment-issuer.ts';
import type { PaymentClaims } from './payment-claims.ts';

export interface OrderInspection {
  order: { id: string; state: string; fundsCaptured: boolean; failureCode?: string; paymentId?: string; admissionId?: string };
  ledger: { balanceMinor: number };
  card: { spentMinor: number; heldMinor: number } | null;
  claim: { state: string } | null;
  mismatches: string[];
}

export interface InspectorDependencies {
  orders: PaymentOrders;
  ledger: PaymentLedger;
  issuer?: PaymentIssuer;
  claims?: PaymentClaims;
}

const TERMINAL = ['SETTLED', 'FAILED', 'CANCELLED'];

/** Build a read-only explanation of one order. `card` is null when the order was funded from the wallet. */
export function inspectOrder(deps: InspectorDependencies, actor: Actor, orderId: string): OrderInspection {
  const order = deps.orders.get(actor, orderId);
  const methodId = order.quote?.source?.id;
  const isCard = Boolean(methodId) && methodId !== 'wallet';
  const card = isCard && deps.issuer ? deps.issuer.summary(actor.accountId, methodId as string) : null;
  const claim = order.paymentId && deps.claims ? deps.claims.get(actor.accountId, order.paymentId) ?? null : null;
  const ledger = { balanceMinor: deps.ledger.summary(actor.accountId).balanceMinor };
  const mismatches: string[] = [];

  if (order.state === 'CAPTURING' && !order.fundsCaptured) {
    mismatches.push('UNKNOWN_BEFORE_CAPTURE: no funds captured; recovery must reuse the original order, not a new charge');
  }
  if (order.state === 'RECONCILIATION_REQUIRED') {
    mismatches.push(`CAPTURE_COMMITTED_SETTLEMENT_PENDING: ${order.failureCode ?? 'PROVIDER_OUTCOME_UNKNOWN'}; run recovery on the original order`);
  }
  if (order.fundsCaptured && order.paymentId && !claim) {
    mismatches.push('CAPTURED_WITHOUT_SETTLEMENT_CLAIM: captured funds have no provider settlement claim');
  }
  if (card && card.heldMinor > 0 && TERMINAL.includes(order.state)) {
    mismatches.push('HOLD_NOT_RELEASED: a terminal order still holds card funds');
  }

  return {
    order: {
      id: order.id,
      state: order.state,
      fundsCaptured: Boolean(order.fundsCaptured),
      ...(order.failureCode ? { failureCode: order.failureCode } : {}),
      ...(order.paymentId ? { paymentId: order.paymentId } : {}),
      ...(order.admissionId ? { admissionId: order.admissionId } : {}),
    },
    ledger,
    card: card ? { spentMinor: card.spentMinor, heldMinor: card.heldMinor } : null,
    claim: claim ? { state: claim.state } : null,
    mismatches,
  };
}
