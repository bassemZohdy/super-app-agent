import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAll, rethrowWithCleanup } from '../../scripts/e2e/cleanup.ts';

test('isolated cleanup attempts every resource even when earlier cleanup fails', async () => {
  const order: string[] = [], redisFailure = new Error('redis cleanup failed'), databaseFailure = new Error('database close failed');
  await assert.rejects(cleanupAll([
    () => { order.push('servers'); },
    async () => { order.push('redis keys'); throw redisFailure; },
    () => { order.push('redis connection'); },
    () => { order.push('database one'); throw databaseFailure; },
    () => { order.push('database two'); },
    () => { order.push('temporary directory'); },
  ]), (error: unknown) => error instanceof AggregateError && error.errors[0] === redisFailure && error.errors[1] === databaseFailure);
  assert.deepEqual(order, ['servers', 'redis keys', 'redis connection', 'database one', 'database two', 'temporary directory']);
});

test('a startup failure remains visible if cleanup also fails', async () => {
  const startup = new Error('startup failed'), cleanup = new Error('cleanup failed');
  await assert.rejects(rethrowWithCleanup(startup, async () => {}), error => error === startup);
  await assert.rejects(rethrowWithCleanup(startup, async () => { throw cleanup; }), error => error instanceof AggregateError && error.errors[0] === startup && error.errors[1] === cleanup);
});
