import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { TestAuthenticator, type TestIdentity } from '../src/orchestrator/auth.ts';
import { FixturePlanner, type Planner } from '../src/orchestrator/planner.ts';
import { FinesAdapter } from '../src/orchestrator/fines-adapter.ts';
import { Store } from '../src/orchestrator/store.ts';
import { createGraph } from '../src/orchestrator/graph.ts';
import { AgentService } from '../src/orchestrator/service.ts';
import { createServer } from '../src/orchestrator/http.ts';

export async function harness(options: { planner?: Planner; approvalTtlMs?: number; timeoutMs?: number; file?: string; identities?: TestIdentity[] } = {}) {
  const dir = options.file ? undefined : mkdtempSync(join(tmpdir(), 'simple-agent-'));
  const file = options.file || join(dir!, 'agent.sqlite');
  const saver = SqliteSaver.fromConnString(file), store = new Store(saver.db); store.setup();
  const identities = options.identities || [
    { token: randomBytes(32).toString('hex'), subject: 'alice', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 3600000 },
    { token: randomBytes(32).toString('hex'), subject: 'bob', permissions: ['fines:read'], expiresAt: Date.now() + 3600000 },
  ] satisfies TestIdentity[];
  const workloadKey = randomBytes(32).toString('hex');
  const base = new URL('http://127.0.0.1/');
  const tools = new FinesAdapter(base, workloadKey, options.timeoutMs);
  const graph = createGraph(options.planner || new FixturePlanner(), tools, store, saver, options.approvalTtlMs);
  const service = new AgentService(graph, store);
  const server = createServer(service, new TestAuthenticator(identities, 'super-app-agent'), workloadKey);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base.port = String((server.address() as { port: number }).port);
  async function req(path: string, body?: unknown, options: { token?: string; key?: string; headers?: Record<string, string> } = {}) {
    const res = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', headers: {
      Authorization: `Bearer ${options.token || identities[0].token}`, 'Content-Type': 'application/json', 'Idempotency-Key': options.key || randomBytes(8).toString('hex'), ...options.headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, data: await res.json() as Record<string, any> };
  }
  async function thread(token?: string) { const result = await req('/api/agent/threads', {}, { token }); return result.data.threadId as string; }
  async function close() { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); saver.db.close(); if (dir) rmSync(dir, { recursive: true, force: true }); }
  return { base, file, saver, store, tools, graph, identities, workloadKey, req, thread, close };
}
