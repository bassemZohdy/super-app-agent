/** Codes signalling an unresolved business effect are never proof that a write was rejected. */
export function isUncertainOutcomeCode(code: unknown): boolean {
  return typeof code === 'string' && (code === 'UNKNOWN' || code.endsWith('_UNKNOWN') ||
    code === 'RECONCILIATION_REQUIRED' || code.endsWith('_RECONCILIATION_REQUIRED') ||
    code === 'NOT_CONFIRMED' || code.endsWith('_NOT_CONFIRMED'));
}
