import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireModelBudget, boundedMessages } from '../agent-core/src/model-budget.ts';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';

test('model context is bounded in UTF-8 bytes and preserves the latest request', () => {
  const output = boundedMessages([{ role: 'system', content: 'قواعد'.repeat(10000) },
    ...Array.from({ length: 20 }, () => ({ role: 'assistant', content: '界'.repeat(10000) })),
    { role: 'user', content: 'latest request' }]);
  assert.ok(output.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0) <= 24000);
  assert.equal(output.at(-1)?.content, 'latest request');
  assert.ok(output.length <= 13);
});

test('model request budgets limit each citizen/account and permit another account independently', () => {
  actorContext.run(actorFor({ sub: 'model-budget-user' }), () => {
    const a = acquireModelBudget(), b = acquireModelBudget();
    assert.throws(acquireModelBudget, /budget/); a(); b();
    for (let i = 0; i < 28; i++) acquireModelBudget()();
    assert.throws(acquireModelBudget, /budget/);
  });
  actorContext.run(actorFor({ sub: 'model-budget-other-user' }), () => acquireModelBudget()());
});
