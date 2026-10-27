import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

test('renewal demo enrollment adds a separate local persona without widening an existing identity or replacing configuration', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-demo-identity-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, '.env.agent');
  const original = { token: 'synthetic-existing-reader-token-value', subject: 'original-reader', permissions: ['fines:read'], expiresAt: Date.now() + 60000 };
  writeFileSync(file, `AGENT_AUTH=test\nAGENT_PLANNER=compatible\nAGENT_LLM_PROVIDER=litellm\nAGENT_TEST_IDENTITIES='${JSON.stringify([original])}'\n`, { mode: 0o600 });
  const run = () => execFileSync(process.execPath, ['--experimental-strip-types', resolve('scripts/init-simple-agent.ts'), '--renewal-demo'], { cwd: dir, encoding: 'utf8' });
  const output = run(); const values = parseEnv(readFileSync(file, 'utf8')); const identities = JSON.parse(values.AGENT_TEST_IDENTITIES);
  assert.deepEqual(identities[0], original); assert.equal(identities.length, 2);
  assert.deepEqual(identities[1].permissions, ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew']);
  assert.equal(values.AGENT_LLM_PROVIDER, 'litellm'); assert.equal(values.AGENT_PLANNER, 'compatible');
  assert.ok(!output.includes(identities[1].token));
  run(); assert.equal(JSON.parse(parseEnv(readFileSync(file, 'utf8')).AGENT_TEST_IDENTITIES).length, 2);
});
