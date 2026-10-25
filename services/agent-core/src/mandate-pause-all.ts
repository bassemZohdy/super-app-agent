/** Owner pause-all (AUTO-15): pause every approved rule the signed-in owner holds, one by one, at its current version.
 *
 *  Each pause is its own provider mutation under a key derived from the caller's request key and the rule, so a retry
 *  with the same request key replays what already happened and pauses only what did not. A failure is reported per rule
 *  and never hides the others; a rule that is not approved is left as it is. Pausing stops new preparations only: it does
 *  not reverse a payment already committed. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';

export type PauseCall = (provider: string, actor: Actor, method: string, path: string, body?: unknown, key?: string) => Promise<any>;
export type PauseAllResult = { success: true; requestId: string; paused: string[]; notPaused: Array<{ mandateId: string; code: string }> };

export async function pauseAllMandates(actor: Actor, call: PauseCall, requestKey: string): Promise<PauseAllResult> {
  const listed = await call('payments', actor, 'GET', '/payment-mandates');
  const paused: string[] = [], notPaused: PauseAllResult['notPaused'] = [];
  for (const mandate of Array.isArray(listed?.mandates) ? listed.mandates : []) {
    if (mandate?.state !== 'APPROVED') continue;
    const id = String(mandate.id);
    try {
      await call('payments', actor, 'POST', `/payment-mandates/${encodeURIComponent(id)}/pause`, { expectedVersion: Number(mandate.version) }, `pause-all:${requestKey}:${id}`);
      paused.push(id);
    } catch (e) {
      notPaused.push({ mandateId: id, code: String((e as { code?: string }).code || 'REJECTED').slice(0, 80) });
    }
  }
  return { success: true, requestId: String(actor.requestId ?? ''), paused, notPaused };
}
