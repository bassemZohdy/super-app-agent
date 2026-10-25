/** The exact operation an automatic execution permit authorizes. The broker derives it from the
 *  provider's execution view and the provider derives it from its stored preparation; they must agree. */
export type AutomationOperationFacts = {
  executionId: string; runId: string; accountId: string; boundDigest: string;
  payableId: string; payableRevision: string; amountMinor: number; sourceId: string; sourceVersion: number;
};
export function automationOperation(facts: AutomationOperationFacts) {
  return {
    kind: 'AUTOMATION_EXECUTION' as const, runId: facts.runId, executionId: facts.executionId, accountId: facts.accountId,
    boundDigest: facts.boundDigest, payableId: facts.payableId, payableRevision: facts.payableRevision,
    amountMinor: facts.amountMinor, sourceId: facts.sourceId, sourceVersion: facts.sourceVersion,
  };
}
