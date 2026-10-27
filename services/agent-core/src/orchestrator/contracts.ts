import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';

export class AgentError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const Message = z.string().trim().min(1).max(2000).refine(
  value => !/bearer\s|eyJ[A-Za-z0-9_-]+\.|(?:api[_-]?key|password|secret|token)\s*[:=]/i.test(value),
  'Do not submit credentials in conversation text',
);
export const Plan = z.object({
  intent: z.enum(['list_fines', 'pay_fines', 'clarify', 'out_of_scope']),
  fineIds: z.array(Id).max(10).default([]),
}).strict();
export type Plan = z.infer<typeof Plan>;
export const Fine = z.object({ id: Id, description: z.string().max(200), amountMinor: z.number().int().positive().max(10000000), version: z.number().int().positive() }).strict();
export type Fine = z.infer<typeof Fine>;
export const Quote = z.object({ fineIds: z.array(Id).min(1).max(10), amountMinor: z.number().int().positive().max(100000000), currency: z.literal('AED'), versions: z.array(z.number().int().positive()).max(10) }).strict().refine(q => new Set(q.fineIds).size === q.fineIds.length && q.versions.length === q.fineIds.length, 'Quote must contain unique fines with corresponding versions');
export type Quote = z.infer<typeof Quote>;
export const Receipt = z.object({ id: z.string().uuid(), simulated: z.literal(true), quote: Quote, idempotencyKey: z.string().length(64) }).strict();
export type Receipt = z.infer<typeof Receipt>;
export const Vehicle = z.object({ id: Id, description: z.string().max(200), renewalFeeMinor: z.number().int().positive().max(10000000), version: z.number().int().positive() }).strict();
export type Vehicle = z.infer<typeof Vehicle>;
export const RenewalQuote = z.object({ vehicleId: Id, amountMinor: z.number().int().positive().max(10000000), currency: z.literal('AED'), version: z.number().int().positive() }).strict();
export type RenewalQuote = z.infer<typeof RenewalQuote>;
export const RenewalReceipt = z.object({ id: z.string().uuid(), simulated: z.literal(true), quote: RenewalQuote, idempotencyKey: z.string().length(64) }).strict();
export type RenewalReceipt = z.infer<typeof RenewalReceipt>;
export const Decision = z.object({ approvalId: z.string().uuid(), decision: z.enum(['approve', 'reject', 'cancel']) }).strict();
export type Decision = z.infer<typeof Decision>;
export interface Principal { subject: string; workload: string; permissions: string[]; expiresAt: number }
export interface ExecutionContext {
  principal: Principal;
  authorization: string;
  correlationId: string;
  // Re-run verified authentication, including revocation checks, before a write.
  revalidate: () => Promise<Principal>;
  onProgress?: (node: string) => void;
}
export const execution = new AsyncLocalStorage<ExecutionContext>();
export function context(): ExecutionContext {
  const value = execution.getStore();
  if (!value) throw new AgentError('AUTHORITY_REQUIRED', 401);
  return value;
}
export function authorize(principal: Principal, permission: string) {
  if (principal.expiresAt <= Date.now()) throw new AgentError('AUTHORITY_EXPIRED', 401);
  if (!principal.workload || !principal.subject || !principal.permissions.includes(permission)) throw new AgentError('PERMISSION_DENIED', 403);
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function quoteFor(fines: Fine[]): Quote {
  const sorted = [...fines].sort((a, b) => a.id.localeCompare(b.id));
  return Quote.parse({ fineIds: sorted.map(f => f.id), amountMinor: sorted.reduce((sum, f) => sum + f.amountMinor, 0), currency: 'AED', versions: sorted.map(f => f.version) });
}
export interface Tool<I, O> {
  id: string;
  description: string;
  protocol: 'rest' | 'mcp' | 'a2a' | 'soap' | 'browser';
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  permission: string;
  consequential: boolean;
  timeoutMs: number;
  invoke(input: I, ctx: ExecutionContext, signal: AbortSignal, idempotencyKey?: string): Promise<O>;
}
export async function boundedJson(response: Response, limit = 65536): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError('EMPTY_RESPONSE', 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new AgentError('RESPONSE_TOO_LARGE', 502); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
