import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { simulatorRequest } from '../agent-core/src/orchestrator/simulator-client.ts';
import { AgentError, type ExecutionContext } from '../agent-core/src/orchestrator/contracts.ts';

const principal = { subject: 'resident', workload: 'focused-agent', permissions: ['fines:pay'], expiresAt: Date.now() + 60_000 };
const ctx: ExecutionContext = { principal, authorization: 'Bearer fixture', correlationId: randomUUID(), revalidate: async () => principal };
const request = () => simulatorRequest(new URL('http://127.0.0.1/'), 'fixture-key', 'simulator/v1/payments', ctx, new AbortController().signal, { body: { quote: 'fixture' }, key: 'a'.repeat(64), reasons: ['QUOTE_STALE'] });

test('focused write refusals require the exact simulator error envelope', async t => {
  for (const [status, code] of [[409, 'QUOTE_STALE'], [403, 'PERMISSION_DENIED']] as const) {
    const correlationId = randomUUID();
    for (const [body, expected] of [
      [{ code, correlationId, ...(status === 409 ? { operationId: 'a'.repeat(64) } : {}) }, status === 409 ? code : 'PROVIDER_FAILURE'],
      [{ code, correlationId, operationId: 'a'.repeat(64), success: true }, 'PROVIDER_FAILURE'],
      [{ code, correlationId, operationId: 'a'.repeat(64), receipt: { id: 'existing-effect' } }, 'PROVIDER_FAILURE'],
      [{ code, correlationId: 'not-a-uuid' }, 'PROVIDER_FAILURE'],
      [{ code }, 'PROVIDER_FAILURE'],
    ] as const) {
      const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
      try { await assert.rejects(request(), (error: unknown) => error instanceof AgentError && error.code === expected); }
      finally { mock.mock.restore(); }
    }
  }
});


test('focused reads preserve an explicit simulator authority denial', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PERMISSION_DENIED', correlationId: randomUUID() }, { status: 403 }));
  await assert.rejects(simulatorRequest(new URL('http://127.0.0.1/'), 'fixture-key', 'simulator/v1/fines', ctx, new AbortController().signal), (error: unknown) => error instanceof AgentError && error.code === 'PROVIDER_DENIED');
});


test('a write refusal must identify the dispatched operation', async t => {
  for (const [operationId, expected] of [['a'.repeat(64), 'QUOTE_STALE'], ['b'.repeat(64), 'PROVIDER_FAILURE'], [undefined, 'PROVIDER_FAILURE']] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'QUOTE_STALE', correlationId: randomUUID(), ...(operationId ? { operationId } : {}) }, { status: 409 }));
    try { await assert.rejects(request(), (error: unknown) => error instanceof AgentError && error.code === expected); }
    finally { mock.mock.restore(); }
  }
});
