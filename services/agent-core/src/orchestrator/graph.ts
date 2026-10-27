import { randomUUID } from 'node:crypto';
import { Annotation, StateGraph, START, END, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import { AgentError, Plan, Decision, RenewalQuote, context, authorize, digest, quoteFor, type Fine, type Quote, type Receipt, type RenewalReceipt, type Vehicle } from './contracts.ts';
import type { Planner } from './planner.ts';
import { FinesAdapter, invokeTool } from './fines-adapter.ts';
import type { VehiclesAdapter } from './vehicles-adapter.ts';
import type { Store } from './store.ts';

export interface PendingApproval { id: string; quote: Quote; key: string; expiresAt: number }
export interface PendingRenewal { id: string; quote: RenewalQuote; key: string; expiresAt: number }
export const State = Annotation.Root({
  messages: Annotation<Array<{ role: 'user' | 'assistant'; content: string }>>({ reducer: (a, b) => [...a, ...b].slice(-12), default: () => [] }),
  plan: Annotation<Plan>(),
  fines: Annotation<Fine[]>({ reducer: (_a, b) => b, default: () => [] }),
  vehicles: Annotation<Vehicle[]>({ reducer: (_a, b) => b, default: () => [] }),
  pending: Annotation<PendingApproval | null>(),
  decision: Annotation<Decision | null>(),
  receipt: Annotation<Receipt | null>(),
  renewalPending: Annotation<PendingRenewal | null>(),
  renewalDecision: Annotation<Decision | null>(),
  renewal: Annotation<RenewalReceipt | null>(),
  status: Annotation<string>(),
  reply: Annotation<string>(),
});

const aed = (minor: number) => `AED ${(minor / 100).toFixed(2)}`;
/** What the resident must still be told when the renewal does not happen after their fines were paid. */
const paidSentence = (receipt: Receipt | null | undefined) => receipt ? `Simulated fines payment completed: ${aed(receipt.quote.amountMinor)}. ` : '';
// A refusal here is definitive: the simulator or the authority check said no, so no renewal exists.
const REFUSED = ['AUTHORITY_EXPIRED', 'PERMISSION_DENIED', 'AUTHORITY_CHANGED', 'CONSENT_REQUIRED_OR_EXPIRED', 'APPROVAL_EXPIRED', 'PROVIDER_DENIED', 'QUOTE_STALE', 'FINES_OUTSTANDING'];

/** Acyclic, bounded graph. Only list, execute and the renewal nodes invoke business tools. */
export function createGraph(planner: Planner, tools: FinesAdapter, vehicles: VehiclesAdapter, store: Store, checkpointer: BaseCheckpointSaver, approvalTtlMs = 300000) {
  const progress = (node: string) => context().onProgress?.(node);
  const graph = new StateGraph(State)
    .addNode('understand', async state => {
      progress('understand');
      authorize(context().principal, 'fines:read');
      try {
        const plan = Plan.parse(await planner.plan(state.messages, [tools.list, tools.pay, vehicles.list, vehicles.renew].map(({ id, description }) => ({ id, description }))));
        return { plan, pending: null, decision: null, receipt: null, vehicles: [], renewalPending: null, renewalDecision: null, renewal: null, status: 'planned' };
      } catch {
        return { plan: { intent: 'clarify' as const, fineIds: [] }, status: 'model_unavailable', reply: 'The planning provider is unavailable or returned an invalid plan. No operation ran.' };
      }
    })
    .addNode('list', async () => {
      progress('list');
      try { return { fines: await invokeTool(tools.list, {}, context()) }; }
      catch { return { status: 'service_unavailable', reply: 'The fines service is unavailable. No payment was attempted.' }; }
    })
    .addNode('listVehicles', async state => {
      progress('listVehicles');
      // Refuse before any fine is paid: a resident who cannot renew must not be asked to clear fines for it.
      authorize(context().principal, 'vehicles:renew');
      try {
        const due = await invokeTool(vehicles.list, {}, context());
        if (!due.length) return { vehicles: [], status: 'complete', reply: 'No vehicle is due for a simulated registration renewal.' };
        const chosen = state.plan.vehicleId ? due.filter(v => v.id === state.plan.vehicleId) : due;
        if (chosen.length !== 1) return { vehicles: due, status: 'clarify', reply: 'Which vehicle should be renewed? Name it and ask again.' };
        return { vehicles: chosen };
      } catch (error) {
        if (error instanceof AgentError && ['PERMISSION_DENIED', 'AUTHORITY_EXPIRED'].includes(error.code)) throw error;
        return { status: 'service_unavailable', reply: 'The vehicles service is unavailable. No payment or renewal was attempted.' };
      }
    })
    .addNode('prepare', state => {
      progress('prepare');
      authorize(context().principal, 'fines:pay');
      const renewing = state.plan.intent === 'renew_registration';
      const ids = renewing ? [] : [...new Set(state.plan.fineIds)];
      const fines = ids.length ? state.fines.filter(f => ids.includes(f.id)) : state.fines;
      if (ids.length && fines.length !== ids.length) return { status: 'invalid_selection', reply: 'One or more requested fines are unavailable. Review outstanding fines again.' };
      if (!fines.length) return { status: 'complete', reply: 'There are no outstanding fines to pay.' };
      const quote = quoteFor(fines);
      const key = digest({ subject: context().principal.subject, operation: 'fines.pay.v1', quote });
      return { pending: { id: randomUUID(), quote, key, expiresAt: Date.now() + approvalTtlMs }, status: 'awaiting_approval', reply: `Review ${quote.fineIds.length} simulated fine(s), total ${aed(quote.amountMinor)}. ${renewing ? 'The registration renewal needs these paid first and asks for its own approval afterwards. ' : ''}Confirm using the approval action.` };
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
        return { receipt, status: 'complete', reply: `Simulated payment completed: ${aed(receipt.quote.amountMinor)}. No real funds were used.` };
      } catch (error) {
        const code = error instanceof AgentError ? error.code : 'PAYMENT_OUTCOME_UNKNOWN';
        await store.finish(pending.key);
        return { status: ['AUTHORITY_EXPIRED', 'PERMISSION_DENIED', 'AUTHORITY_CHANGED', 'CONSENT_REQUIRED_OR_EXPIRED', 'APPROVAL_EXPIRED', 'PROVIDER_DENIED'].includes(code) ? 'denied' : code === 'QUOTE_STALE' ? 'stale' : 'unknown', reply: `Payment not confirmed (${code}). Inspect this interaction; never create a replacement payment for an unknown outcome.` };
      }
    })
    .addNode('renewPrepare', state => {
      progress('renewPrepare');
      const paid = paidSentence(state.receipt);
      try { authorize(context().principal, 'vehicles:renew'); }
      catch (error) {
        // Fines may already be paid: report that truthfully instead of failing the request.
        if (!state.receipt) throw error;
        return { status: 'partial', reply: `${paid}The registration was not renewed (${error instanceof AgentError ? error.code : 'PERMISSION_DENIED'}).` };
      }
      const vehicle = state.vehicles[0];
      if (!vehicle) return { status: state.receipt ? 'partial' : 'complete', reply: `${paid}No vehicle is due for a simulated registration renewal.` };
      const quote = RenewalQuote.parse({ vehicleId: vehicle.id, amountMinor: vehicle.renewalFeeMinor, currency: 'AED', version: vehicle.version });
      const key = digest({ subject: context().principal.subject, operation: 'vehicles.renew.v1', quote });
      return { renewalPending: { id: randomUUID(), quote, key, expiresAt: Date.now() + approvalTtlMs }, status: 'awaiting_approval', reply: `${paid}Review the simulated registration renewal for ${vehicle.description}, fee ${aed(quote.amountMinor)}. Confirm using the approval action.` };
    })
    .addNode('renewApproval', state => {
      progress('renewApproval');
      // No side effects before interrupt: LangGraph re-enters this node on resume.
      const decision = Decision.parse(interrupt({ kind: 'confirm_simulated_renewal', ...state.renewalPending }));
      if (!state.renewalPending || decision.approvalId !== state.renewalPending.id) throw new AgentError('APPROVAL_MISMATCH', 409);
      const paid = paidSentence(state.receipt);
      if (decision.decision !== 'approve') return { renewalDecision: decision, status: state.receipt ? 'partial' : decision.decision === 'cancel' ? 'cancelled' : 'rejected', reply: paid ? `${paid}The registration was not renewed.` : 'The simulated renewal was not executed.' };
      if (state.renewalPending.expiresAt <= Date.now()) return { renewalDecision: decision, status: state.receipt ? 'partial' : 'expired', reply: paid ? `${paid}The renewal approval expired and the registration was not renewed.` : 'This approval expired. Review a new quote before renewing.' };
      return { renewalDecision: decision, status: 'approved' };
    })
    .addNode('renewExecute', async state => {
      progress('renewExecute');
      const pending = state.renewalPending;
      if (!pending || state.renewalDecision?.decision !== 'approve' || state.renewalDecision.approvalId !== pending.id) throw new AgentError('CONSENT_REQUIRED', 403);
      const paid = paidSentence(state.receipt);
      try {
        const ctx = context(), principal = await ctx.revalidate();
        if (principal.subject !== ctx.principal.subject || principal.workload !== ctx.principal.workload) throw new AgentError('AUTHORITY_CHANGED', 403);
        authorize(principal, 'vehicles:renew');
        await store.renewalConsent(pending.id, principal, pending.key, pending.quote, pending.expiresAt);
        await store.verifyRenewalConsent(pending.id, principal, pending.key, pending.quote);
        const prior = await store.renewalOperation(pending.key, principal.subject, pending.quote);
        // Retrying this one provider is safe ONLY because it durably implements this original key.
        const receipt = prior || await invokeTool(vehicles.renew, { quote: pending.quote, consentId: pending.id }, { ...ctx, principal }, pending.key);
        if (receipt.idempotencyKey !== pending.key || digest(receipt.quote) !== digest(pending.quote)) throw new AgentError('RECEIPT_MISMATCH', 502);
        await store.finish(pending.key, receipt);
        return { renewal: receipt, status: 'complete', reply: `${paid}Simulated registration renewal completed: ${aed(receipt.quote.amountMinor)}. No real funds were used.` };
      } catch (error) {
        const code = error instanceof AgentError ? error.code : 'RENEWAL_OUTCOME_UNKNOWN';
        if (REFUSED.includes(code)) return { status: state.receipt ? 'partial' : code === 'QUOTE_STALE' ? 'stale' : 'denied', reply: `${paid}The registration was not renewed (${code}). No renewal was made.` };
        // An unknown outcome blocks any replacement until the same operation is reconciled.
        await store.finish(pending.key);
        return { status: 'unknown', reply: `Renewal not confirmed (${code}). ${paid ? 'The fines payment is complete. ' : ''}Inspect this interaction; never create a replacement renewal for an unknown outcome.` };
      }
    })
    .addNode('respond', state => {
      progress('respond');
      const reply = state.plan.intent === 'clarify' && state.status === 'planned' ? 'Would you like to view outstanding fines, review a simulated payment or renew a vehicle registration?' : state.plan.intent === 'out_of_scope' ? 'This agent currently supports viewing and simulating payment of government fines, and renewing a vehicle registration once they are paid.' : state.plan.intent === 'list_fines' && state.status !== 'service_unavailable' ? `You have ${state.fines.length} outstanding simulated fine(s). Ask to pay selected fines to review a payment.` : state.reply;
      return { reply, messages: [{ role: 'assistant' as const, content: reply }], status: state.status === 'planned' ? 'complete' : state.status };
    })
    .addEdge(START, 'understand')
    .addConditionalEdges('understand', s => s.status === 'model_unavailable' || ['clarify', 'out_of_scope'].includes(s.plan.intent) ? 'respond' : 'list', ['respond', 'list'])
    .addConditionalEdges('list', s => s.status === 'service_unavailable' || s.plan.intent === 'list_fines' ? 'respond' : s.plan.intent === 'renew_registration' ? 'listVehicles' : 'prepare', ['respond', 'listVehicles', 'prepare'])
    .addConditionalEdges('listVehicles', s => s.status !== 'planned' ? 'respond' : s.fines.length ? 'prepare' : 'renewPrepare', ['respond', 'prepare', 'renewPrepare'])
    .addConditionalEdges('prepare', s => s.status === 'awaiting_approval' ? 'approval' : 'respond', ['approval', 'respond'])
    .addConditionalEdges('approval', s => s.status === 'approved' ? 'execute' : 'respond', ['execute', 'respond'])
    .addConditionalEdges('execute', s => s.status === 'complete' && s.plan.intent === 'renew_registration' ? 'renewPrepare' : 'respond', ['renewPrepare', 'respond'])
    .addConditionalEdges('renewPrepare', s => s.status === 'awaiting_approval' ? 'renewApproval' : 'respond', ['renewApproval', 'respond'])
    .addConditionalEdges('renewApproval', s => s.status === 'approved' ? 'renewExecute' : 'respond', ['renewExecute', 'respond'])
    .addEdge('renewExecute', 'respond').addEdge('respond', END)
    .compile({ checkpointer });
  return graph;
}
export type AgentGraph = ReturnType<typeof createGraph>;
