import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { test as base, expect } from '../fixtures.ts';

export const test = base.extend<{
  focused: { url: string; token: string; otherToken: string; restart: () => Promise<void>; payments: () => number };
}>({
  focused: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'cityside-fines-browser-'));
    const file = join(dir, 'agent.sqlite');
    const reserve = net.createServer(); await new Promise<void>(done => reserve.listen(0, '127.0.0.1', done));
    const port = (reserve.address() as net.AddressInfo).port;
    await new Promise<void>(done => reserve.close(() => done()));
    const token = randomBytes(32).toString('hex'), otherToken = randomBytes(32).toString('hex');
    const identities = [token, otherToken].map((value, index) => ({ token: value, subject: `browser-owner-${index}-${randomUUID()}`, permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 3600000 }));
    const target = `http://127.0.0.1:${port}`;
    const env = { ...process.env, NODE_ENV: 'test', AGENT_DB_PATH: file, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', AGENT_SIMULATOR_URL: `${target}/`, AGENT_AUTH: 'test', AGENT_PLANNER: 'fixture', AGENT_WORKLOAD_KEY: randomBytes(32).toString('hex'), AGENT_TEST_IDENTITIES: JSON.stringify(identities), AGENT_LLM_KEY: '', OPENROUTER_API_KEY: '' };
    let child: ChildProcess | undefined;
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
    }
    async function start() {
      child = spawn(process.execPath, ['--experimental-strip-types', 'services/agent-core/src/orchestrator/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let ready = false;
      child.stdout!.on('data', chunk => { if (String(chunk).includes('agent.ready')) ready = true; });
      child.stderr!.resume();
      const deadline = Date.now() + 10000;
      while (!ready && child.exitCode === null && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
      expect(ready, 'isolated fixture agent is ready').toBe(true);
    }
    const web = await createServer({ root: resolve('apps/shell-react'), configFile: resolve('apps/shell-react/vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: { '/api/agent': { target, changeOrigin: false } } } });
    try {
      await start(); await web.listen();
      const webPort = (web.httpServer!.address() as net.AddressInfo).port;
      await use({ url: `http://127.0.0.1:${webPort}/services/fines`, token, otherToken, restart: async () => { await stop(); await start(); }, payments: () => {
        const db = new DatabaseSync(file, { readOnly: true });
        try { return Number(db.prepare('SELECT count(*) AS n FROM sa_sim_payments').get()!.n); } finally { db.close(); }
      } });
    } finally { await web.close(); await stop(); rmSync(dir, { recursive: true, force: true }); }
  },
});
export { expect };
