import test from 'node:test';
import assert from 'node:assert/strict';
import { closeRedisConnections } from '../agent-core/src/redis-close.ts';

test('Redis shutdown closes independent connections and bounds an unresponsive quit', async () => {
  const events: string[] = [];
  const stuck = { isOpen: true, isReady: true, quit: async () => { events.push('stuck quit'); return await new Promise<never>(() => {}); }, destroy: () => { events.push('stuck destroyed'); } };
  const healthy = { isOpen: true, isReady: true, quit: async () => { events.push('healthy quit'); return 'OK'; }, destroy: () => { events.push('healthy destroyed'); } };
  await assert.rejects(closeRedisConnections([stuck, healthy], 20), (error: unknown) => error instanceof AggregateError && error.errors.length === 1);
  assert.deepEqual(events, ['stuck quit', 'healthy quit', 'stuck destroyed']);
});

test('Redis shutdown destroys disconnected clients and continues after a quit error', async () => {
  const events: string[] = [];
  const offline = { isOpen: true, isReady: false, quit: async () => { events.push('unexpected quit'); }, destroy: () => { events.push('offline destroyed'); } };
  const failed = { isOpen: true, isReady: true, quit: async () => { events.push('failed quit'); throw new Error('sensitive downstream text'); }, destroy: () => { events.push('failed destroyed'); } };
  const healthy = { isOpen: true, isReady: true, quit: async () => { events.push('healthy quit'); }, destroy: () => { events.push('unexpected destroy'); } };
  await assert.rejects(closeRedisConnections([offline, failed, healthy], 20), (error: unknown) => error instanceof AggregateError && !String(error.errors[0]).includes('sensitive downstream text'));
  assert.deepEqual(events, ['offline destroyed', 'failed quit', 'healthy quit', 'failed destroyed']);
});
