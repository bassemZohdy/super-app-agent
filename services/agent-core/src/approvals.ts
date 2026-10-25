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
  const bindings: Array<{ payload: Record<string, unknown>; groups: Array<{ id: string; options: string[] }> }> = [];
  const collect = (node: UIComponentNode): Array<{ id: string; options: string[] }> => [
    ...(node.type === 'ChoiceGroup' ? [{ id: node.id, options: (node.properties?.options || []).map((item: { id: string }) => item.id) }] : []),
    ...(node.children || []).flatMap(collect),
  ];
  const walk = (node: UIComponentNode, inherited: Array<{ id: string; options: string[] }>) => {
    if (node.type === 'Button' && node.properties?.disabled === true) return;
    const local = collect(node);
    const scope = local.length ? local : inherited;
    for (const event of node.onEvents || []) {
      if (event.actionType === 'AGENT_ACTION_DISPATCH' && event.payload.action === action) {
        bindings.push({ payload: event.payload, groups: scope });
      }
    }
    for (const child of node.children || []) walk(child, scope);
  };
  walk(surface.view, []);
  return bindings.some(binding => {
    const bound = Object.fromEntries(Object.entries(binding.payload).filter(([key]) => key !== 'action'));
    const supplied = Object.fromEntries(Object.entries(payload).filter(([key]) => !['action', 'selectedChoice', 'selectedChoices'].includes(key)));
    if (canonical(bound) !== canonical(supplied) || (payload.action !== undefined && payload.action !== action)) return false;
    const groups = binding.groups.filter(group => group.options.length > 0);
    if (groups.length === 0) return payload.selectedChoice === undefined && payload.selectedChoices === undefined;
    if (groups.length === 1) {
      return payload.selectedChoices === undefined && typeof payload.selectedChoice === 'string' && groups[0].options.includes(payload.selectedChoice);
    }
    const selected = payload.selectedChoices;
    if (payload.selectedChoice !== undefined || !selected || typeof selected !== 'object' || Array.isArray(selected)) return false;
    const expected = groups.map(group => group.id).sort();
    const keys = Object.keys(selected).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]
      && typeof selected[key] === 'string' && groups.find(group => group.id === key)!.options.includes(selected[key]));
  });
}

/** True when the dispatched action is advertised only by disabled buttons of the current surface. */
export function actionIsDisabled(state: SuperAppAgentState, action: string): boolean {
  const surface = state.currentSurface;
  if (!surface) return false;
  let disabled = false;
  const walk = (node: UIComponentNode) => {
    if (node.type === 'Button' && node.properties?.disabled === true) {
      if (node.onEvents?.some(event => event.actionType === 'AGENT_ACTION_DISPATCH' && event.payload.action === action)) disabled = true;
    }
    node.children?.forEach(walk);
  };
  walk(surface.view);
  return disabled;
}

export function recordApproval(state: SuperAppAgentState, event: 'offered' | 'confirmed' | 'cancelled', action?: string) {
  if (!state.approval) return;
  enrichCorrelation({workflowId:state.sessionId,approvalId:state.approval.id});
  state.approvalHistory = [...(state.approvalHistory || []), { id: state.approval.id, revision: state.approval.revision, at: Date.now(), event, ...(action ? { action } : {}) }].slice(-50);
}
