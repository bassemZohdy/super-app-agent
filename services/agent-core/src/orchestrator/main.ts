import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { config } from './config.ts';
import { TestAuthenticator, KeycloakAuthenticator } from './auth.ts';
import { CompatiblePlanner, FixturePlanner } from './planner.ts';
import { Store } from './store.ts';
import { FinesAdapter } from './fines-adapter.ts';
import { VehiclesAdapter } from './vehicles-adapter.ts';
import { createGraph } from './graph.ts';
import { AgentService } from './service.ts';
import { createServer } from './http.ts';
import { logEvent } from '../../../../packages/backend-kit/src/redact.ts';

async function main() {
  const cfg = config();
  mkdirSync(dirname(cfg.AGENT_DB_PATH), { recursive: true, mode: 0o700 });
  const saver = SqliteSaver.fromConnString(cfg.AGENT_DB_PATH);
  chmodSync(cfg.AGENT_DB_PATH, 0o600);
  const store = new Store(saver.db);
  store.setup();
  const auth = cfg.AGENT_AUTH === 'test' ? new TestAuthenticator(cfg.identities, cfg.AGENT_WORKLOAD_ID) : new KeycloakAuthenticator(cfg.AGENT_WORKLOAD_ID);
  const planner = cfg.AGENT_PLANNER === 'fixture' ? new FixturePlanner() : new CompatiblePlanner(cfg.AGENT_LLM_BASE_URL!, cfg.AGENT_LLM_MODEL!, cfg.AGENT_LLM_KEY, cfg.AGENT_LLM_TIMEOUT_MS, cfg.AGENT_LLM_MAX_TOKENS, cfg.AGENT_LLM_RESPONSE_FORMAT === 'json_object');
  const graph = createGraph(planner, new FinesAdapter(cfg.AGENT_SIMULATOR_URL, cfg.AGENT_WORKLOAD_KEY), new VehiclesAdapter(cfg.AGENT_SIMULATOR_URL, cfg.AGENT_WORKLOAD_KEY), store, saver);
  const server = createServer(new AgentService(graph, store), auth, cfg.AGENT_WORKLOAD_KEY);
  server.listen(cfg.AGENT_PORT, cfg.AGENT_HOST, () => logEvent('info', 'agent.ready', { port: cfg.AGENT_PORT, planner: cfg.AGENT_PLANNER, auth: cfg.AGENT_AUTH }));
  let closing = false;
  const stop = () => {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exitCode = 1; }, 30000).unref();
    server.close(() => { saver.db.close(); clearTimeout(deadline); });
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
void main().catch(() => { logEvent('error', 'agent.start_failed', { hint: 'Check configuration and SQLite file access; no configuration values are logged.' }); process.exitCode = 1; });
