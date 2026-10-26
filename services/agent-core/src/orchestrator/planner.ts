import { Plan, AgentError, boundedJson } from './contracts.ts';

export interface Planner {
  plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools: Array<{ id: string; description: string }>): Promise<Plan>;
}
/** No hosted SDK or fallback. The endpoint is deployment configuration, never model/user input. */
export class CompatiblePlanner implements Planner {
  private readonly base: URL; private readonly model: string; private readonly key?: string; private readonly timeoutMs: number;
  constructor(base: URL, model: string, key?: string, timeoutMs = 15000) { this.base = base; this.model = model; this.key = key; this.timeoutMs = timeoutMs; }
  async plan(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools: Array<{ id: string; description: string }>): Promise<Plan> {
    try {
      const response = await fetch(new URL('chat/completions', this.base), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, temperature: 0, max_tokens: 200, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: `Select a bounded fines plan using only these services: ${JSON.stringify(tools)}. Return JSON {"intent":"list_fines"|"pay_fines"|"clarify"|"out_of_scope","fineIds":string[]}. Pay only if requested. Use exact fine IDs requested by the user; empty IDs means all currently outstanding fines. Unclear requests need clarify. You cannot authorize, consent or execute. Never echo user text or credentials.` },
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
