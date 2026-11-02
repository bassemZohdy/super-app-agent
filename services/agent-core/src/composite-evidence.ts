import { toMinor, validateRequest } from '../../../packages/protocol-core/src/request-validation.ts';

type Source = 'wallet' | 'ride' | 'food';
type Assessment = { step: 'WALLET' | 'RIDE' | 'FOOD'; assessment: 'MATCH' | 'UNCONFIRMED' };
type Attempt = { operationId: string; terms: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const unconfirmed = (): Assessment[] => ['WALLET', 'RIDE', 'FOOD'].map(step => ({ step: step as Assessment['step'], assessment: 'UNCONFIRMED' }));

/** Compare read-only provider evidence with the saved review; a missing result never proves non-application. */
export async function compareCompositeEvidence(attempt: Attempt, accountId: string, read: (source: Source) => Promise<unknown>): Promise<Assessment[]> {
  const suffix = ':confirm_composite_checkout';
  const revision = typeof attempt?.operationId === 'string' && attempt.operationId.endsWith(suffix) ? attempt.operationId.slice(0, -suffix.length) : '';
  const terms = attempt?.terms;
  if (!record(terms) || terms.currency !== 'AED' || !named(accountId) || !/^[a-f0-9-]{36}$/.test(revision) ||
    validateRequest('agent-core', 'POST', '/api/a2ui/action', {}, { sessionId: 'composite_inspection', surfaceRevision: revision, action: 'confirm_composite_checkout', payload: terms }) ||
    typeof terms.rideAmountMinor !== 'number' || typeof terms.itemAmountMinor !== 'number' || typeof terms.deliveryFeeMinor !== 'number' || typeof terms.mealAmountMinor !== 'number' || typeof terms.amountMinor !== 'number' ||
    terms.itemAmountMinor + terms.deliveryFeeMinor !== terms.mealAmountMinor || terms.rideAmountMinor + terms.mealAmountMinor !== terms.amountMinor) return unconfirmed();
  const sources: Source[] = ['wallet', 'ride', 'food'];
  const values = await Promise.all(sources.map(source => Promise.resolve().then(() => read(source)).catch(() => undefined)));
  const assessments = unconfirmed();
  try {
    const body = record(values[0]) ? values[0] : undefined, charge = body && record(body.charge) ? body.charge : undefined, tx = body && record(body.transaction) ? body.transaction : undefined;
    if (body?.success === true && !Object.hasOwn(body, 'error') && body.operationId === attempt.operationId && charge && tx && named(charge.id) && charge.accountId === accountId && charge.amountMinor === terms.amountMinor && charge.currency === 'AED' && charge.merchant === 'superapp' && charge.reference === attempt.operationId && (!Object.hasOwn(charge, 'operationId') || charge.operationId === attempt.operationId) && charge.source === 'wallet' && charge.status === 'CAPTURED' && charge.refunded === false && tx.id === charge.id && tx.type === 'PAYMENT' && tx.currency === 'AED' && tx.status === 'SETTLED' && tx.referenceId === attempt.operationId && tx.purpose === attempt.operationId && (!Object.hasOwn(tx, 'operationId') || tx.operationId === attempt.operationId) && typeof tx.amount === 'number' && toMinor(tx.amount) === terms.amountMinor) assessments[0].assessment = 'MATCH';
  } catch { /* Invalid evidence remains unconfirmed. */ }
  try {
    const body = record(values[1]) ? values[1] : undefined, booking = body && record(body.booking) ? body.booking : undefined, driver = booking && record(booking.driver) ? booking.driver : undefined;
    if (body?.success === true && !Object.hasOwn(body, 'error') && body.operationId === attempt.operationId && booking && named(booking.bookingId) && booking.status === 'CONFIRMED' && driver?.id === terms.driverId && booking.dropoff === terms.dropoff && typeof booking.fare === 'number' && toMinor(booking.fare) === terms.rideAmountMinor) assessments[1].assessment = 'MATCH';
  } catch { /* Invalid evidence remains unconfirmed. */ }
  try {
    const body = record(values[2]) ? values[2] : undefined, order = body && record(body.order) ? body.order : undefined;
    const item = order && Array.isArray(order.items) && order.items.length === 1 && record(order.items[0]) ? order.items[0] : undefined;
    if (body?.success === true && !Object.hasOwn(body, 'error') && body.operationId === attempt.operationId && order && named(order.orderId) && order.status === 'CONFIRMED' && order.restaurantId === terms.restaurantId && order.deliveryAddress === terms.dropoff && item && item.id === terms.itemId && typeof item.price === 'number' && toMinor(item.price) === terms.itemAmountMinor && typeof order.totalAmount === 'number' && toMinor(order.totalAmount) === terms.mealAmountMinor && toMinor(order.totalAmount) - toMinor(item.price) === terms.deliveryFeeMinor) assessments[2].assessment = 'MATCH';
  } catch { /* Invalid evidence remains unconfirmed. */ }
  return assessments;
}
