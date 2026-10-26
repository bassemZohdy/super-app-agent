import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_DEFAULTS, delegationAuthorityUrl, delegationIssuer, mcpEndpoint, paymentsUrl } from '../../packages/backend-kit/src/local-endpoints.ts';

test('P2-06: the local defaults are the usual demo addresses, and an environment value always wins', () => {
  assert.equal(paymentsUrl({}), 'http://localhost:4107');
  assert.equal(delegationAuthorityUrl({}), 'http://localhost:4010');
  assert.equal(delegationIssuer({}), 'http://localhost:4000/api/delegation');
  assert.equal(mcpEndpoint({}), 'http://localhost:4000/mcp');
  assert.equal(paymentsUrl({ PROVIDER_PAYMENTS_URL: 'http://payments.internal:9' }), 'http://payments.internal:9');
  assert.equal(paymentsUrl({ PROVIDER_PAYMENTS_URL: '' }), 'http://localhost:4107', 'an empty value is unset');
  const before = process.env.PROVIDER_PAYMENTS_URL;
  process.env.PROVIDER_PAYMENTS_URL = 'http://changed.test';
  try { assert.equal(paymentsUrl(), 'http://changed.test', 'read at call time, not at import'); } finally { if (before === undefined) delete process.env.PROVIDER_PAYMENTS_URL; else process.env.PROVIDER_PAYMENTS_URL = before; }
});

test('P2-06: no service or package repeats these defaults; they come from one place', () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { if (['node_modules', 'dist', 'test'].includes(name)) continue; const full = join(dir, name); if (statSync(full).isDirectory()) walk(full); else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(full); } };
  for (const root of ['services', 'packages']) walk(root);
  const offenders = files.filter(file => !file.replaceAll('\\', '/').endsWith('backend-kit/src/local-endpoints.ts'))
    .filter(file => Object.values(LOCAL_DEFAULTS).some(value => readFileSync(file, 'utf8').includes(`'${value}'`)));
  assert.deepEqual(offenders, []);
});
