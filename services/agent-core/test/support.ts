import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { TestAuthenticator, type TestIdentity } from '../src/orchestrator/auth.ts';
import { FixturePlanner, type Planner } from '../src/orchestrator/planner.ts';
import { FinesAdapter } from '../src/orchestrator/fines-adapter.ts';
import { VehiclesAdapter } from '../src/orchestrator/vehicles-adapter.ts';
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
  const vehicles = new VehiclesAdapter(base, workloadKey, options.timeoutMs);
  const graph = createGraph(options.planner || new FixturePlanner(), tools, vehicles, store, saver, options.approvalTtlMs);
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
  return { base, file, saver, store, tools, vehicles, graph, identities, workloadKey, req, thread, close };
}

/** Spawn the real entry point on a temporary SQLite file, so a test can SIGKILL and restart it. */
export function agentProcess(permissions: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-process-')), token = randomBytes(32).toString('hex');
  let child: ChildProcess | undefined, base = '';
  async function start() {
    if (!base) {
      const reserve = net.createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
      const port = (reserve.address() as net.AddressInfo).port;
      await new Promise<void>(resolve => reserve.close(() => resolve()));
      base = `http://127.0.0.1:${port}`;
    }
    const env = { ...process.env, NODE_ENV: 'test', AGENT_DB_PATH: join(dir, 'agent.sqlite'), AGENT_PORT: new URL(base).port, AGENT_SIMULATOR_URL: `${base}/`, AGENT_AUTH: 'test', AGENT_PLANNER: 'fixture', AGENT_WORKLOAD_KEY: randomBytes(32).toString('hex'), AGENT_TEST_IDENTITIES: JSON.stringify([{ token, subject: 'restart-owner', permissions, expiresAt: Date.now() + 3600000 }]) };
    child = spawn(process.execPath, ['--experimental-strip-types', 'services/agent-core/src/orchestrator/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    child.stdout!.on('data', chunk => { if (String(chunk).includes('agent.ready')) ready = true; });
    // Never publish subprocess logs: configuration or provider failures must not expose secrets.
    child.stderr!.resume();
    const until = Date.now() + 10000;
    while (!ready && child.exitCode === null && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ready, true, 'Agent process did not become ready');
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } }
  async function req(path: string, body?: unknown, key = randomBytes(8).toString('hex')) {
    const res = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(res.status >= 200 && res.status < 300, true);
    return await res.json() as Record<string, any>;
  }
  async function close() { await stop(); rmSync(dir, { recursive: true, force: true }); }
  return { start, stop, req, close };
}
