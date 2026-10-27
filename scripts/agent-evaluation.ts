import { Plan } from '../services/agent-core/src/orchestrator/contracts.ts';
import type { Planner } from '../services/agent-core/src/orchestrator/planner.ts';

export const EVALUATION_VERSION = 'fines-renewal-en-ar-v1';
export const EVALUATION_THRESHOLDS = { allCasesCorrect: true, maxCallMs: 15000, p95Ms: 8000 } as const;
type Turn = { role: 'user' | 'assistant'; content: string };
export interface EvaluationCase {
  id: string; locale: 'en' | 'ar'; slice: 'list' | 'pay' | 'clarify' | 'out_of_scope' | 'renewal' | 'follow_up';
  messages: Turn[]; expected: Plan;
}
const item = (id: string, locale: EvaluationCase['locale'], slice: EvaluationCase['slice'], content: string, intent: Plan['intent'], fineIds: string[] = [], prior: Turn[] = []): EvaluationCase => ({ id, locale, slice, messages: [...prior, { role: 'user', content }], expected: { intent, fineIds } });

/** Synthetic, reviewable gold cases; never generated or judged by the selected model. */
export const EVALUATION_CASES: EvaluationCase[] = [
  item('en-list', 'en', 'list', 'Show my outstanding traffic fines', 'list_fines'),
  item('en-read-only', 'en', 'list', 'Show my fines, but do not pay anything', 'list_fines'),
  item('ar-list', 'ar', 'list', 'اعرض المخالفات المرورية المستحقة', 'list_fines'),
  item('ar-read-only', 'ar', 'list', 'اعرض المخالفات فقط ولا تدفع أي شيء', 'list_fines'),
  item('en-review', 'en', 'pay', 'Retrieve my fines and review paying them', 'pay_fines'),
  item('en-selected-payment', 'en', 'pay', 'Prepare payment of fine-1 only', 'pay_fines', ['fine-1']),
  item('ar-review', 'ar', 'pay', 'أريد مراجعة دفع المخالفات المرورية المستحقة', 'pay_fines'),
  item('ar-selected-payment', 'ar', 'pay', 'أريد دفع fine-2 فقط', 'pay_fines', ['fine-2']),
  item('en-greeting', 'en', 'clarify', 'Hello', 'clarify'),
  item('en-ambiguous', 'en', 'clarify', 'Help me please', 'clarify'),
  item('ar-greeting', 'ar', 'clarify', 'مرحبا', 'clarify'),
  item('ar-ambiguous', 'ar', 'clarify', 'أحتاج مساعدة', 'clarify'),
  item('en-food', 'en', 'out_of_scope', 'Order a pizza', 'out_of_scope'),
  item('en-flight', 'en', 'out_of_scope', 'Book a flight to London', 'out_of_scope'),
  item('ar-food', 'ar', 'out_of_scope', 'اطلب لي وجبة طعام', 'out_of_scope'),
  item('ar-flight', 'ar', 'out_of_scope', 'احجز لي تذكرة طيران', 'out_of_scope'),
  item('en-renewal', 'en', 'renewal', 'Renew my car registration', 'renew_registration'),
  item('en-renewal-review', 'en', 'renewal', 'Help me review renewing my vehicle registration', 'renew_registration'),
  item('ar-renewal', 'ar', 'renewal', 'أريد تجديد تسجيل مركبتي', 'renew_registration'),
  item('ar-renewal-review', 'ar', 'renewal', 'راجع تجديد تسجيل السيارة', 'renew_registration'),
  item('en-selected-follow-up', 'en', 'follow_up', 'Pay them', 'pay_fines', ['fine-1'], [{ role: 'user', content: 'Show fine-1 only' }, { role: 'assistant', content: 'One selected simulated fine is outstanding.' }]),
  item('ar-selected-follow-up', 'ar', 'follow_up', 'أريد دفعها', 'pay_fines', ['fine-2'], [{ role: 'user', content: 'اعرض fine-2 فقط' }, { role: 'assistant', content: 'توجد مخالفة واحدة محددة.' }]),
  item('en-return-to-read', 'en', 'follow_up', 'Just show my outstanding fines; do not pay', 'list_fines', [], [{ role: 'user', content: 'I might want to pay fines later' }, { role: 'assistant', content: 'Please choose whether to view fines or review payment.' }]),
  item('ar-return-to-read', 'ar', 'follow_up', 'اعرض المخالفات فقط دون دفع', 'list_fines', [], [{ role: 'user', content: 'قد أريد دفع المخالفات لاحقا' }, { role: 'assistant', content: 'هل تريد عرض المخالفات أم مراجعة الدفع؟' }]),
];

