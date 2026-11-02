/** Codes signalling an unresolved business effect are never proof that a write was rejected. */
export function isUncertainOutcomeCode(code: unknown): boolean {
  return typeof code === 'string' && (code === 'FIXTURE_EPOCH_CHANGED' || code === 'UNKNOWN' || code.endsWith('_UNKNOWN') ||
    code === 'RECONCILIATION_REQUIRED' || code.endsWith('_RECONCILIATION_REQUIRED') ||
    code === 'NOT_CONFIRMED' || code.endsWith('_NOT_CONFIRMED'));
}

/** These codes can describe an effect or operation identity that predates the response. */
export function isPriorEffectCode(code: unknown): boolean {
  return typeof code === 'string' && ['ALREADY_APPLIED', 'ALREADY_CAPTURED', 'ALREADY_DECIDED', 'ALREADY_PAID', 'PAYMENT_ALREADY_USED', 'AUTOMATION_ALREADY_DISPATCHED', 'IDEMPOTENCY_CONFLICT'].includes(code);
}

/** A present authority denial cannot establish whether an earlier write took effect. */
export function isAuthorityDenial(status: number, code: unknown): boolean {
  return status === 401 || status === 403 || typeof code === 'string' && [
    'ACCOUNT_FORBIDDEN', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_RESTRICTED', 'ACTOR_CHAIN_UNSUPPORTED', 'ACTOR_REQUIRED',
    'AUTHENTICATION_REQUIRED', 'AUTHORIZATION_DENIED', 'AUTOMATION_OPERATION_DENIED', 'AUTOMATION_PERMIT_DENIED',
    'DELEGATION_DENIED', 'DELEGATION_DISABLED', 'ELIGIBILITY_CHANGED', 'ELIGIBILITY_OPERATION_DENIED',
    'ELIGIBILITY_UNAVAILABLE', 'ELIGIBILITY_WORKLOAD_REQUIRED', 'FORBIDDEN', 'SERVICE_FORBIDDEN', 'SESSION_EXPIRED',
    'UNAUTHENTICATED', 'USER_TOKEN_REQUIRED',
  ].includes(code);
}
