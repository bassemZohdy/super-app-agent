import { enrichCorrelation } from '../../../packages/backend-kit/src/observability.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { AGUISurfacePayload, UIComponentNode } from '../../../packages/protocol-core/src/index.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';

export interface SurfaceApproval {
  id: string;
  revision: string;
  subject: string;
  accountId: string;
  issuedAt: number;
  expiresAt: number;
  digest: string;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (surface: AGUISurfacePayload) => createHash('sha256').update(canonical(surface.view)).digest('hex');

export function hasActionBindings(node: UIComponentNode): boolean {
  return Boolean(node.onEvents?.some(event => event.actionType === 'AGENT_ACTION_DISPATCH') || node.children?.some(hasActionBindings));
}

export function issueApproval(state: SuperAppAgentState) {
  const subject = (state as SuperAppAgentState & { user?: { sub: string } }).user?.sub;
  const surface = state.currentSurface;
  if (!subject || !surface?.revision || !hasActionBindings(surface.view)) { state.approval = undefined; return; }
  state.approval = { id: randomUUID(), revision: surface.revision, subject,
    accountId: state.metadata?.accountId || '', issuedAt: Date.now(), expiresAt: Date.now() + 300000, digest: digest(surface) };
  recordApproval(state, 'offered');
}

/** The reviewed surface is immutable; all advertised parameters must be echoed. */
export function actionIsApproved(state: SuperAppAgentState, action: string, payload: Record<string, unknown>, subject: string, accountId: string) {
  const approval = state.approval, surface = state.currentSurface;
  if (!approval || !surface || approval.subject !== subject || approval.accountId !== accountId ||
      approval.revision !== surface.revision || approval.expiresAt <= Date.now() || digest(surface) !== approval.digest) return false;
  const bindings: Array<{ payload: Record<string, unknown>; choices: string[] }> = [];
  const groups = (node: UIComponentNode): string[][] => [
    ...(node.type === 'ChoiceGroup' ? [(node.properties?.options || []).map((item: { id: string }) => item.id)] : []),
    ...(node.children || []).flatMap(groups),
  ];
  const walk = (node: UIComponentNode, inherited: string[][]) => {
    if (node.type === 'Button' && node.properties?.disabled === true) return;
    const local = groups(node);
    const choices = local.length ? local : inherited;
    for (const event of node.onEvents || []) {
      if (event.actionType === 'AGENT_ACTION_DISPATCH' && event.payload.action === action) {
        if (choices.length > 1) continue; // Ambiguous group binding must be fixed by the surface producer.
        bindings.push({ payload: event.payload, choices: choices[0] || [] });
      }
    }
    for (const child of node.children || []) walk(child, choices);
  };
  walk(surface.view, []);
  return bindings.some(binding => {
    const bound = Object.fromEntries(Object.entries(binding.payload).filter(([key]) => key !== 'action'));
    const supplied = Object.fromEntries(Object.entries(payload).filter(([key]) => !['action', 'selectedChoice'].includes(key)));
    if (canonical(bound) !== canonical(supplied) || (payload.action !== undefined && payload.action !== action)) return false;
    return binding.choices.length ? typeof payload.selectedChoice === 'string' && binding.choices.includes(payload.selectedChoice)
      : payload.selectedChoice === undefined;
  });
}

export function recordApproval(state: SuperAppAgentState, event: 'offered' | 'confirmed' | 'cancelled', action?: string) {
  if (!state.approval) return;
  enrichCorrelation({workflowId:state.sessionId,approvalId:state.approval.id});
  state.approvalHistory = [...(state.approvalHistory || []), { id: state.approval.id, revision: state.approval.revision, at: Date.now(), event, ...(action ? { action } : {}) }].slice(-50);
}
