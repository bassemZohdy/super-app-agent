import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionAllows } from '../provider-simulator/src/automation-session.ts';

const op = { accountId: 'acct_1', payableId: 'dewa:bill:b1', executionId: 'autoexec_1' };
const gateway = () => ({ orderId: 'order_1', paymentId: 'payment_1' });
const source = (method: string, path: string, account = 'acct_1') => sessionAllows('dewa', account, method, path, op);
const hub = (method: string, path: string) => sessionAllows('payments', 'acct_1', method, path, op, gateway);

test('AUTO-03 3b: a source provider session covers only the one payable and its admission chain', () => {
  const base = '/payables/dewa%3Abill%3Ab1';
  for (const [method, path] of [['GET', base], ['POST', `${base}/admissions`], ['GET', `${base}/admissions/a1`], ['POST', `${base}/admissions/a1/admit`], ['POST', `${base}/admissions/a1/payments`], ['POST', `${base}/admissions/a1/finish`], ['POST', `${base}/admissions/a1/cancel`]])
    assert.equal(source(method, path), true, `${method} ${path}`);
  for (const [method, path] of [['POST', base], ['GET', '/payables/dewa%3Abill%3Aother'], ['POST', '/payables/dewa%3Abill%3Aother/admissions'], ['GET', '/bills'], ['POST', `${base}/admissions/a1/refund`], ['GET', '/payables']])
    assert.equal(source(method, path), false, `${method} ${path}`);
  assert.equal(source('GET', base, 'acct_other'), false, 'another workspace is never covered');
});

test('AUTO-03 3b: the gateway session reads only its own order and charge', () => {
  assert.equal(hub('GET', '/payment-orders/order_1'), true);
  assert.equal(hub('GET', '/charges/payment_1'), true);
  for (const [method, path] of [['GET', '/payment-orders/order_2'], ['GET', '/charges/payment_2'], ['GET', '/payment-orders'], ['POST', '/payment-orders/order_1/approve'], ['POST', '/payment-orders/order_1/execute'], ['GET', '/wallet'], ['GET', '/payment-mandates']])
    assert.equal(hub(method, path), false, `${method} ${path}`);
  assert.equal(sessionAllows('payments', 'acct_1', 'GET', '/payment-orders/order_1', op), false, 'no known order, no access');
});
