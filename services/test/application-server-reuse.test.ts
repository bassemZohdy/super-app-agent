import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { createApplicationServer, integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

test('a reused application server closes its database after every server lifetime', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'application-server-reuse-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  const closes = t.mock.method(AccountDatabase.prototype, 'close');
  const legacy = () => ({ status: 200, data: { success: true } });
  const server = createApplicationServer('service-food', legacy), actor = actorFor({ sub: 'server-reuse-test' });
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  for (let index = 0; index < 2; index++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    assert.equal((await integratedRequest('service-food', actor, 'GET', '/restaurants/search', {}, {}, legacy)).status, 200);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  assert.equal(closes.mock.callCount(), 2);
});
