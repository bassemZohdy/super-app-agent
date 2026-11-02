import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production lockfile Zod copies meet the patched advisory version', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean }> };
  const copies = Object.entries(lock.packages).filter(([path, entry]) => (path === 'node_modules/zod' || path.endsWith('/node_modules/zod')) && !entry.dev);
  assert.ok(copies.length > 0, 'the lockfile contains production Zod');
  for (const [path, entry] of copies) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(entry.version || '');
    assert.ok(match, `${path} needs a stable version`);
    const [major, minor, patch] = match.slice(1).map(Number);
    assert.ok(major > 4 || major === 4 && (minor > 6 || minor === 6 && patch >= 6), `${path} must not use a version affected by GHSA-mrhx-c7xc-m3w5`);
  }
});
