import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { BillerCandidate, BillerProvider } from '../../../packages/protocol-core/src/payments.ts';
import { PaymentRegistryError } from './payment-registry.ts';
/** Paths are server-owned. The signed actor is independently verified by each source provider. */
export async function billerCandidates(client: ProviderClient, actor: Actor, provider: BillerProvider): Promise<BillerCandidate[]> {
  if (provider === 'dewa') {
    const result = await client.call('dewa', actor, 'GET', '/consumption');
    return [{ provider, reference: result.account.accountNumber, label: `DEWA · ${result.account.accountNumber}` }];
  }
  if (provider === 'etisalat' || provider === 'du') {
    const result = await client.call(provider, actor, 'GET', '/subscriptions');
    return result.subscriptions.filter((s: { status: string }) => s.status === 'ACTIVE').map((s: { subscriptionId: string; name: string }) => ({ provider, reference: s.subscriptionId, label: `${provider} · ${s.name}` }));
  }
  if (provider === 'rta') {
    const result = await client.call('rta', actor, 'GET', '/salik');
    return [{ provider, reference: result.tagNumber, label: `Salik · ${result.tagNumber}` }];
  }
  const result = await client.call('police', actor, 'GET', '/fines');
  return [...new Set<string>(result.fines.map((f: { plateNumber: string }) => f.plateNumber))].map(reference => ({ provider, reference, label: `Traffic fines · ${reference}` }));
}
export async function verifyBillerReference(client: ProviderClient, actor: Actor, body: { provider: BillerProvider; reference: string }) {
  const candidates = await billerCandidates(client, actor, body.provider);
  if (!candidates.some(c => c.reference === body.reference)) throw new PaymentRegistryError(403, 'BILLER_NOT_OWNED', 'This reference is not an eligible owned resource at the selected provider.');
}
