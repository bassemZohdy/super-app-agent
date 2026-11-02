import { toMinor } from '../../../packages/protocol-core/src/request-validation.ts';

type Name = 'WALLET' | 'UTILITY' | 'FINES' | 'TOLL';
type Step = { readonly name: Name; readonly state: string; readonly receiptReference?: string; readonly operationId?: string };
type Review = { readonly billId: string; readonly billAmountMinor: number; readonly tagNumber: string; readonly fines: ReadonlyArray<{ readonly fineId: string; readonly amountMinor: number }>; readonly tollAmountMinor: number };
type Assessment = { name: Name; assessment: 'MATCH' | 'OBSERVED' | 'UNVERIFIABLE' | 'UNAVAILABLE'; observedReceiptReference?: string };
type Source = 'wallet' | 'food' | 'ride' | 'fine-receipt' | 'wallet-operation' | 'utility-operation' | 'fine-operation' | 'toll-operation';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function fineOperationMatches(value: unknown, operationId: string, reference: string, review: Review): boolean {
  const operation = isRecord(value) && isRecord(value.operation) ? value.operation : undefined;
  const fines = operation && Array.isArray(operation.fines) ? operation.fines : [];
  const ids = new Set(fines.map((fine: unknown) => isRecord(fine) ? fine.fineId : undefined));
  return !!operation && operation.operationId === operationId && operation.status === 'SETTLED' && operation.receiptReference === reference &&
    fines.length > 0 && fines.length === review.fines.length && ids.size === fines.length && review.fines.every(expected =>
      fines.some((fine: unknown) => isRecord(fine) && fine.fineId === expected.fineId && fine.amountMinor === expected.amountMinor));
}

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
    if (step.name === 'TOLL' && ['STARTED', 'UNKNOWN'].includes(step.state) && step.operationId) {
      const lookup = await source('toll-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      const reference = operation?.receiptReference;
      if (typeof reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(reference) || !operation || operation.operationId !== step.operationId || operation.status !== 'SETTLED' || operation.tagId !== review.tagNumber || operation.amountMinor !== review.tollAmountMinor) { evidence.push({ name: step.name, assessment: 'UNVERIFIABLE' }); continue; }
      const verified = await compareCivicEvidence(review, [{ ...step, state: 'CONFIRMED', receiptReference: reference }], read);
      evidence.push(verified[0].assessment === 'MATCH' ? { name: step.name, assessment: 'OBSERVED', observedReceiptReference: reference } : { name: step.name, assessment: verified[0].assessment });
      continue;
    }
    if (step.name === 'FINES' && ['STARTED', 'UNKNOWN'].includes(step.state) && step.operationId) {
      const lookup = await source('fine-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      const reference = operation?.receiptReference;
      if (typeof reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(reference) || !fineOperationMatches(body, step.operationId, reference, review)) { evidence.push({ name: step.name, assessment: 'UNVERIFIABLE' }); continue; }
      const verified = await compareCivicEvidence(review, [{ ...step, state: 'CONFIRMED', receiptReference: reference }], read);
      evidence.push(verified[0].assessment === 'MATCH' ? { name: step.name, assessment: 'OBSERVED', observedReceiptReference: reference } : { name: step.name, assessment: verified[0].assessment });
      continue;
    }
    if (step.name === 'UTILITY' && ['STARTED', 'UNKNOWN'].includes(step.state) && step.operationId) {
      const lookup = await source('utility-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      const valid = !!operation && operation.operationId === step.operationId && operation.status === 'SETTLED' && operation.billId === review.billId && operation.amountMinor === review.billAmountMinor && typeof operation.receiptReference === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operation.receiptReference);
      if (!valid || !operation || typeof operation.receiptReference !== 'string') { evidence.push({ name: step.name, assessment: 'UNVERIFIABLE' }); continue; }
      const snapshot = await source('food');
      if (snapshot.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const bill = isRecord(snapshot.value) && isRecord(snapshot.value.bill) ? snapshot.value.bill : undefined;
      let matched = false;
      try { matched = !!bill && bill.billId === review.billId && bill.receiptNumber === operation.receiptReference && bill.status === 'PAID' && bill.currency === 'AED' && typeof bill.totalAmount === 'number' && toMinor(bill.totalAmount) === review.billAmountMinor; } catch { matched = false; }
      evidence.push(matched ? { name: step.name, assessment: 'OBSERVED', observedReceiptReference: operation.receiptReference } : { name: step.name, assessment: 'UNVERIFIABLE' });
      continue;
    }
    if (step.name === 'WALLET' && ['STARTED', 'UNKNOWN'].includes(step.state) && step.operationId) {
      const lookup = await source('wallet-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      const items = operation && Array.isArray(operation.items) ? operation.items : [];
      const expectedItems = [...(review.billAmountMinor ? [{ agency: 'DEWA', purpose: 'Demo utility settlement', amountMinor: review.billAmountMinor }] : []), { agency: 'RTA Salik', purpose: 'Demo toll recharge', amountMinor: review.tollAmountMinor }];
      let valid = !!operation && operation.operationId === step.operationId && operation.status === 'SETTLED' && typeof operation.receiptReference === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operation.receiptReference) && items.length === expectedItems.length;
      try { valid = valid && items.every((item: unknown, index: number) => isRecord(item) && item.agency === expectedItems[index].agency && item.purpose === expectedItems[index].purpose && typeof item.amount === 'number' && toMinor(item.amount) === expectedItems[index].amountMinor); } catch { valid = false; }
      if (!valid || !operation || typeof operation.receiptReference !== 'string') { evidence.push({ name: step.name, assessment: 'UNVERIFIABLE' }); continue; }
      const ledger = await source('wallet');
      if (ledger.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const rows = isRecord(ledger.value) && Array.isArray(ledger.value.transactions) ? ledger.value.transactions.filter((row: unknown) => isRecord(row) && row.id === operation.receiptReference) : [];
      const row = rows.length === 1 && isRecord(rows[0]) ? rows[0] : undefined;
      try { valid = !!row && row.operationId === step.operationId && row.type === 'PAYMENT' && row.status === 'SETTLED' && row.currency === 'AED' && typeof row.amount === 'number' && toMinor(row.amount) === review.billAmountMinor + review.tollAmountMinor; } catch { valid = false; }
      evidence.push(valid ? { name: step.name, assessment: 'OBSERVED', observedReceiptReference: operation.receiptReference } : { name: step.name, assessment: 'UNVERIFIABLE' });
      continue;
    }
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
        matched = Number.isSafeInteger(expected) && !!transaction && (!step.operationId || transaction.operationId === step.operationId) && transaction.type === 'PAYMENT' && transaction.status === 'SETTLED' && transaction.currency === 'AED' && typeof transaction.amount === 'number' && toMinor(transaction.amount) === expected;
      }
    } catch { matched = false; }
    if (matched && step.name === 'TOLL' && step.operationId) {
      const lookup = await source('toll-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      matched = !!operation && operation.operationId === step.operationId && operation.status === 'SETTLED' && operation.tagId === review.tagNumber && operation.amountMinor === review.tollAmountMinor && operation.receiptReference === step.receiptReference;
    }
    if (matched && step.name === 'UTILITY' && step.operationId) {
      const lookup = await source('utility-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = lookup.value, operation = isRecord(body) && isRecord(body.operation) ? body.operation : undefined;
      matched = !!operation && operation.operationId === step.operationId && operation.status === 'SETTLED' && operation.billId === review.billId && operation.amountMinor === review.billAmountMinor && operation.receiptReference === step.receiptReference;
    }
    if (matched && step.name === 'FINES' && step.operationId) {
      const lookup = await source('fine-operation', step.operationId);
      if (lookup.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      matched = fineOperationMatches(lookup.value, step.operationId, step.receiptReference, review);
    }
    if (matched && step.name === 'FINES') {
      const receiptResult = await source('fine-receipt', step.receiptReference);
      if (receiptResult.unavailable) { evidence.push({ name: step.name, assessment: 'UNAVAILABLE' }); continue; }
      const body = receiptResult.value, receipt = isRecord(body) && isRecord(body.receipt) ? body.receipt : undefined;
      const fines = receipt && Array.isArray(receipt.fines) ? receipt.fines : [];
      const ids = new Set(fines.map((fine: unknown) => isRecord(fine) ? fine.fineId : undefined));
      matched = !!receipt && receipt.receiptNumber === step.receiptReference && receipt.currency === 'AED' &&
        fines.length > 0 && fines.length === review.fines.length && ids.size === fines.length && review.fines.every(expected =>
          fines.some((fine: unknown) => isRecord(fine) && fine.fineId === expected.fineId && fine.amountMinor === expected.amountMinor));
    }
    evidence.push({ name: step.name, assessment: matched ? 'MATCH' : 'UNVERIFIABLE' });
  }
  return evidence;
}
