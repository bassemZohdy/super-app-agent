import test from 'node:test';
import assert from 'node:assert/strict';
import { EVALUATION_CASES, evaluatePlanner, summarizeEvaluation } from '../../scripts/agent-evaluation.ts';

test('the versioned gold cases balance languages, cover supported intents and exercise exact follow-up selection', () => {
  assert.equal(EVALUATION_CASES.length, 24);
  assert.equal(new Set(EVALUATION_CASES.map(item => item.id)).size, EVALUATION_CASES.length);
  for (const locale of ['en', 'ar']) {
    const cases = EVALUATION_CASES.filter(item => item.locale === locale);
    assert.equal(cases.length, 12);
    for (const intent of ['list_fines', 'pay_fines', 'clarify', 'out_of_scope', 'renew_registration']) assert.ok(cases.some(item => item.expected.intent === intent));
    assert.ok(cases.some(item => item.messages.length > 1 && item.expected.fineIds.length));
  }
});
test('evaluation measures exact selections and latency; wrong intent and broadening a selected fine cannot pass', async () => {
  const cases = EVALUATION_CASES.slice(0, 2); let index = 0, tick = 0;
  const good = await evaluatePlanner({ plan: async () => cases[index++].expected }, [], { cases, now: () => tick++ * 100 });
  assert.equal(good.summary.passed, true); assert.equal(good.summary.p95Ms, 100);
  const selected = EVALUATION_CASES.filter(item => item.id === 'en-selected-payment');
  const broadened = await evaluatePlanner({ plan: async () => ({ intent: 'pay_fines', fineIds: [] }) }, [], { cases: selected });
  assert.equal(broadened.results[0].selectionCorrect, false); assert.equal(broadened.summary.passed, false);
  const wrong = await evaluatePlanner({ plan: async () => ({ intent: 'pay_fines', fineIds: [] }) }, [], { cases });
  assert.equal(wrong.summary.correct, 0); assert.equal(wrong.summary.passed, false);
  const slow = { ...good.results[0], latencyMs: 15001, pass: true };
  assert.equal(summarizeEvaluation([slow], cases.slice(0, 1)).passed, false);
  assert.equal(summarizeEvaluation([{ ...slow, latencyMs: 8001 }], cases.slice(0, 1)).passed, false);
});
test('provider failure stops qualification without retry, raw error publication or a passing partial result', async () => {
  let calls = 0;
  const result = await evaluatePlanner({ plan: async () => { calls++; throw new Error('untrusted-provider-detail'); } }, []);
  assert.equal(calls, 1); assert.equal(result.results.length, 1);
  assert.equal(result.summary.completed, false); assert.equal(result.summary.passed, false);
  assert.equal(result.summary.scored, 0); assert.equal(result.summary.p95Ms, null); assert.equal(result.summary.notRun, 23);
  assert.equal(JSON.stringify(result).includes('untrusted-provider-detail'), false);
  assert.equal(result.results[0].error, 'MODEL_UNAVAILABLE_OR_INVALID_PLAN');
});
