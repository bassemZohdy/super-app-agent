/** Read-only inspection of a held local automation job; never starts a worker or requests an execution credential. */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { paymentsUrl, delegationAuthorityUrl } from '../packages/backend-kit/src/local-endpoints.ts';
import { HttpExecutionGateway } from '../services/automation-worker/src/http-gateway.ts';
import { inspectHeldPreparation } from '../services/automation-worker/src/preparation-inspection.ts';

async function main() {
  if (process.env.NODE_ENV === 'production' || process.argv.length !== 3) throw new Error('Inspection is unavailable.');
  const path = process.env.AUTOMATION_JOBS_DB, runId = process.env.AUTOMATION_RUN_ID;
  const secret = process.env.AUTOMATION_WORKER_CLIENT_SECRET || (process.env.AUTOMATION_WORKER_CLIENT_SECRET_FILE ? readFileSync(process.env.AUTOMATION_WORKER_CLIENT_SECRET_FILE, 'utf8').trim() : '');
  if (!path || path === ':memory:' || !runId || !secret) throw new Error('Inspection is not configured.');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const gateway = new HttpExecutionGateway({ runId, clientSecret: secret, paymentsUrl: paymentsUrl(), brokerUrl: delegationAuthorityUrl() });
    const result = await inspectHeldPreparation(db, gateway, runId, process.argv[2]);
    console.log(JSON.stringify(result));
  } finally { db.close(); }
}
void main().catch(() => { console.error('Preparation inspection could not be completed. Check the held job, run configuration and provider availability.'); process.exitCode = 1; });
