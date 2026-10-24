import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const readRoot = (file: string) => readFileSync(join(root, file), 'utf8');
const rootPackage = JSON.parse(readRoot('package.json')) as { engines?: { node?: string }; packageManager?: string };

test('root package.json enforces the Node 24 floor via engines', () => {
  assert.equal(rootPackage.engines?.node, '>=24', 'package.json engines.node must be ">=24"');
});

test('.nvmrc pins Node 24', () => {
  assert.equal(readRoot('.nvmrc').trim(), '24', '.nvmrc must contain exactly "24"');
});

test('packageManager stays pinned to npm 11.9.0', () => {
  assert.equal(rootPackage.packageManager, 'npm@11.9.0');
});

test('the running Node process satisfies the Node 24 floor', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(
    major >= 24,
    `Node ${process.versions.node} is below the required floor of Node 24; install Node 24+ (see .nvmrc)`,
  );
});
