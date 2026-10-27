import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePlanner } from '../src/orchestrator/planner.ts';
import { evaluatePlannerAuthority } from '../../../scripts/agent-authority-evaluation.ts';

test('the qualification authority checks execute actual approvals and deduplication in disposable SQLite', async () => {
  const fixture = new FixturePlanner();
  const result = await evaluatePlannerAuthority({ plan: async (messages) => {
    // Explicit controlled adapter tests the runner only; this is not real-model evidence.
    if (messages.at(-1)?.content === 'أريد تجديد تسجيل مركبتي') return { intent: 'renew_registration', fineIds: [] };
    return fixture.plan(messages);
  } });
  assert.equal(result.passed, true); assert.equal(result.checks.length, 8);
});
test('an incorrect planner cannot receive a passing authority qualification or publish raw assertion details', async () => {
  const result = await evaluatePlannerAuthority({ plan: async () => ({ intent: 'clarify', fineIds: [] }) });
  assert.equal(result.passed, false); assert.equal(result.error, 'LIVE_PLANNER_AUTHORITY_CHECK_FAILED');
});
