import { actorContext } from '../../../packages/backend-kit/src/context.ts';

/** Hourly per-citizen ceilings for the demo model path. */
export const MODEL_CALLS_PER_HOUR = 30;
export const MODEL_TOKENS_PER_HOUR = 40000;
/** Output reservation matches `max_tokens` in the local and hosted clients. */
const OUTPUT_TOKEN_RESERVATION = 192;

/** Conservative estimate: about three UTF-8 bytes per token, plus the reserved output. */
export function estimateTokens(bytes: number) {
  return Math.ceil(bytes / 3) + OUTPUT_TOKEN_RESERVATION;
}

const usage = new Map<string, { until: number; calls: number; tokens: number; active: number }>();
export function acquireModelBudget(messages: Array<{ role: string; content: string }> = []) {
  const actor = actorContext.getStore();
  const key = actor ? `${actor.sub}:${actor.accountId}` : 'local-demo';
  const now = Date.now();
  let inputBytes = 0;
  try { inputBytes = boundedMessages(messages).reduce((sum, item) => sum + Buffer.byteLength(item.content), 0); } catch { inputBytes = 0; }
  const estimated = estimateTokens(inputBytes);
  for (const [id, value] of usage) if (value.until <= now && !value.active) usage.delete(id);
  if (!usage.has(key) && usage.size >= 1000) throw new Error('Model request capacity reached');
  const budget = usage.get(key) || { until: now + 3600000, calls: 0, tokens: 0, active: 0 };
  if (budget.calls >= MODEL_CALLS_PER_HOUR || budget.active >= 2) throw new Error('Model budget reached. Wait before requesting another reply.');
  if (budget.tokens + estimated > MODEL_TOKENS_PER_HOUR) throw new Error('Model token budget reached. Wait before requesting another reply.');
  budget.calls++; budget.tokens += estimated; budget.active++; usage.set(key, budget);
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
