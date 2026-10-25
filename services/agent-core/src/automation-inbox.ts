/** Owner's automation inbox (AUTO-14 step 3): the worker's inbox entries for the signed-in owner's rules only.
 *
 *  The owned rule set comes from the payments provider's owner-scoped mandate list, so an account switch or another
 *  owner's rule never appears. The worker's job store is read per request and closed again; a missing store is an
 *  empty inbox, never a new file. Entries keep the source id the worker derived, so polling never duplicates one. */
import { existsSync } from 'node:fs';
import { JobStore } from '../../automation-worker/src/jobs.ts';
import { inboxFor, type InboxEntry } from '../../automation-worker/src/inbox.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';

export type InboxCall = (provider: string, actor: Actor, method: string, path: string) => Promise<any>;
export type AutomationInbox = { requestId: string; entries: InboxEntry[] };

export const defaultJobsPath = () => process.env.AUTOMATION_JOBS_DB || '.data/automation-worker/jobs.sqlite';

export async function automationInbox(actor: Actor, call: InboxCall, jobsPath = defaultJobsPath()): Promise<AutomationInbox> {
  const listed = await call('payments', actor, 'GET', '/payment-mandates');
  const owned = new Set<string>((Array.isArray(listed?.mandates) ? listed.mandates : []).map((m: { id?: unknown }) => String(m?.id ?? '')).filter(Boolean));
  const requestId = String(actor.requestId ?? '');
  if (owned.size === 0 || !existsSync(jobsPath)) return { requestId, entries: [] };
  const store = new JobStore(jobsPath);
  try { return { requestId, entries: inboxFor(store, owned) }; } finally { store.close(); }
}
