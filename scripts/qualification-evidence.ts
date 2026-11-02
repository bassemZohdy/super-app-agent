import assert from 'node:assert/strict';

type Response = { status: number; data: unknown };
/** Confirm the original receipt, exact same-key replay and refusal of a fresh approval. */
export function assertApprovalReplay(receipt: unknown, same: Response, fresh: Response) {
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'the original approval returned a receipt');
  assert.equal(same.status, 200, 'the same key returns a successful replay');
  assert.ok(same.data && typeof same.data === 'object' && !Array.isArray(same.data), 'the replay returned a response');
  assert.deepEqual((same.data as { receipt?: unknown }).receipt, receipt, 'the same key returns the actual original receipt');
  assert.equal(fresh.status, 409, 'a new key cannot approve an already-used decision');
}

/** Require a single unambiguous count from the isolated simulator database. */
export function assertPaymentCount(output: string, expected: 0 | 1) {
  assert.equal(output, String(expected), `the isolated simulator must contain exactly ${expected} payments`);
}

export type BuildSourceState = { revision: string; dirty: boolean };
/** Describe only observed Git state; a dirty tree is not an exact commit snapshot. */
export function describeBuildSource(before: BuildSourceState, after: BuildSourceState): string {
  assert.ok(/^[a-f0-9]{40,64}$/.test(before.revision) && /^[a-f0-9]{40,64}$/.test(after.revision), 'a valid Git revision is required');
  if (before.revision !== after.revision) return `checkout changed during the build (HEAD ${before.revision} to ${after.revision}); source is not reproducible from either revision alone`;
  if (before.dirty || after.dirty) return `HEAD ${before.revision} with uncommitted changes before or after the build; exact source is not identified by the commit`;
  return `HEAD ${before.revision}, worktree clean before and after the build`;
}
