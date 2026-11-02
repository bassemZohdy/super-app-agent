import test from 'node:test';
import assert from 'node:assert/strict';
import { balance, transactions, policeFines, executeWalletRequest } from '../service-wallet/src/index.ts';
import { activeUtilityBill } from '../service-food/src/index.ts';
import { salikBalance } from '../service-ride/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';

const snapshot = () => JSON.stringify({ balance, transactions, policeFines, activeUtilityBill, salikBalance });

test('offline unified checkout refuses insufficient wallet funds without inventing a card payment', () => {
  const before = snapshot();
  for (const path of ['/pay/unified', '/pay/multi-agency']) {
    const result = executeWalletRequest('POST', path, {}, { items: [{ agency: 'Demo', purpose: 'Review', amount: balance + 1 }] });
    assert.equal(result.status, 400);
    assert.equal(snapshot(), before);
  }
});

test('a refused offline composite payment does not settle other fixtures', async () => {
  const before = snapshot();
  const offlineReview = { billId: activeUtilityBill.billId, billAmountMinor: Math.round(activeUtilityBill.totalAmount * 100),
    fines: policeFines.filter(fine => fine.status === 'UNPAID').map(fine => ({ fineId: fine.fineId, amountMinor: Math.round(fine.payableAmount * 100) })).sort((a, b) => a.fineId.localeCompare(b.fineId)), tagNumber: 'SLK-8492019' };
  await assert.rejects(SuperAppAgentGraph.resumeWithAction({ sessionId: 'funding-test', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview }), { status: 400 });
  assert.equal(snapshot(), before);
});
