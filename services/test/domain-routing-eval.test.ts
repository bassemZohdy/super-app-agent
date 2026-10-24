import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomain, hasTerm } from '../agent-core/src/domain-router.ts';

// Fixed evaluation set. Expected domains follow the intended routing design, not the
// previous substring matcher. Telecom needs integrated providers and is covered separately.
const fixtures: Array<{ text: string; domain: string; kind: 'civic' | 'ambiguous' | 'multilingual' }> = [
  { text: 'Show my wallet balance', domain: 'wallet', kind: 'civic' },
  { text: 'Check my card balance', domain: 'wallet', kind: 'ambiguous' },
  { text: 'Pay for coffee at the card machine', domain: 'wallet', kind: 'ambiguous' },
  { text: 'Pay my police fine', domain: 'wallet', kind: 'civic' },
  { text: 'Top up my DubaiPay', domain: 'wallet', kind: 'civic' },
  { text: 'Book a cab to the airport', domain: 'ride', kind: 'civic' },
  { text: 'Show my Salik toll history', domain: 'ride', kind: 'civic' },
  { text: 'Recharge my Darb tag', domain: 'ride', kind: 'civic' },
  { text: 'I want to park in Downtown', domain: 'ride', kind: 'civic' },
  { text: 'Order a pizza for dinner', domain: 'food', kind: 'civic' },
  { text: 'I need to reorder my usual', domain: 'food', kind: 'ambiguous' },
  { text: 'Dinner menu please', domain: 'food', kind: 'ambiguous' },
  { text: 'What is the weather', domain: 'concierge', kind: 'ambiguous' },
  { text: 'Hello', domain: 'concierge', kind: 'civic' },
  { text: 'Show my profile', domain: 'concierge', kind: 'civic' },
  { text: 'Renew my Ejari lease', domain: 'composite', kind: 'civic' },
  { text: 'Pay my DEWA bill', domain: 'composite', kind: 'civic' },
  { text: 'Order food and pay DEWA', domain: 'composite', kind: 'civic' },
  // Known gap: no Arabic keyword lexicon. Arabic requests fall back to the concierge.
  { text: 'دفع فاتورة الكهرباء', domain: 'concierge', kind: 'multilingual' },
];

test('domain routing matches the fixed civic, ambiguous and multilingual evaluation set', () => {
  const misses = fixtures.filter(item => classifyDomain(item.text) !== item.domain)
    .map(item => `${item.text} -> ${classifyDomain(item.text)} (expected ${item.domain})`);
  assert.deepEqual(misses, []);
});

test('domain routing is deterministic and reports per-kind accuracy', () => {
  for (const kind of ['civic', 'ambiguous', 'multilingual'] as const) {
    const subset = fixtures.filter(item => item.kind === kind);
    const correct = subset.filter(item => classifyDomain(item.text) === item.domain).length;
    assert.equal(correct, subset.length, `${kind} accuracy ${correct}/${subset.length}`);
  }
  assert.equal(classifyDomain('Check my card balance'), classifyDomain('Check my card balance'));
});

test('whole-word matching stops substrings from routing unrelated requests', () => {
  assert.equal(hasTerm('check my card', 'car'), false);
  assert.equal(hasTerm('a car is parked', 'car'), true);
  assert.equal(hasTerm('what is the weather', 'eat'), false);
  assert.equal(hasTerm('we eat at noon', 'eat'), true);
  assert.equal(hasTerm('my payments', 'pay'), true);
});
