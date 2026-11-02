import { toMinor } from '../../../packages/protocol-core/src/request-validation.ts';

type Name = 'WALLET' | 'UTILITY' | 'FINES' | 'TOLL';
type Step = { readonly name: Name; readonly state: string; readonly receiptReference?: string };
type Review = { readonly billId: string; readonly billAmountMinor: number; readonly tagNumber: string; readonly fines: ReadonlyArray<{ readonly amountMinor: number }>; readonly tollAmountMinor: number };
type Assessment = { name: Name; assessment: 'MATCH' | 'UNVERIFIABLE' | 'UNAVAILABLE' };
type Source = 'wallet' | 'food' | 'ride';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Compares independent fixture reads without interpreting missing evidence as proof of no effect. */
export async function compareCivicEvidence(review: Review, steps: readonly Step[], read: (source: Source, reference?: string) => Promise<unknown>): Promise<Assessment[]> {
  const cache = new Map<Source, Promise<{ value?: unknown; unavailable: boolean }>>();
  const source = (name: Source, reference?: string) => {
    let pending = cache.get(name);
    if (!pending) { pending = Promise.resolve().then(() => read(name, reference)).then(value => ({ value, unavailable: false }), () => ({ unavailable: true })); cache.set(name, pending); }
    return pending;
  };
  const evidence: Assessment[] = [];
  for (const step of steps) {
    if (step.state !== 'CONFIRMED' || !step.receiptReference) { evidence.push({ name: step.name, assessment: 'UNVERIFIABLE' }); continue; }
    const result = await source(step.name === 'UTILITY' ? 'food' : step.name === 'TOLL' ? 'ride' : 'wallet', step.receiptReference);
    if (result.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
    let matched = false;
    try {
      if (isRecord(result.value) && step.name === 'TOLL' && isRecord(result.value.recharge)) {
        const recharge = result.value.recharge;
        matched = recharge.transactionId === step.receiptReference && recharge.tagId === review.tagNumber && recharge.amountMinor === review.tollAmountMinor && recharge.currency === 'AED';
      } else if (isRecord(result.value) && step.name === 'UTILITY' && isRecord(result.value.bill)) {
        const bill = result.value.bill;
        matched = bill.billId === review.billId && bill.receiptNumber === step.receiptReference && bill.status === 'PAID' && bill.currency === 'AED' && typeof bill.totalAmount === 'number' && toMinor(bill.totalAmount) === review.billAmountMinor;
      } else if (isRecord(result.value) && Array.isArray(result.value.transactions)) {
        const matches = result.value.transactions.filter((transaction: unknown) => isRecord(transaction) && transaction.id === step.receiptReference);
        const transaction = matches.length === 1 && isRecord(matches[0]) ? matches[0] : undefined;
        const expected = step.name === 'WALLET' ? review.billAmountMinor + review.tollAmountMinor : review.fines.reduce((sum, fine) => sum + fine.amountMinor, 0);
        matched = Number.isSafeInteger(expected) && !!transaction && transaction.type === 'PAYMENT' && transaction.status === 'SETTLED' && transaction.currency === 'AED' && typeof transaction.amount === 'number' && toMinor(transaction.amount) === expected;
      }
    } catch { matched = false; }
    evidence.push({ name: step.name, assessment: matched ? 'MATCH' : 'UNVERIFIABLE' });
  }
  return evidence;
}
