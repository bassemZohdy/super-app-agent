import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
export interface Actor { sub: string; username: string; name: string; accountId: string; authorization?: string; requestId: string; assertLease?: () => Promise<void>; eligibilityEpoch?:string; }
export const actorContext = new AsyncLocalStorage<Actor>();
export const accountIdFor = (subject: string, slot = 'personal') => `acc_${createHash('sha256').update(`${subject}:${slot}`).digest('hex').slice(0, 20)}`;
export function actorFor(user: { sub: string; preferred_username?: string; name?: string }, accountId?: string, authorization?: string): Actor {
  return { sub: user.sub, username: user.preferred_username || user.sub, name: user.name || user.preferred_username || 'Demo citizen',
    accountId: accountId || accountIdFor(user.sub), authorization, requestId: randomUUID() };
}
export function assetsFor(accountId: string) {
  const suffix = accountId.slice(-8);
  return { plate: `Dubai B-${parseInt(suffix.slice(-6), 16) % 90000 + 10000}`, premiseId: `DEWA-${suffix}`, utilityAccount: `ACC-${suffix}`, contractNumber: `EJR-${suffix}`, salikTag: `SLK-${suffix}` };
}
