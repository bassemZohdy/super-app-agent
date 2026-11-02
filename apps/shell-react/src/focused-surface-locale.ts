import type { UIComponentNode } from '../../../packages/protocol-core/src/ag-ui.ts';
import { formatMoney, translate, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

type Approval = { id: string; quote: { amountMinor: number } };

/** Translate only the known focused review contract; never change a supplied amount or action. */
export function localizeFocusedSurface(view: UIComponentNode, approval: Approval | null, renewal: boolean, locale: Locale): UIComponentNode {
  if (locale !== 'ar' || !approval || view.id !== 'fines-service' || view.type !== 'SurfaceCard' || !view.children) return view;
  const labels = renewal
    ? { approve: ['Confirm simulated renewal', 'fines.confirmRenewal'], reject: ['Reject renewal', 'fines.rejectRenewal'], cancel: ['Cancel review', 'fines.cancelReview'] } as const
    : { approve: ['Confirm simulated payment', 'fines.confirmPayment'], reject: ['Reject payment', 'fines.rejectPayment'], cancel: ['Cancel review', 'fines.cancelReview'] } as const;
  const expectedTotal = `Simulated ${renewal ? 'renewal fee' : 'total'}: AED ${(approval.quote.amountMinor / 100).toFixed(2)}`;
  return { ...view, children: view.children.map(node => {
    if (node.id === 'total' && node.type === 'Text' && node.properties?.text === expectedTotal) {
      return { ...node, properties: { ...node.properties, text: `${translate(locale, renewal ? 'fines.renewalTotal' : 'fines.total')} ${formatMoney(locale, approval.quote.amountMinor)}` } };
    }
    if (node.type !== 'Button' || !['approve', 'reject', 'cancel'].includes(node.id) || node.onEvents?.length !== 1) return node;
    const decision = node.id as keyof typeof labels, event = node.onEvents[0], [expected, key] = labels[decision];
    if (node.properties?.label !== expected || event.event !== 'onPress' || event.actionType !== 'AGENT_ACTION_DISPATCH' || event.payload.action !== 'agent.resume' || event.payload.decision !== decision || event.payload.approvalId !== approval.id) return node;
    return { ...node, properties: { ...node.properties, label: translate(locale, key) } };
  }) };
}
