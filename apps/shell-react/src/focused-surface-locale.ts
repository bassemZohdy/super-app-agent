import type { UIComponentNode } from '../../../packages/protocol-core/src/ag-ui.ts';
import { formatMoney, translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

type Approval = { id: string; quote: { amountMinor: number } };

const replies: Record<string, CatalogKey> = {
  'The simulated payment was not executed.': 'fines.replyNoPayment',
  'This approval expired. Review a new quote before paying.': 'fines.replyExpiredPayment',
  'The simulated renewal was not executed.': 'fines.replyNoRenewal',
  'This approval expired. Review a new quote before renewing.': 'fines.replyExpiredRenewal',
  'There are no outstanding fines to pay.': 'fines.replyNoFines',
  'No vehicle is due for a simulated registration renewal.': 'fines.replyNoVehicle',
  'Which vehicle should be renewed? Name it and ask again.': 'fines.replyChooseVehicle',
  'Please name one vehicle to renew and ask again.': 'fines.replyOneVehicle',
  'The fines service is unavailable. No payment was attempted.': 'fines.replyUnavailable',
  'The vehicles service is unavailable. No payment or renewal was attempted.': 'fines.replyVehicleUnavailable',
  'The planning provider is unavailable or returned an invalid plan. No operation ran.': 'fines.replyModelUnavailable',
  'One or more requested fines are unavailable. Review outstanding fines again.': 'fines.replyInvalidFines',
  'A previous operation is not confirmed. Inspect and recover the original interaction before starting another.': 'fines.replyReconcile',
};

/** Exact matches only: never rewrite unknown text, operation identifiers or partial outcomes. */
export function localizeFocusedReply(text: string, locale: Locale): string {
  return locale === 'ar' && Object.prototype.hasOwnProperty.call(replies, text) ? translate(locale, replies[text]) : text;
}

/** Translate only known focused surface labels; never change supplied rows, amounts or actions. */
export function localizeFocusedSurface(view: UIComponentNode, approval: Approval | null, renewal: boolean, locale: Locale): UIComponentNode {
  if (locale !== 'ar' || view.id !== 'fines-service' || view.type !== 'SurfaceCard' || !view.children) return view;
  const labels = renewal
    ? { approve: ['Confirm simulated renewal', 'fines.confirmRenewal'], reject: ['Reject renewal', 'fines.rejectRenewal'], cancel: ['Cancel review', 'fines.cancelReview'] } as const
    : { approve: ['Confirm simulated payment', 'fines.confirmPayment'], reject: ['Reject payment', 'fines.rejectPayment'], cancel: ['Cancel review', 'fines.cancelReview'] } as const;
  const expectedTotal = approval ? `Simulated ${renewal ? 'renewal fee' : 'total'}: AED ${(approval.quote.amountMinor / 100).toFixed(2)}` : undefined;
  return { ...view, children: view.children.map(node => {
    if (node.id === 'reply' && node.type === 'Text' && typeof node.properties?.text === 'string') {
      const text = localizeFocusedReply(node.properties.text, locale);
      return text === node.properties.text ? node : { ...node, properties: { ...node.properties, text } };
    }
    if (node.type === 'DataTable' && (node.id === 'fines' || node.id === 'vehicles')) {
      const expected = node.id === 'fines'
        ? [['id', 'Fine', 'fines.colFine'], ['description', 'Details', 'fines.colDetails'], ['amount', 'Amount (AED)', 'fines.colAmountAED']] as const
        : [['id', 'Vehicle', 'fines.colVehicle'], ['description', 'Details', 'fines.colDetails'], ['fee', 'Renewal fee (AED)', 'fines.colRenewalFee']] as const;
      const columns = node.properties?.columns;
      if (columns?.length === expected.length && columns.every((column, index) => column.key === expected[index][0] && column.title === expected[index][1])) {
        return { ...node, properties: { ...node.properties, columns: columns.map((column, index) => ({ ...column, title: translate(locale, expected[index][2]) })) } };
      }
      return node;
    }
    if (!approval) return node;
    if (node.id === 'total' && node.type === 'Text' && node.properties?.text === expectedTotal) {
      return { ...node, properties: { ...node.properties, text: `${translate(locale, renewal ? 'fines.renewalTotal' : 'fines.total')} ${formatMoney(locale, approval.quote.amountMinor)}` } };
    }
    if (node.type !== 'Button' || !['approve', 'reject', 'cancel'].includes(node.id) || node.onEvents?.length !== 1) return node;
    const decision = node.id as keyof typeof labels, event = node.onEvents[0], [expected, key] = labels[decision];
    if (node.properties?.label !== expected || event.event !== 'onPress' || event.actionType !== 'AGENT_ACTION_DISPATCH' || event.payload.action !== 'agent.resume' || event.payload.decision !== decision || event.payload.approvalId !== approval.id) return node;
    return { ...node, properties: { ...node.properties, label: translate(locale, key) } };
  }) };
}
