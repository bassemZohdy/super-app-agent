import { Command } from '@langchain/langgraph';
import { AgentError, Message, Decision, authorize, context, digest } from './contracts.ts';
import type { State, AgentGraph } from './graph.ts';
import type { Store } from './store.ts';
import type { AGUISurfacePayload, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';

export class AgentService {
  readonly graph: AgentGraph; readonly store: Store;
  constructor(graph: AgentGraph, store: Store) { this.graph = graph; this.store = store; }
  private options(id: string) { return { configurable: { thread_id: id }, recursionLimit: 12, durability: 'sync' as const }; }
  async inspect(id: string) {
    const thread = await this.store.checkThread(id, context().principal, true);
    const state = await this.graph.getState(this.options(id));
    const values = state.values as Partial<typeof State.State>;
    const approval = state.next.includes('approval') ? values.pending : null;
    const renewalApproval = state.next.includes('renewApproval') ? values.renewalPending : null;
    const shownFines = (values.fines || []).filter(fine => !approval || approval.quote.fineIds.includes(fine.id));
    const children: UIComponentNode[] = [{ id: 'reply', type: 'Text', properties: { text: values.reply || 'Send a request about outstanding fines.' } }];
    // Fines already paid earlier in a renewal are not shown as outstanding while the renewal waits.
    if (!renewalApproval) children.push({ id: 'fines', type: 'DataTable', properties: { columns: [{ key: 'id', title: 'Fine' }, { key: 'description', title: 'Details' }, { key: 'amount', title: 'Amount (AED)' }], rows: shownFines.map(f => ({ id: f.id, description: f.description, amount: (f.amountMinor / 100).toFixed(2) })) } });
    const decisions = (approvalId: string, labels: { approve: string; reject: string; cancel: string }) => (['approve', 'reject', 'cancel'] as const).map(decision => ({ id: decision, type: 'Button' as const, properties: { label: labels[decision], variant: decision === 'approve' ? 'primary' as const : 'outline' as const }, onEvents: [{ event: 'onPress' as const, actionType: 'AGENT_ACTION_DISPATCH' as const, payload: { action: 'agent.resume', approvalId, decision } }] }));
    if (approval) children.push({ id: 'total', type: 'Text', properties: { text: `Simulated total: AED ${(approval.quote.amountMinor / 100).toFixed(2)}` } }, ...decisions(approval.id, { approve: 'Confirm simulated payment', reject: 'Reject payment', cancel: 'Cancel review' }));
    if (renewalApproval) {
      const vehicles = (values.vehicles || []).filter(vehicle => vehicle.id === renewalApproval.quote.vehicleId);
      children.push({ id: 'vehicles', type: 'DataTable', properties: { columns: [{ key: 'id', title: 'Vehicle' }, { key: 'description', title: 'Details' }, { key: 'fee', title: 'Renewal fee (AED)' }], rows: vehicles.map(v => ({ id: v.id, description: v.description, fee: (v.renewalFeeMinor / 100).toFixed(2) })) } },
        { id: 'total', type: 'Text', properties: { text: `Simulated renewal fee: AED ${(renewalApproval.quote.amountMinor / 100).toFixed(2)}` } },
        ...decisions(renewalApproval.id, { approve: 'Confirm simulated renewal', reject: 'Reject renewal', cancel: 'Cancel review' }));
    }
    const surface: AGUISurfacePayload = { version: '1.0.0', sessionId: id, revision: approval?.id ?? renewalApproval?.id, timestamp: Date.now(), view: { id: 'fines-service', type: 'SurfaceCard', children } };
    return { threadId: id, status: thread.cancelled ? 'cancelled' : values.status || 'new', reply: values.reply || '', messages: values.messages || [], fines: values.fines || [], receipt: values.receipt || null, approval, vehicles: values.vehicles || [], renewal: values.renewal || null, renewalApproval: renewalApproval || null, next: state.next, uiContract: 'cityside-compat-v1', surface };
  }
  async transition(id: string, requestId: string, action: 'message' | 'resume' | 'recover' | 'cancel', body: unknown) {
    return this.store.exclusive(id, async () => {
      const ctx = context(); authorize(ctx.principal, 'fines:read');
      await this.store.checkThread(id, ctx.principal, true);
      const fingerprint = digest({ action, body });
      const prior = this.store.request(id, requestId);
      if (prior && prior.fingerprint !== fingerprint) throw new AgentError('REQUEST_ID_CONFLICT', 409);
      if (prior?.response) return prior.response;
      await this.store.checkThread(id, ctx.principal);
      const state = await this.graph.getState(this.options(id));
      const values = state.values as Partial<typeof State.State>;
      if (action === 'message') {
        const message = Message.parse(body);
        if (state.next.length || values.status === 'unknown') throw new AgentError('PENDING_INTERACTION', 409);
        if (prior) throw new AgentError('RECOVERY_REQUIRED', 409);
        this.store.saveRequest(id, requestId, fingerprint);
        await this.graph.invoke({ messages: [{ role: 'user', content: message }], reply: '', status: 'new', receipt: null, pending: null, decision: null, renewalPending: null, renewalDecision: null, renewal: null }, this.options(id));
      } else if (action === 'resume') {
        const decision = Decision.parse(body);
        // Two approvals can exist in one journey; only the one the graph is waiting on can be answered.
        const answersFines = values.pending?.id === decision.approvalId && state.next.includes('approval');
        const answersRenewal = values.renewalPending?.id === decision.approvalId && state.next.includes('renewApproval');
        if (!answersFines && !answersRenewal) throw new AgentError('APPROVAL_MISMATCH', 409);
        await this.graph.invoke(new Command({ resume: decision }), this.options(id));
      } else if (action === 'cancel') {
        if (values.status === 'unknown' || values.status === 'approved') throw new AgentError('RECONCILIATION_REQUIRED', 409);
        if (state.next.includes('approval') && values.pending) await this.graph.invoke(new Command({ resume: { approvalId: values.pending.id, decision: 'cancel' } }), this.options(id));
        else if (state.next.includes('renewApproval') && values.renewalPending) await this.graph.invoke(new Command({ resume: { approvalId: values.renewalPending.id, decision: 'cancel' } }), this.options(id));
        this.store.cancelThread(id);
      } else {
        // Native continuation after a failed node, or reconcile ONLY the same persisted approved operation.
        if (state.next.includes('approval') || state.next.includes('renewApproval')) return this.inspect(id);
        if (values.status === 'unknown' && values.renewalPending && values.renewalDecision?.decision === 'approve') {
          await this.graph.updateState(this.options(id), { status: 'approved' }, 'renewApproval');
          await this.graph.invoke(null, this.options(id));
        } else if (values.status === 'unknown' && values.pending && values.decision?.decision === 'approve') {
          await this.graph.updateState(this.options(id), { status: 'approved' }, 'approval');
          await this.graph.invoke(null, this.options(id));
        } else if (state.next.length) await this.graph.invoke(null, this.options(id));
      }
      const result = await this.inspect(id);
      this.store.saveRequest(id, requestId, fingerprint, result);
      return result;
    });
  }
}
