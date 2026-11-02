import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLIENT_SECRET_VARIABLES } from '../../scripts/realm-client-secrets.ts';

test('qualification preflight failures leave no temporary data or changed process settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'cityside-preflight-test-'));
  const env = { ...process.env, TEMP: root, TMP: root, TMPDIR: root, DEMO_PORT_OFFSET: '100', NODE_ENV: 'preflight-test' };
  for (const { variable } of Object.values(CLIENT_SECRET_VARIABLES)) delete env[variable];
  for (const id of ['provider-rta-settlement', 'provider-dewa-settlement', 'provider-etisalat-settlement', 'provider-du-settlement', 'provider-police-settlement', 'provider-eligibility', 'cityside-verifier', 'provider-settlements', 'service-ride']) env[CLIENT_SECRET_VARIABLES[id].variable] = 'isolated-test-secret';
  delete env.SERVICE_RIDE_URL;
  const script = `
    import assert from 'node:assert/strict';
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const { startEnvironment } = await import('./scripts/e2e/environment.ts');
    await assert.rejects(startEnvironment(), /SERVICE_FOOD_CLIENT_SECRET/);
    assert.equal(process.env.NODE_ENV, 'preflight-test');
    assert.equal(process.env.SERVICE_RIDE_URL, undefined);
  `;
  try {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(readdirSync(root), [], 'no temporary test environment survives a rejected preflight');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
