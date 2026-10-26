import { Plan, AgentError, boundedJson } from './contracts.ts';

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
/** No hosted SDK or fallback. The endpoint is deployment configuration, never model/user input. */
export class CompatiblePlanner implements Planner {
  private readonly base: URL; private readonly model: string; private readonly key?: string; private readonly timeoutMs: number; private readonly maxTokens: number; private readonly jsonFormat: boolean;
  constructor(base: URL, model: string, key?: string, timeoutMs = 15000, maxTokens = 200, jsonFormat = true) {
    if (isOpenRouter(base)) requireFreeModel(model);
    this.base = base; this.model = model; this.key = key; this.timeoutMs = timeoutMs; this.maxTokens = maxTokens; this.jsonFormat = jsonFormat;
  }
  async plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools: Array<{ id: string; description: string }>): Promise<Plan> {
    try {
      const response = await fetch(new URL('chat/completions', this.base), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, temperature: 0, max_tokens: this.maxTokens, stream: false, ...(this.jsonFormat ? { response_format: { type: 'json_object' } } : {}),
          ...(isOpenRouter(this.base) ? { provider: { max_price: { prompt: 0, completion: 0 } }, reasoning: { enabled: false } } : {}), messages: [
          { role: 'system', content: `Select a bounded fines plan using only these services: ${JSON.stringify(tools)}. Return ONLY one JSON object, without markdown or explanation. It must have keys intent (list_fines, pay_fines, clarify or out_of_scope) and fineIds (an array of strings). Example: {"intent":"list_fines","fineIds":[]}. Pay only if requested. Use exact fine IDs requested by the user; empty IDs means all currently outstanding fines. Unclear requests need clarify. You cannot authorize, consent or execute. Never echo user text or credentials.` },
          ...messages.slice(-12),
        ] }),
      });
      if (!response.ok) throw new Error('Provider unavailable');
      const data = await boundedJson(response) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content || content.length > 4000) throw new Error('Invalid plan');
      return Plan.parse(JSON.parse(content));
    } catch { throw new AgentError('MODEL_UNAVAILABLE_OR_INVALID_PLAN', 503); }
  }
}
/** Explicit test/demo adapter. It is never selected as a fallback after an LLM failure. */
export class FixturePlanner implements Planner {
  async plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<Plan> {
    const text = messages.at(-1)?.content.toLowerCase() || '';
    const prior = messages.slice(0, -1).some(m => /fine/.test(m.content));
    return { intent: /pay/.test(text) && (/fine/.test(text) || prior) ? 'pay_fines' : /fine/.test(text) ? 'list_fines' : /^(hi|hello)/.test(text) ? 'clarify' : 'out_of_scope', fineIds: [...text.matchAll(/\bfine-\d+\b/g)].map(m => m[0]) };
  }
}
