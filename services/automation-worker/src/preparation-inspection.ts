import type { DatabaseSync } from 'node:sqlite';
import { jobIdentity } from './jobs.ts';
import type { HttpExecutionGateway } from './http-gateway.ts';

export type PreparationInspection = { status: 'NOT_RECORDED' } | { status: 'SKIPPED' } | { status: 'PREPARED'; executionId: string; orderId: string; amountMinor: number };

/** Inspect only a held job's original request; this never changes the job or dispatches a payment. */
export async function inspectHeldPreparation(db: DatabaseSync, gateway: Pick<HttpExecutionGateway, 'inspectPreparation'>, runId: string, jobId: string): Promise<PreparationInspection> {
  if (!/^autorn_[a-f0-9-]{36}$/.test(runId) || !/^job_[a-f0-9]{32}$/.test(jobId)) throw new Error('Invalid inspection identity.');
  const read = () => db.prepare('SELECT id,mandate_id,policy_version,occurrence_key,target,state,reason,run_id,execution_id,order_id,amount_minor,fence,updated_at FROM jobs WHERE id=?').get(jobId);
  const row = read();
  if (!row || row.state !== 'HELD' || row.reason !== 'PREPARATION_UNKNOWN' || typeof row.mandate_id !== 'string' || typeof row.occurrence_key !== 'string' || typeof row.target !== 'string' || !Number.isSafeInteger(row.policy_version) || Number(row.policy_version) < 1 || (row.run_id != null && row.run_id !== runId)) throw new Error('Job is not an inspectable preparation.');
  const identity = jobIdentity({ mandateId: row.mandate_id, policyVersion: Number(row.policy_version), occurrenceKey: row.occurrence_key, target: row.target });
  if (identity.id !== jobId) throw new Error('Job identity does not match its saved terms.');
  const result = await gateway.inspectPreparation({ mandateId: row.mandate_id, policyVersion: Number(row.policy_version), occurrenceKey: row.occurrence_key, requestKey: identity.requestKey });
  if (JSON.stringify(read()) !== JSON.stringify(row)) throw new Error('Job changed during inspection.');
  if (!result) return { status: 'NOT_RECORDED' };
  if ('skipped' in result) {
    if (row.execution_id != null || row.order_id != null || row.amount_minor != null) throw new Error('Preparation evidence is inconsistent.');
    return { status: 'SKIPPED' };
  }
  if (result.runId !== runId || !/^autoexec_[A-Za-z0-9_-]{1,100}$/.test(result.id) || !/^(?:order|funding)_[A-Za-z0-9_-]{1,100}$/.test(result.orderId) || !Number.isSafeInteger(result.amountMinor) || result.amountMinor < 1 || result.amountMinor > 100000000 || (row.execution_id != null && row.execution_id !== result.id) || (row.order_id != null && row.order_id !== result.orderId) || (row.amount_minor != null && row.amount_minor !== result.amountMinor)) throw new Error('Preparation evidence is inconsistent.');
  return { status: 'PREPARED', executionId: result.id, orderId: result.orderId, amountMinor: result.amountMinor };
}
