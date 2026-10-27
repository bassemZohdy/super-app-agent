import { performance } from 'node:perf_hooks';
import { config } from '../services/agent-core/src/orchestrator/config.ts';
import { CompatiblePlanner } from '../services/agent-core/src/orchestrator/planner.ts';
import type { Plan } from '../services/agent-core/src/orchestrator/contracts.ts';

/** Opt-in real inference with synthetic text only. No token, raw model response or provider error is printed. */
async function verify() {
  const cfg = config();
  if (cfg.AGENT_PLANNER !== 'compatible' || !cfg.AGENT_LLM_BASE_URL || !cfg.AGENT_LLM_MODEL) throw new Error('CONFIGURE_COMPATIBLE_PLANNER');
  const planner = new CompatiblePlanner(cfg.AGENT_LLM_BASE_URL, cfg.AGENT_LLM_MODEL, cfg.AGENT_LLM_KEY, cfg.AGENT_LLM_TIMEOUT_MS, cfg.AGENT_LLM_MAX_TOKENS, cfg.AGENT_LLM_RESPONSE_FORMAT === 'json_object');
  const cases: Array<{ name: string; text: string; intent: Plan['intent']; prior?: boolean }> = [
    { name: 'English list', text: 'Show outstanding fines', intent: 'list_fines' },
    { name: 'English read-only with payment refused', text: 'Show outstanding fines, but do not pay them', intent: 'list_fines' },
    { name: 'English pay', text: 'Retrieve my fines and review paying them', intent: 'pay_fines' },
    { name: 'English clarification', text: 'Hello', intent: 'clarify' },
    { name: 'English unsupported service', text: 'Order a pizza', intent: 'out_of_scope' },
    { name: 'Arabic list', text: 'اعرض المخالفات المرورية المستحقة', intent: 'list_fines' },
    { name: 'Arabic pay', text: 'أريد دفع المخالفات المرورية المستحقة', intent: 'pay_fines' },
    { name: 'English follow-up', text: 'Pay them', intent: 'pay_fines', prior: true },
    { name: 'Arabic follow-up', text: 'أريد دفعها', intent: 'pay_fines', prior: true },
  ];
  console.log('Real-model smoke thresholds: every declared intent correct, each call within 15 seconds. A smoke pass does not qualify general model quality.');
  let passed = 0;
  for (const item of cases) {
    const started = performance.now();
    try {
      const plan = await planner.plan([
        ...(item.prior ? [{ role: 'assistant' as const, content: 'There are two outstanding simulated traffic fines.' }] : []),
        { role: 'user', content: item.text },
      ], [{ id: 'fines.list', description: 'View outstanding simulated fines' }, { id: 'fines.pay', description: 'Review payment; execution requires separate exact approval' }]);
      const latencyMs = Math.round(performance.now() - started);
      const ok = plan.intent === item.intent && latencyMs <= 15000;
      console.log(JSON.stringify({ case: item.name, expected: item.intent, actual: plan.intent, latencyMs, pass: ok }));
      if (ok) passed++;
    } catch {
      console.error(`${item.name}: MODEL_UNAVAILABLE_OR_INVALID_PLAN; stopping without fallback or retry.`);
      break;
    }
  }
  console.log(`Real-model smoke: ${passed}/${cases.length} passed.`);
  if (passed !== cases.length) process.exitCode = 1;
}
void verify().catch(() => { console.error('Model verification could not start. Check private planner configuration; no values logged.'); process.exitCode = 1; });
