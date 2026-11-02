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
import { runWorkerLoop } from './loop.ts';

export function workerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.AUTOMATION_WORKER_ENABLED === 'true' && env.NODE_ENV !== 'production';
}

export function createWorkerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!workerEnabled(env)) throw new Error('The automation worker is disabled. Set AUTOMATION_WORKER_ENABLED=true for the local demo.');
  const secret = env.AUTOMATION_WORKER_CLIENT_SECRET || (env.AUTOMATION_WORKER_CLIENT_SECRET_FILE ? readFileSync(env.AUTOMATION_WORKER_CLIENT_SECRET_FILE, 'utf8').trim() : '');
  if (!secret || !env.AUTOMATION_RUN_ID) throw new Error('Configure AUTOMATION_RUN_ID and the worker client secret.');
  const store = new JobStore(env.AUTOMATION_JOBS_DB || '.data/automation-worker/jobs.sqlite');
  let gateway: HttpExecutionGateway;
  try {
    gateway = new HttpExecutionGateway({ runId: env.AUTOMATION_RUN_ID, clientSecret: secret,
      paymentsUrl: paymentsUrl(env), brokerUrl: delegationAuthorityUrl(env) });
    store.bindRun(env.AUTOMATION_RUN_ID);
  } catch (error) { store.close(); throw error; }
  const worker = new AutomationWorker(store, gateway, { workerId: env.AUTOMATION_WORKER_ID || `worker-${process.pid}` });
  // Scheduling is a second, separate opt-in: without it the worker only runs jobs someone else enqueued.
  const scheduler = env.AUTOMATION_SCHEDULE_ENABLED === 'true'
    ? new Scheduler(store, new HttpRuleSource({ runId: env.AUTOMATION_RUN_ID, clientSecret: secret, paymentsUrl: paymentsUrl(env) }))
    : undefined;
  return { store, worker, scheduler };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { store, worker, scheduler } = createWorkerFromEnv();
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  void runWorkerLoop(worker, scheduler, stop.signal).then(
    () => { store.close(); },
    () => { store.close(); console.error('Automation worker stopped after an internal failure.'); process.exitCode = 1; },
  );
  console.log(scheduler ? 'Automation worker running with scheduling enabled for the local demo.' : 'Automation worker running for the local demo (scheduling is off).');
}
