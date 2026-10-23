import { actorContext } from '../../../packages/backend-kit/src/context.ts';

const usage = new Map<string, { until: number; calls: number; active: number }>();
export function acquireModelBudget() {
  const actor = actorContext.getStore();
  const key = actor ? `${actor.sub}:${actor.accountId}` : 'local-demo';
  const now = Date.now();
  for (const [id, value] of usage) if (value.until <= now && !value.active) usage.delete(id);
  if (!usage.has(key) && usage.size >= 1000) throw new Error('Model request capacity reached');
  const budget = usage.get(key) || { until: now + 3600000, calls: 0, active: 0 };
  if (budget.calls >= 30 || budget.active >= 2) throw new Error('Model budget reached. Wait before requesting another reply.');
  budget.calls++; budget.active++; usage.set(key, budget);
  let released = false;
  return () => { if (!released) { released = true; budget.active--; } };
}

function clip(text: string, bytes: number) {
  let result = Buffer.from(text).subarray(0, Math.max(0, bytes)).toString('utf8');
  while (Buffer.byteLength(result) > bytes) result = result.slice(0, -1);
  return result;
}

export function boundedMessages(messages: Array<{ role: string; content: string }>) {
  if (!Array.isArray(messages) || !messages.length || messages.some(item => !item || !['system','user','assistant'].includes(item.role) || typeof item.content !== 'string')) throw new Error('Invalid model input');
  const first = messages[0].role === 'system' ? [{ ...messages[0], content: clip(messages[0].content, 14000) }] : [];
  let remaining = 24000 - Buffer.byteLength(first[0]?.content || '');
  const turns: Array<{ role: string; content: string }> = [];
  for (const item of messages.slice(first.length).slice(-12).reverse()) {
    const content = clip(item.content, Math.min(4000, remaining));
    if (!content) continue;
    remaining -= Buffer.byteLength(content); turns.unshift({ role: item.role, content });
  }
  return [...first, ...turns];
}
