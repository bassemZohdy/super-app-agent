import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { artifactRoots } from '../../test/browser/artifact-roots.ts';
import { isLocalRequest } from '../../test/browser/external-hosts.ts';

test('QA-09: two suites write to disjoint sibling artifact roots so they can run side by side', () => {
  const a = artifactRoots('interactive', '/tmp/e2e'), b = artifactRoots('qualification', '/tmp/e2e');
  assert.notEqual(a.root, b.root);
  for (const key of ['root', 'results', 'report'] as const) assert.equal(a[key].startsWith(b.root), false, key);
  assert.deepEqual([a.results, a.report], [join(resolve('/tmp/e2e'), 'interactive', 'results'), join(resolve('/tmp/e2e'), 'interactive', 'report')]);
});

test('QA-09: the suite label is a short lowercase name and cannot climb out of the artifact base', () => {
  for (const bad of ['', '..', '../x', 'A', 'a/b', 'a b', 'x'.repeat(41), '-lead', '1lead']) assert.throws(() => artifactRoots(bad, '/tmp/e2e'), /lowercase label/, JSON.stringify(bad));
  assert.ok(artifactRoots('x'.repeat(40), '/tmp/e2e').root.endsWith('x'.repeat(40)));
});

test('QA-09: the defaults come from the environment and fall back to .data/e2e-artifacts/browser', t => {
  const saved = { suite: process.env.E2E_SUITE, base: process.env.E2E_ARTIFACT_ROOT };
  t.after(() => { for (const [key, value] of [['E2E_SUITE', saved.suite], ['E2E_ARTIFACT_ROOT', saved.base]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  delete process.env.E2E_SUITE; delete process.env.E2E_ARTIFACT_ROOT;
  assert.equal(artifactRoots().root, resolve('.data', 'e2e-artifacts', 'browser'));
  process.env.E2E_SUITE = 'nightly'; process.env.E2E_ARTIFACT_ROOT = '/tmp/elsewhere';
  assert.equal(artifactRoots().root, join(resolve('/tmp/elsewhere'), 'nightly'));
});

test('QA-09: only this machine is reachable from a journey', () => {
  for (const local of ['http://localhost:5173/', 'http://127.0.0.1:4000/x', 'https://localhost/', 'ws://127.0.0.1:8085/', 'http://[::1]:3000/', 'data:text/plain,hi', 'blob:http://localhost/abc', 'about:blank'])
    assert.equal(isLocalRequest(new URL(local)), true, local);
  for (const external of ['https://fonts.googleapis.com/css', 'http://example.com/', 'https://cdn.jsdelivr.net/x', 'http://localhost.evil.test/', 'http://127.0.0.1.evil.test/', 'http://192.168.1.10/', 'wss://stream.example/', 'http://0.0.0.0/'])
    assert.equal(isLocalRequest(new URL(external)), false, external);
});
