import { Plan, AgentError, boundedJson, execution } from './contracts.ts';
import { acquireModelBudget, boundedMessages } from '../model-budget.ts';
import { minimiseHistory } from '../model-input.ts';
import { z } from 'zod/v4';

const localPlanSchema = z.toJSONSchema(Plan);

export interface Planner {
  plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools: Array<{ id: string; description: string }>): Promise<Plan>;
}
/** A shared environment key is never forwarded to a lookalike or non-TLS endpoint. */
export function isOpenRouter(base: URL): boolean {
  if (base.hostname !== 'openrouter.ai') return false;
  if (base.protocol !== 'https:' || base.port || base.pathname !== '/api/v1/' || base.username || base.password || base.search || base.hash) throw new AgentError('OPENROUTER_ENDPOINT_REQUIRED');
  return true;
}
export function requireFreeModel(model: string) {
  if (model !== 'openrouter/free' && !model.endsWith(':free')) throw new AgentError('FREE_MODEL_REQUIRED');
}
export function isLocalModelEndpoint(base: URL): boolean {
  return ['http:', 'https:'].includes(base.protocol) && ['localhost', '127.0.0.1', '[::1]', 'conversation', 'host.docker.internal'].includes(base.hostname)
    && !base.username && !base.password && !base.search && !base.hash && base.port !== '0' && base.pathname.endsWith('/');
}
/** No hosted SDK or fallback. The endpoint is deployment configuration, never model/user input. */
export class CompatiblePlanner implements Planner {
  private readonly base: URL; private readonly model: string; private readonly key?: string; private readonly timeoutMs: number; private readonly maxTokens: number; private readonly jsonFormat: boolean; private readonly localMode: boolean;
  constructor(base: URL, model: string, key?: string, timeoutMs = 15000, maxTokens = 200, jsonFormat = true, localMode = false) {
    if (isOpenRouter(base)) requireFreeModel(model);
    if (localMode && !isLocalModelEndpoint(base)) throw new AgentError('LOCAL_MODEL_ENDPOINT_REQUIRED');
    this.base = base; this.model = model; this.key = key; this.timeoutMs = timeoutMs; this.maxTokens = maxTokens; this.jsonFormat = jsonFormat; this.localMode = localMode;
  }
  async plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools: Array<{ id: string; description: string }>): Promise<Plan> {
    let release: (() => void) | undefined;
    try {
      const references = (text: string) => [...new Set((text.match(/\bfine-[a-z0-9_-]+\b/gi) || []).map(id => id.replace(/^fine-/i, 'fine-')))];
      let selected = references(messages.at(-1)?.content || '');
      if (!selected.length && /\bpay\s+(?:them|it)\b|أريد\s+دفعها/i.test(messages.at(-1)?.content || '')) {
        const prior = messages.slice(0, -1).filter(item => item.role === 'user').reverse().find(item => references(item.content).length);
        if (prior) selected = references(prior.content);
      }
      const modelTurns = messages.map(item => ({ ...item, content: item.content.replace(/\bfine-[a-z0-9_-]+\b/gi, 'the selected fine') }));
      const safeMessages = boundedMessages([{ role: 'system', content: `Select a bounded plan using only these services: ${JSON.stringify(tools)}. Return ONLY one JSON object, without markdown or explanation. It must have keys intent (list_fines, pay_fines, renew_registration, clarify or out_of_scope) and fineIds (an array of strings); omit vehicleId unless the user names an exact vehicle reference. Never invent vehicle references or use null. Example: {"intent":"list_fines","fineIds":[]}. Use renew_registration for a request to renew, prepare or review renewal of vehicle registration (تجديد تسجيل المركبة). This intent prepares a review and never executes renewal. The agent itself handles any fines that must be paid first. Classify the whole requested task: polite wording such as help me or review does not make an explicit renewal request unclear. Examples: "Can you help me extend my registration?" and "ساعدني في إجراءات تجديد رخصة المركبة" both mean renew_registration. Intent meanings: list_fines only reads fines. pay_fines prepares a payment REVIEW and waits for separate explicit approval; it never executes payment. Choose pay_fines when the user asks to pay, prepare payment or review paying fines, including a combined retrieve/list-and-pay request. For example, "Retrieve my fines and review paying them" means {"intent":"pay_fines","fineIds":[]}; "Show outstanding fines" means {"intent":"list_fines","fineIds":[]}. A follow-up "Pay them" after a fines list also means pay_fines. Do not choose payment review for a read-only request or a negated payment request. Return fineIds as an empty array. Exact fine references are withheld from this prompt and bound by the server to the user selection; without an explicit selection the server lists all currently outstanding fines. Use clarify only for greetings or requests whose intended task is genuinely missing. An explicit request to review, prepare or get help with a supported task already identifies the intent and must not become clarify. A clear request for an unsupported service must use out_of_scope, even if you cannot help with it. Viewing/paying fines and renewing vehicle registration are the only supported tasks. You cannot authorize, consent or execute. Never echo user text or credentials.` }, ...minimiseHistory(modelTurns, { personalContext: false })]);
      const principal = execution.getStore()?.principal;
      release = acquireModelBudget(safeMessages, this.maxTokens, principal ? `focused:${principal.subject}:${principal.workload}` : undefined);
      const response = await fetch(new URL('chat/completions', this.base), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, temperature: 0, max_tokens: this.maxTokens, stream: false, ...(this.jsonFormat ? { response_format: this.localMode ? { type: 'json_schema', json_schema: { name: 'cityside_plan', strict: true, schema: localPlanSchema } } : { type: 'json_object' } } : {}),
          ...(this.localMode ? { chat_template_kwargs: { enable_thinking: false } } : {}),
          ...(isOpenRouter(this.base) ? { provider: { max_price: { prompt: 0, completion: 0 } }, reasoning: { enabled: false } } : {}), messages: safeMessages }),
      });
      if (!response.ok) throw new Error('Provider unavailable');
      const data = await boundedJson(response) as { choices?: Array<{ finish_reason?: unknown; message?: { content?: string } }>; usage?: { completion_tokens?: unknown } };
      const choice = data.choices?.[0];
      // A syntactically valid prefix is not a completed plan. Older compatible servers may omit metadata.
      if (choice && 'finish_reason' in choice && choice.finish_reason !== 'stop') throw new Error('Incomplete plan');
      const used = data.usage?.completion_tokens;
      if (used !== undefined && (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0 || used > this.maxTokens)) throw new Error('Completion budget exceeded');
      const content = choice?.message?.content;
      if (!content || content.length > 4000) throw new Error('Invalid plan');
      const plan = Plan.parse(JSON.parse(content));
      if (plan.fineIds.some(id => !selected.includes(id))) throw new Error('Unbound fine selection');
      return Plan.parse({ ...plan, fineIds: selected });
    } catch { throw new AgentError('MODEL_UNAVAILABLE_OR_INVALID_PLAN', 503); }
    finally { release?.(); }
  }
}
/** Explicit test/demo adapter. It is never selected as a fallback after an LLM failure. */
export class FixturePlanner implements Planner {
  async plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<Plan> {
    const text = messages.at(-1)?.content.toLowerCase() || '';
    const prior = messages.slice(0, -1).some(m => /fine/.test(m.content));
    if (/renew/.test(text) && /(registration|vehicle|car)/.test(text)) return { intent: 'renew_registration', fineIds: [] };
    return { intent: /pay/.test(text) && (/fine/.test(text) || prior) ? 'pay_fines' : /fine/.test(text) ? 'list_fines' : /^(hi|hello)/.test(text) ? 'clarify' : 'out_of_scope', fineIds: [...text.matchAll(/\bfine-\d+\b/g)].map(m => m[0]) };
  }
}
