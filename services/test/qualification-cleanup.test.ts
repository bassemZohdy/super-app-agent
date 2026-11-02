import test from 'node:test';
import assert from 'node:assert/strict';
import { withQualificationCleanup } from '../../scripts/qualification-cleanup.ts';

test('qualification cleanup runs after success and failure without hiding either error', async () => {
  const calls: string[] = [];
  assert.equal(await withQualificationCleanup(async () => { calls.push('run'); return 42; }, async () => { calls.push('cleanup'); }), 42);
  assert.deepEqual(calls, ['run', 'cleanup']);
  const runError = new Error('run failed'), cleanupError = new Error('cleanup failed');
  calls.length = 0;
  await assert.rejects(withQualificationCleanup(async () => { calls.push('run'); throw runError; }, async () => { calls.push('cleanup'); }), error => error === runError);
  assert.deepEqual(calls, ['run', 'cleanup']);
  await assert.rejects(withQualificationCleanup(async () => { throw runError; }, async () => { throw cleanupError; }), error => error instanceof AggregateError && error.errors[0] === runError && error.errors[1] === cleanupError);
  await assert.rejects(withQualificationCleanup(async () => 42, async () => { throw cleanupError; }), error => error === cleanupError);
});
