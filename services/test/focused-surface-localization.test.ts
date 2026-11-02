import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeFocusedSurface } from '../../apps/shell-react/src/focused-surface-locale.ts';
import type { UIComponentNode } from '../../packages/protocol-core/src/ag-ui.ts';

test('Arabic review translates only the matching display contract and preserves every action and amount', () => {
  const approval = { id: 'approval-1', quote: { amountMinor: 15000 } };
  const original: UIComponentNode = { id: 'fines-service', type: 'SurfaceCard', children: [
    { id: 'total', type: 'Text', properties: { text: 'Simulated total: AED 150.00' } },
    { id: 'approve', type: 'Button', properties: { label: 'Confirm simulated payment' }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'agent.resume', decision: 'approve', approvalId: approval.id } }] },
  ] };
  const before = structuredClone(original), view = localizeFocusedSurface(original, approval, false, 'ar');
  assert.deepEqual(original, before);
  assert.equal(view.children?.[1].properties?.label, 'تأكيد الدفع التجريبي');
  assert.deepEqual(view.children?.[1].onEvents, original.children?.[1].onEvents);
  assert.match(view.children?.[0].properties?.text || '', /الإجمالي التجريبي/);
  const changed = structuredClone(original); changed.children![0].properties!.text = 'Simulated total: AED 999.00';
  changed.children![1].onEvents![0].payload.approvalId = 'other';
  const unsafe = localizeFocusedSurface(changed, approval, false, 'ar');
  assert.deepEqual(unsafe, changed);
  assert.equal(localizeFocusedSurface(original, approval, false, 'en'), original);
});

test('renewal labels keep the original approval identity and reject altered bindings', () => {
  const approval = { id: 'renewal-1', quote: { amountMinor: 40000 } };
  const view: UIComponentNode = { id: 'fines-service', type: 'SurfaceCard', children: [
    { id: 'total', type: 'Text', properties: { text: 'Simulated renewal fee: AED 400.00' } },
    { id: 'approve', type: 'Button', properties: { label: 'Confirm simulated renewal' }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'agent.resume', decision: 'approve', approvalId: approval.id } }] },
  ] };
  const translated = localizeFocusedSurface(view, approval, true, 'ar');
  assert.match(translated.children?.[0].properties?.text || '', /رسوم التجديد التجريبية/);
  assert.equal(translated.children?.[1].properties?.label, 'تأكيد التجديد التجريبي');
  assert.deepEqual(translated.children?.[1].onEvents, view.children?.[1].onEvents);
  const altered = structuredClone(view); altered.children![1].onEvents![0].payload.decision = 'reject';
  assert.equal(localizeFocusedSurface(altered, approval, true, 'ar').children?.[1].properties?.label, 'Confirm simulated renewal');
});

test('Arabic table headers change only for the known column contracts and keep every row intact', () => {
  const fines: UIComponentNode = { id: 'fines', type: 'DataTable', properties: { columns: [{ key: 'id', title: 'Fine' }, { key: 'description', title: 'Details' }, { key: 'amount', title: 'Amount (AED)' }], rows: [{ id: 'fine-1', description: 'Speeding', amount: '150.00' }] } };
  const vehicles: UIComponentNode = { id: 'vehicles', type: 'DataTable', properties: { columns: [{ key: 'id', title: 'Vehicle' }, { key: 'description', title: 'Details' }, { key: 'fee', title: 'Renewal fee (AED)' }], rows: [{ id: 'vehicle-1', description: 'Car', fee: '400.00' }] } };
  const view: UIComponentNode = { id: 'fines-service', type: 'SurfaceCard', children: [fines, vehicles] };
  const before = structuredClone(view), localized = localizeFocusedSurface(view, null, false, 'ar');
  assert.deepEqual(view, before);
  assert.deepEqual(localized.children?.[0].properties?.columns?.map(column => column.title), ['المخالفة', 'التفاصيل', 'المبلغ (درهم)']);
  assert.deepEqual(localized.children?.[1].properties?.columns?.map(column => column.title), ['المركبة', 'التفاصيل', 'رسوم التجديد (درهم)']);
  assert.deepEqual(localized.children?.map(node => node.properties?.rows), [fines.properties?.rows, vehicles.properties?.rows]);
  const altered = structuredClone(view); altered.children![0].properties!.columns![2].title = 'Amount (USD)';
  assert.deepEqual(localizeFocusedSurface(altered, null, false, 'ar').children?.[0], altered.children![0]);
});
