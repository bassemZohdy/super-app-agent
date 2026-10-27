import { z } from 'zod/v4';
import { AgentError, Fine, Quote, Receipt, authorize, type Tool, type ExecutionContext } from './contracts.ts';
import { simulatorRequest } from './simulator-client.ts';

export class FinesAdapter {
  readonly list: Tool<Record<string, never>, Fine[]>;
  readonly pay: Tool<{ quote: Quote; consentId: string }, Receipt>;
  constructor(base: URL, workloadKey: string, timeoutMs = 3000) {
    const request = (path: string, ctx: ExecutionContext, signal: AbortSignal, body?: unknown, key?: string) => simulatorRequest(base, workloadKey, path, ctx, signal, { body, key });
    this.list = { id: 'fines.list', description: 'Retrieve this resident’s outstanding simulated government fines', protocol: 'rest', input: z.object({}).strict(), output: z.array(Fine).max(100), permission: 'fines:read', consequential: false, timeoutMs,
      invoke: async (_input, ctx, signal) => z.array(Fine).max(100).parse(await request('simulator/v1/fines', ctx, signal)) };
    this.pay = { id: 'fines.pay', description: 'Pay an exact reviewed set of simulated fines after confirmation', protocol: 'rest', input: z.object({ quote: Quote, consentId: z.string().uuid() }).strict(), output: Receipt, permission: 'fines:pay', consequential: true, timeoutMs,
      invoke: async (input, ctx, signal, key) => Receipt.parse(await request('simulator/v1/payments', ctx, signal, input, key)) };
  }
}

export async function invokeTool<I, O>(tool: Tool<I, O>, input: I, ctx: ExecutionContext, key?: string): Promise<O> {
  authorize(ctx.principal, tool.permission);
  if (tool.consequential && !key) throw new AgentError('IDEMPOTENCY_KEY_REQUIRED');
  try {
    return tool.output.parse(await tool.invoke(tool.input.parse(input), ctx, AbortSignal.timeout(tool.timeoutMs), key));
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('TOOL_TIMEOUT_OR_INVALID_RESPONSE', 502);
  }
}
