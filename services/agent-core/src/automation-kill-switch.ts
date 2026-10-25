/** Operator kill switch over the application route (AUTO-15, step 3a).
 *
 *  Only a signed-in account listed in AUTOMATION_OPERATOR_SUBS may engage or release the worker's kill switch. The switch
 *  itself is the worker's persisted flag, so this route only writes that flag; it grants no other authority. A missing job
 *  store is an error, never a new file. This is an allowlisted operator sign-in, not the broker-scoped admin client, which
 *  remains open in AUTO-15 step 3b. */
import { existsSync } from 'node:fs';
import { JobStore } from '../../automation-worker/src/jobs.ts';
import { defaultJobsPath } from './automation-inbox.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';

export type KillSwitchResult = { status: number; data: Record<string, unknown> };

export function operatorSubs(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.AUTOMATION_OPERATOR_SUBS || '').split(',').map(s => s.trim()).filter(Boolean));
}

export function setKillSwitch(actor: Actor, input: { engaged: boolean; reason?: string }, jobsPath = defaultJobsPath(), env: NodeJS.ProcessEnv = process.env): KillSwitchResult {
  if (!operatorSubs(env).has(actor.sub)) return { status: 403, data: { success: false, code: 'OPERATOR_REQUIRED', error: 'Only an allowlisted automation operator can change the kill switch.' } };
  const reason = (input.reason ?? '').trim();
  if (input.engaged && !reason) return { status: 400, data: { success: false, code: 'REASON_REQUIRED', error: 'Engaging the kill switch needs a reason.' } };
  if (!existsSync(jobsPath)) return { status: 404, data: { success: false, code: 'JOB_STORE_NOT_FOUND', error: 'No automation job store exists yet.' } };
  const store = new JobStore(jobsPath);
  try {
    store.setKillSwitch(input.engaged, reason);
    return { status: 200, data: { success: true, requestId: String(actor.requestId ?? ''), killSwitch: store.killSwitch() } };
  } finally { store.close(); }
}

/** The current state for an allowlisted operator, so the panel can show what it will change. Reads only. */
export function readKillSwitch(actor: Actor, jobsPath = defaultJobsPath(), env: NodeJS.ProcessEnv = process.env): KillSwitchResult {
  if (!operatorSubs(env).has(actor.sub)) return { status: 403, data: { success: false, code: 'OPERATOR_REQUIRED', error: 'Only an allowlisted automation operator can read the kill switch.' } };
  if (!existsSync(jobsPath)) return { status: 404, data: { success: false, code: 'JOB_STORE_NOT_FOUND', error: 'No automation job store exists yet.' } };
  const store = new JobStore(jobsPath);
  try { return { status: 200, data: { success: true, killSwitch: store.killSwitch() } }; } finally { store.close(); }
}
