import { randomUUID } from 'node:crypto';
import { Annotation, StateGraph, START, END, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import { AgentError, Plan, Decision, context, authorize, digest, quoteFor, type Fine, type Quote, type Receipt } from './contracts.ts';
import type { Planner } from './planner.ts';
import { FinesAdapter, invokeTool } from './fines-adapter.ts';
import type { Store } from './store.ts';

export interface PendingApproval { id: string; quote: Quote; key: string; expiresAt: number }
export const State = Annotation.Root({
  messages: Annotation<Array<{ role: 'user' | 'assistant'; content: string }>>({ reducer: (a, b) => [...a, ...b].slice(-12), default: () => [] }),
  plan: Annotation<Plan>(),
  fines: Annotation<Fine[]>({ reducer: (_a, b) => b, default: () => [] }),
  pending: Annotation<PendingApproval | null>(),
  decision: Annotation<Decision | null>(),
  receipt: Annotation<Receipt | null>(),
  status: Annotation<string>(),
  reply: Annotation<string>(),
});

/** Acyclic, bounded graph. Only list and execute invoke business tools. */
export function createGraph(planner: Planner, tools: FinesAdapter, store: Store, checkpointer: BaseCheckpointSaver, approvalTtlMs = 300000) {
  const progress = (node: string) => context().onProgress?.(node);
  const graph = new StateGraph(State)
    .addNode('understand', async state => {
      progress('understand');
      authorize(context().principal, 'fines:read');
      try {
        const plan = Plan.parse(await planner.plan(state.messages, [tools.list, tools.pay].map(({ id, description }) => ({ id, description }))));
        return { plan, pending: null, decision: null, receipt: null, status: 'planned' };
      } catch {
        return { plan: { intent: 'clarify' as const, fineIds: [] }, status: 'model_unavailable', reply: 'The planning provider is unavailable or returned an invalid plan. No operation ran.' };
      }
    })
    .addNode('list', async () => {
      progress('list');
      try { return { fines: await invokeTool(tools.list, {}, context()) }; }
      catch { return { status: 'service_unavailable', reply: 'The fines service is unavailable. No payment was attempted.' }; }
    })
    .addNode('prepare', state => {
      progress('prepare');
      authorize(context().principal, 'fines:pay');
      const ids = [...new Set(state.plan.fineIds)];
      const fines = ids.length ? state.fines.filter(f => ids.includes(f.id)) : state.fines;
      if (ids.length && fines.length !== ids.length) return { status: 'invalid_selection', reply: 'One or more requested fines are unavailable. Review outstanding fines again.' };
      if (!fines.length) return { status: 'complete', reply: 'There are no outstanding fines to pay.' };
      const quote = quoteFor(fines);
      const key = digest({ subject: context().principal.subject, operation: 'fines.pay.v1', quote });
      return { pending: { id: randomUUID(), quote, key, expiresAt: Date.now() + approvalTtlMs }, status: 'awaiting_approval', reply: `Review ${quote.fineIds.length} simulated fine(s), total AED ${(quote.amountMinor / 100).toFixed(2)}. Confirm using the approval action.` };
    })
    .addNode('approval', state => {
      progress('approval');
      // No side effects before interrupt: LangGraph re-enters this node on resume.
      const decision = Decision.parse(interrupt({ kind: 'confirm_simulated_payment', ...state.pending }));
      if (!state.pending || decision.approvalId !== state.pending.id) throw new AgentError('APPROVAL_MISMATCH', 409);
      if (decision.decision !== 'approve') return { decision, status: decision.decision === 'cancel' ? 'cancelled' : 'rejected', reply: 'The simulated payment was not executed.' };
      if (state.pending.expiresAt <= Date.now()) return { decision, status: 'expired', reply: 'This approval expired. Review a new quote before paying.' };
      return { decision, status: 'approved' };
    })
    .addNode('execute', async state => {
      progress('execute');
      const pending = state.pending;
      if (!pending || state.decision?.decision !== 'approve' || state.decision.approvalId !== pending.id) throw new AgentError('CONSENT_REQUIRED', 403);
      try {
        const ctx = context(), principal = await ctx.revalidate();
        if (principal.subject !== ctx.principal.subject || principal.workload !== ctx.principal.workload) throw new AgentError('AUTHORITY_CHANGED', 403);
        authorize(principal, 'fines:pay');
        await store.consent(pending.id, principal, pending.key, pending.quote, pending.expiresAt);
        await store.verifyConsent(pending.id, principal, pending.key, pending.quote);
        const prior = await store.operation(pending.key, principal.subject, pending.quote);
        // Retrying this one provider is safe ONLY because it durably implements this original key.
        const receipt = prior || await invokeTool(tools.pay, { quote: pending.quote, consentId: pending.id }, { ...ctx, principal }, pending.key);
        if (receipt.idempotencyKey !== pending.key || digest(receipt.quote) !== digest(pending.quote)) throw new AgentError('RECEIPT_MISMATCH', 502);
        await store.finish(pending.key, receipt);
        return { receipt, status: 'complete', reply: `Simulated payment completed: AED ${(receipt.quote.amountMinor / 100).toFixed(2)}. No real funds were used.` };
      } catch (error) {
        const code = error instanceof AgentError ? error.code : 'PAYMENT_OUTCOME_UNKNOWN';
        await store.finish(pending.key);
        return { status: ['AUTHORITY_EXPIRED', 'PERMISSION_DENIED', 'AUTHORITY_CHANGED', 'CONSENT_REQUIRED_OR_EXPIRED', 'APPROVAL_EXPIRED', 'PROVIDER_DENIED'].includes(code) ? 'denied' : code === 'QUOTE_STALE' ? 'stale' : 'unknown', reply: `Payment not confirmed (${code}). Inspect this interaction; never create a replacement payment for an unknown outcome.` };
      }
    })
    .addNode('respond', state => {
      progress('respond');
      const reply = state.plan.intent === 'clarify' && state.status === 'planned' ? 'Would you like to view outstanding fines or review a simulated payment?' : state.plan.intent === 'out_of_scope' ? 'This agent currently supports viewing and simulating payment of government fines.' : state.plan.intent === 'list_fines' && state.status !== 'service_unavailable' ? `You have ${state.fines.length} outstanding simulated fine(s). Ask to pay selected fines to review a payment.` : state.reply;
      return { reply, messages: [{ role: 'assistant' as const, content: reply }], status: state.status === 'planned' ? 'complete' : state.status };
    })
    .addEdge(START, 'understand')
    .addConditionalEdges('understand', s => s.status === 'model_unavailable' || ['clarify', 'out_of_scope'].includes(s.plan.intent) ? 'respond' : 'list', ['respond', 'list'])
    .addConditionalEdges('list', s => s.status === 'service_unavailable' || s.plan.intent === 'list_fines' ? 'respond' : 'prepare', ['respond', 'prepare'])
    .addConditionalEdges('prepare', s => s.status === 'awaiting_approval' ? 'approval' : 'respond', ['approval', 'respond'])
    .addConditionalEdges('approval', s => s.status === 'approved' ? 'execute' : 'respond', ['execute', 'respond'])
    .addEdge('execute', 'respond').addEdge('respond', END)
    .compile({ checkpointer });
  return graph;
}
export type AgentGraph = ReturnType<typeof createGraph>;
