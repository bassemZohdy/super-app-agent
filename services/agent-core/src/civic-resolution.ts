type Step = { readonly name: string; readonly state: string; readonly receiptReference?: string };
type Review = { readonly billAmountMinor: number; readonly fines: readonly unknown[] };

/** A partial, unknown, reordered or unreferenced checkout cannot be acknowledged as complete. */
export function completeCivicSteps(review: Review, steps: readonly Step[]): boolean {
  const expected = ['WALLET', ...(review.billAmountMinor > 0 ? ['UTILITY'] : []), ...(review.fines.length ? ['FINES'] : []), 'TOLL'];
  return steps.length === expected.length && steps.every((step, index) => step.name === expected[index] && step.state === 'CONFIRMED' && typeof step.receiptReference === 'string' && !!step.receiptReference);
}
