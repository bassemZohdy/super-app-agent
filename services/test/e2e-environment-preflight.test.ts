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


test('failed isolated startup restores only the environment variables it changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'cityside-startup-restore-'));
  const env = { ...process.env, TEMP: root, TMP: root, TMPDIR: root, DEMO_PORT_OFFSET: '0', NODE_ENV: 'original-environment', SERVICE_RIDE_URL: 'http://original.invalid', E2E_APP_PORT: '3002' };
  delete env.PROVIDER_RTA_CLAIM_SECRET;
  const script = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    let blocker, port;
    for (let candidate = 31001; candidate < 31101; candidate++) {
      const server = net.createServer();
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(candidate, '127.0.0.1', resolve); }); blocker = server; port = candidate; break; } catch {}
    }
    assert.ok(blocker && port, 'a local test port is available');
    process.env.E2E_CORE_PORT = String(port - 101);
    const { startEnvironment } = await import('./scripts/e2e/environment.ts');
    try {
      await assert.rejects(startEnvironment(), /EADDRINUSE/);
      assert.equal(process.env.NODE_ENV, 'original-environment');
      assert.equal(process.env.SERVICE_RIDE_URL, 'http://original.invalid');
      assert.equal(process.env.PROVIDER_RTA_CLAIM_SECRET, undefined);
      assert.equal(process.env.E2E_CORE_PORT, String(port - 101));
    } finally { await new Promise(resolve => blocker.close(resolve)); }
  `;
  try {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(readdirSync(root), [], 'failed startup removes its temporary data');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
