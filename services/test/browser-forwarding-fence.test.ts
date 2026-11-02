import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Route } from 'playwright/test';
import { safeRouteFetch } from '../../test/browser/network-fence.ts';

test('explicit browser forwarding refuses protected or external targets and never follows redirects', async () => {
  let calls = 0, options: Record<string, unknown> | undefined, status = 200;
  const route = { request: () => ({ url: () => 'http://127.0.0.1:4000/original' }), fetch: async (input: Record<string, unknown>) => {
    calls++; options = input; return { status: () => status, dispose: async () => {} };
  } } as unknown as Route;
  for (const target of [undefined, 'http://localhost:4000/path', 'https://example.com/path', 'file:///private', 'http://user:pass@localhost:14000/']) {
    await assert.rejects(safeRouteFetch(route, target, 30000));
    assert.equal(calls, 0);
  }
  await safeRouteFetch(route, 'http://127.0.0.1:14000/path', 30000);
  assert.equal(options?.maxRedirects, 0);
  assert.equal(options?.url, 'http://127.0.0.1:14000/path');
  status = 302;
  await assert.rejects(safeRouteFetch(route, 'http://127.0.0.1:14000/path', 30000), /redirect/i);
});

test('browser route handlers use the guarded forwarding helper', () => {
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.name.endsWith('.ts') && entry.name !== 'network-fence.ts') {
        assert.doesNotMatch(readFileSync(path, 'utf8'), /\broute\s*\.\s*(?:fetch|continue|fallback)\s*\(/, path);
      }
    }
  };
  scan('test/browser');
});
