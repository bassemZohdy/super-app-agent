import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the focused agent container uses a versioned and digest-pinned base image', () => {
  const dockerfile = readFileSync(new URL('../agent-core/Dockerfile.simple', import.meta.url), 'utf8');
  const firstInstruction = dockerfile.split(/\r?\n/).find(line => line.trim() && !line.trimStart().startsWith('#'));
  assert.match(firstInstruction || '', /^FROM node:\d+\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64}$/);
});
