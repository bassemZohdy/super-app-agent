/** Human-facing result summary; token/transport fields never become consent UI text. */
export function delegationResult(result: Record<string, unknown>): string {
  const balance = typeof result.balance === 'number' ? result.balance : result.remainingBalance;
  return typeof balance === 'number' ? `Approved operation completed. Wallet balance: AED ${balance.toFixed(2)}.` : 'Approved operation completed.';
}
