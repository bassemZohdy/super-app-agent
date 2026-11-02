/** Codes signalling an unresolved business effect are never proof that a write was rejected. */
export function isUncertainOutcomeCode(code: unknown): boolean {
  return typeof code === 'string' && (code === 'UNKNOWN' || code.endsWith('_UNKNOWN') ||
    code === 'RECONCILIATION_REQUIRED' || code.endsWith('_RECONCILIATION_REQUIRED') ||
    code === 'NOT_CONFIRMED' || code.endsWith('_NOT_CONFIRMED'));
}

/** These codes can describe an effect or operation identity that predates the response. */
export function isPriorEffectCode(code: unknown): boolean {
  return typeof code === 'string' && ['ALREADY_APPLIED', 'ALREADY_CAPTURED', 'ALREADY_DECIDED', 'ALREADY_PAID', 'PAYMENT_ALREADY_USED', 'AUTOMATION_ALREADY_DISPATCHED', 'IDEMPOTENCY_CONFLICT'].includes(code);
}