export interface EvaluationResult {
  id: string; locale: EvaluationCase['locale']; slice: EvaluationCase['slice']; expected: Plan['intent'];
  actual?: Plan['intent']; selectionCorrect: boolean; latencyMs: number; pass: boolean;
  error?: 'MODEL_UNAVAILABLE_OR_INVALID_PLAN';
}
export function summarizeEvaluation(results: EvaluationResult[], expectedCases = EVALUATION_CASES) {
  const samples = results.filter(result => !result.error).map(result => result.latencyMs).sort((a, b) => a - b);
  const p95Ms = samples.length ? samples[Math.ceil(samples.length * .95) - 1] : null;
  const completed = results.length === expectedCases.length && results.every((result, index) => result.id === expectedCases[index].id && !result.error);
  const correct = results.filter(result => result.actual === result.expected && result.selectionCorrect).length;
  const perLocale = Object.fromEntries(['en', 'ar'].map(locale => [locale, { expected: expectedCases.filter(item => item.locale === locale).length, correct: results.filter(result => result.locale === locale && result.actual === result.expected && result.selectionCorrect).length }]));
  return { completed, attempted: results.length, scored: samples.length, notRun: expectedCases.length - results.length, correct, expected: expectedCases.length, p95Ms, perLocale,
    passed: completed && correct === expectedCases.length && results.every(result => result.pass && result.latencyMs <= EVALUATION_THRESHOLDS.maxCallMs) && p95Ms !== null && p95Ms <= EVALUATION_THRESHOLDS.p95Ms };
}

export async function evaluatePlanner(planner: Planner, tools: Array<{ id: string; description: string }>, options: { cases?: EvaluationCase[]; now?: () => number; onCase?: (result: EvaluationResult) => void } = {}) {
  const cases = options.cases ?? EVALUATION_CASES, now = options.now ?? (() => performance.now());
  const results: EvaluationResult[] = [];
  for (const item of cases) {
    const started = now();
    let result: EvaluationResult;
    try {
      const plan = Plan.parse(await planner.plan(item.messages, tools));
      const latencyMs = Math.max(0, Math.round(now() - started));
      const selectionCorrect = [...plan.fineIds].sort().join('|') === [...item.expected.fineIds].sort().join('|') && plan.vehicleId === item.expected.vehicleId;
      result = { id: item.id, locale: item.locale, slice: item.slice, expected: item.expected.intent, actual: plan.intent, selectionCorrect, latencyMs, pass: plan.intent === item.expected.intent && selectionCorrect && latencyMs <= EVALUATION_THRESHOLDS.maxCallMs };
    } catch {
      result = { id: item.id, locale: item.locale, slice: item.slice, expected: item.expected.intent, selectionCorrect: false, latencyMs: Math.max(0, Math.round(now() - started)), pass: false, error: 'MODEL_UNAVAILABLE_OR_INVALID_PLAN' };
    }
    results.push(result); options.onCase?.(result);
    if (result.error) break; // Unavailable/invalid providers never cause retries or fallback.
  }
  return { results, summary: summarizeEvaluation(results, cases) };
}
