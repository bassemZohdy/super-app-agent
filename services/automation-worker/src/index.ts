/** Local demo automation worker. It stays off unless explicitly enabled, never runs in production
 *  and holds no authority of its own: only the `automation-worker` service account and the
 *  per-execution credentials the broker issues for prepared executions. */
import { delegationAuthorityUrl, paymentsUrl } from '../../../packages/backend-kit/src/local-endpoints.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JobStore } from './jobs.ts';
import { AutomationWorker } from './worker.ts';
import { HttpExecutionGateway } from './http-gateway.ts';
import { HttpRuleSource } from './http-rules.ts';
import { Scheduler } from './scheduler.ts';

export function workerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.AUTOMATION_WORKER_ENABLED === 'true' && env.NODE_ENV !== 'production';
}

export function createWorkerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!workerEnabled(env)) throw new Error('The automation worker is disabled. Set AUTOMATION_WORKER_ENABLED=true for the local demo.');
  const secret = env.AUTOMATION_WORKER_CLIENT_SECRET || (env.AUTOMATION_WORKER_CLIENT_SECRET_FILE ? readFileSync(env.AUTOMATION_WORKER_CLIENT_SECRET_FILE, 'utf8').trim() : '');
  if (!secret || !env.AUTOMATION_RUN_ID) throw new Error('Configure AUTOMATION_RUN_ID and the worker client secret.');
  const store = new JobStore(env.AUTOMATION_JOBS_DB || '.data/automation-worker/jobs.sqlite');
  const gateway = new HttpExecutionGateway({ runId: env.AUTOMATION_RUN_ID, clientSecret: secret,
    paymentsUrl: paymentsUrl(env), brokerUrl: delegationAuthorityUrl(env) });
  const worker = new AutomationWorker(store, gateway, { workerId: env.AUTOMATION_WORKER_ID || `worker-${process.pid}` });
  // Scheduling is a second, separate opt-in: without it the worker only runs jobs someone else enqueued.
  const scheduler = env.AUTOMATION_SCHEDULE_ENABLED === 'true'
    ? new Scheduler(store, new HttpRuleSource({ runId: env.AUTOMATION_RUN_ID, clientSecret: secret, paymentsUrl: paymentsUrl(env) }))
    : undefined;
  return { store, worker, scheduler };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { store, worker, scheduler } = createWorkerFromEnv();
  let stopping = false;
  const loop = (async () => {
    // Finish the step in flight, then stop: leases expire on their own if the process is killed instead.
    while (!stopping) {
      // A failed read skips this tick; the next one recomputes the same answer from the recorded occurrences.
      try { await scheduler?.tick(Date.now()); } catch { /* retried on the next pass */ }
      if (!await worker.runOnce()) await new Promise(done => setTimeout(done, 2000));
    }
  })();
  const stop = () => { stopping = true; void loop.finally(() => { store.close(); process.exit(0); }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log(scheduler ? 'Automation worker running with scheduling enabled for the local demo.' : 'Automation worker running for the local demo (scheduling is off).');
}
