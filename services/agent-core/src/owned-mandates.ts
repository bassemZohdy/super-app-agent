import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';

export type OwnedMandate = Record<string, unknown> & { id: string };
export function ownedMandates(value: unknown, actor: Actor): OwnedMandate[] {
  const invalid = () => new UpstreamError(503, 'MANDATE_LIST_INVALID', 'The mandate list could not be confirmed.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (data.success !== true || Object.hasOwn(data, 'error') || !Array.isArray(data.mandates) || data.mandates.length > 100) throw invalid();
  const seen = new Set<string>(), result: OwnedMandate[] = [];
  for (const entry of data.mandates) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid();
    const mandate = entry as Record<string, unknown>;
    if (typeof mandate.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(mandate.id) || mandate.ownerSub !== actor.sub || mandate.accountId !== actor.accountId || seen.has(mandate.id)) throw invalid();
    seen.add(mandate.id);
    result.push(mandate as OwnedMandate);
  }
  return result;
}
