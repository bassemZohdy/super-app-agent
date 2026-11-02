/** Owner pause-all (AUTO-15): pause every approved rule the signed-in owner holds, one by one, at its current version.
 *
 *  Each pause is its own provider mutation under a key derived from the caller's request key and the rule, so a retry
 *  with the same request key replays what already happened and pauses only what did not. A failure is reported per rule
 *  and never hides the others; a rule that is not approved is left as it is. Pausing stops new preparations only: it does
 *  not reverse a payment already committed. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import { PROVIDER_REJECTION_CODES } from '../../../packages/backend-kit/src/provider-rejection-codes.ts';
import { ownedMandates } from './owned-mandates.ts';

export type PauseCall = (provider: string, actor: Actor, method: string, path: string, body?: unknown, key?: string) => Promise<unknown>;
export type PauseAllResult = { success: true; requestId: string; paused: string[]; notPaused: Array<{ mandateId: string; code: string }> };

export async function pauseAllMandates(actor: Actor, call: PauseCall, requestKey: string): Promise<PauseAllResult> {
  const listed = ownedMandates(await call('payments', actor, 'GET', '/payment-mandates'), actor);
  if (listed.some(m => typeof m.state !== 'string' || !['AWAITING_APPROVAL', 'APPROVED', 'PAUSED', 'REVOKED', 'EXPIRED'].includes(m.state) || typeof m.version !== 'number' || !Number.isSafeInteger(m.version) || m.version < 1 || m.version >= Number.MAX_SAFE_INTEGER))
    throw new UpstreamError(503, 'MANDATE_LIST_INVALID', 'The mandate list could not be confirmed.');
  const paused: string[] = [], notPaused: PauseAllResult['notPaused'] = [];
  for (const mandate of listed) {
    if (mandate.state !== 'APPROVED') continue;
    const id = mandate.id, version = mandate.version as number;
    try {
      const result = await call('payments', actor, 'POST', `/payment-mandates/${encodeURIComponent(id)}/pause`, { expectedVersion: version }, `pause-all:${requestKey}:${id}`);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Pause unconfirmed');
      const response = result as Record<string, unknown>, pausedMandate = response.mandate;
      if (response.success !== true || Object.hasOwn(response, 'error') || !pausedMandate || typeof pausedMandate !== 'object' || Array.isArray(pausedMandate)) throw new Error('Pause unconfirmed');
      const saved = pausedMandate as Record<string, unknown>;
      if (saved.id !== id || saved.ownerSub !== actor.sub || saved.accountId !== actor.accountId || saved.state !== 'PAUSED' || saved.version !== version + 1) throw new Error('Pause unconfirmed');
      paused.push(id);
    } catch (e) {
      const code = e instanceof UpstreamError && e.status >= 400 && e.status < 500 && PROVIDER_REJECTION_CODES.has(e.code) ? e.code : 'PAUSE_UNCONFIRMED';
      notPaused.push({ mandateId: id, code });
    }
  }
  return { success: true, requestId: String(actor.requestId ?? ''), paused, notPaused };
}
