/** Owner-facing inbox and run history (AUTO-14), derived only from what the worker already recorded.
 *
 *  Every entry is a projection of a job's outbox event or a pre-run notice. Entries are keyed by their
 *  source, so reading or re-deriving the inbox never duplicates a notification, and each entry shows
 *  why a run happened or did not, which rule version it belonged to, and what it changed. Only rules
 *  the caller owns are returned; the caller supplies that set, so no entry crosses an account boundary. */
import type { JobStore, Job } from './jobs.ts';

export type InboxKind = 'UPCOMING_RUN' | 'PREPARED' | 'SETTLED' | 'SKIPPED' | 'FAILED' | 'HELD' | 'REQUIRES_ACTION' | 'CHALLENGE_ANSWERED';
export type InboxEntry = {
  id: string; kind: InboxKind; mandateId: string; policyVersion: number; occurrenceKey: string;
  reason?: string; orderId?: string; effect: string; at: number;
};
export type RunRecord = { mandateId: string; policyVersion: number; occurrenceKey: string; state: Job['state']; reason?: string; effect: string; updatedAt: number };

/** What the run did to money, stated from the job's state and reason. A held outcome of unknown status is never described as "None":
 *  its money may already have moved, and it is reconciled on the original order rather than retried under a new identity. */
export const effectOf = (job: Pick<Job, 'state' | 'reason'>) => {
  if (job.state === 'SETTLED') return 'Money moved once, as approved';
  if (job.state === 'PREPARED') return 'Reserved, nothing moved yet';
  if (job.state === 'HELD' && job.reason === 'REQUIRES_ACTION') return 'Nothing moved yet; waiting for your answer';
  if (job.state === 'HELD' && ((job.reason ?? '').startsWith('CREDENTIAL') || job.reason === 'OUTCOME_UNKNOWN')) return 'Outcome not confirmed: money may have moved. Reconciled on the original order; never retried under a new identity';
  return 'None';
};
const headline: Record<InboxKind, string> = {
  UPCOMING_RUN: 'Upcoming run', PREPARED: 'Payment prepared', SETTLED: 'Payment completed', SKIPPED: 'Run skipped',
  FAILED: 'Run did not complete', HELD: 'Run is on hold', REQUIRES_ACTION: 'Your decision is needed',
  CHALLENGE_ANSWERED: 'Card challenge answered',
};
export const inboxHeadline = (kind: InboxKind) => headline[kind];

/** Entries for the given owned rules only, newest last, without duplicates for the same source event. */
export function inboxFor(store: JobStore, ownedMandateIds: ReadonlySet<string>): InboxEntry[] {
  const jobs = new Map(store.list().filter(j => ownedMandateIds.has(j.mandateId)).map(j => [j.id, j]));
  const seen = new Set<string>(), out: InboxEntry[] = [];
  for (const event of store.outbox().filter(e => jobs.has(e.jobId))) {
    const job = jobs.get(event.jobId)!, id = `job:${job.id}:${event.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, kind: event.kind as InboxKind, mandateId: job.mandateId, policyVersion: job.policyVersion, occurrenceKey: job.occurrenceKey,
      reason: typeof event.body.reason === 'string' ? event.body.reason : job.reason,
      orderId: typeof event.body.orderId === 'string' ? event.body.orderId : undefined, effect: effectOf(job), at: event.at });
  }
  for (const notice of store.notices().filter(n => ownedMandateIds.has(n.mandateId))) {
    const id = `notice:${notice.mandateId}:${notice.occurrenceKey}:${notice.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, kind: notice.kind as InboxKind, mandateId: notice.mandateId, policyVersion: Number(notice.body.policyVersion ?? 0), occurrenceKey: notice.occurrenceKey,
      effect: 'None until the run itself', at: notice.at });
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The history of one owned rule: every occurrence once, with its final state, reason and effect. */
export function runHistory(store: JobStore, mandateId: string, owned: ReadonlySet<string>): RunRecord[] {
  if (!owned.has(mandateId)) return [];
  return store.list().filter(j => j.mandateId === mandateId).map(j => ({ mandateId: j.mandateId, policyVersion: j.policyVersion, occurrenceKey: j.occurrenceKey, state: j.state, reason: j.reason, effect: effectOf(j), updatedAt: j.updatedAt }));
}
