import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';

test('competing application processes persist one integrated food order for the same operation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'food-process-race-'));
  t.after(() => removeTemp(dir));
  const script = `
    import { actorFor } from './packages/backend-kit/src/context.ts';
    import { integratedRequest } from './packages/backend-kit/src/application.ts';
    const actor = actorFor({ sub: 'food-process-owner' }); actor.requestId = 'same-review:food';
    process.stdout.write('READY\\n');
    await new Promise(resolve => process.stdin.once('data', resolve));
    const body = { restaurantId: 'rest_1', items: ['item_diavola'], deliveryAddress: 'Test delivery address', expectedAmountMinor: 2099, expectedItemPriceMinor: 1800, expectedDeliveryFeeMinor: 299 };
    const result = await integratedRequest('service-food', actor, 'POST', '/orders/create', {}, body, () => ({ status: 404, data: {} }));
    process.stdout.write(JSON.stringify({ status: result.status, orderId: result.data.order?.orderId, code: result.data.code }));
  `;
  const children = Array.from({ length: 3 }, () => spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, APP_DATA_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] }));
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
  const outputs = children.map(child => {
    let output = '', errors = '';
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('READY\n')) resolve(); });
      child.once('error', reject);
      child.once('exit', code => { if (!output.includes('READY\n')) reject(new Error(`Child failed before ready (${code})`)); });
    });
    child.stderr.on('data', chunk => { errors += String(chunk); });
    const done = new Promise<string>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve(output.slice(output.indexOf('READY\n') + 6)) : reject(new Error(`Child failed (${code}): ${errors.slice(-1000)}`)));
    });
    return { ready, done };
  });
  await Promise.all(outputs.map(output => output.ready));
  for (const child of children) child.stdin.end('go');
  const results = (await Promise.all(outputs.map(output => output.done))).map(output => JSON.parse(output) as { status: number; orderId?: string });
  assert.ok(results.every(result => result.status === 200 && typeof result.orderId === 'string'));
  assert.equal(new Set(results.map(result => result.orderId)).size, 1);
  const db = new AccountDatabase(join(dir, 'service-food.sqlite')); t.after(() => db.close());
  assert.equal(db.list(actorFor({ sub: 'food-process-owner' }).accountId, 'order').length, 1);
});
