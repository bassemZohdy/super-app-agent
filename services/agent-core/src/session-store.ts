import { completeCivicSteps } from './civic-resolution.ts';
import { operationalEvent } from '../../../packages/backend-kit/src/observability.ts';
import { createClient, type RedisClientType } from 'redis';
import { createHash, randomUUID } from 'node:crypto';
import type { SuperAppAgentState } from './langgraph/state.ts';
import type { A2UIMessageEnvelope } from '../../../packages/protocol-core/src/index.ts';
export class SessionError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message);const event=code==='SESSION_BUSY'?'session_busy':code==='SESSION_LOCK_LOST'?'session_lock_lost':code==='SESSION_STORE_UNAVAILABLE'?'redis_unavailable':undefined;if(event)operationalEvent(event); this.status = status; this.code = code; }
}
type Record = { owner: string; accountId: string; state: SuperAppAgentState; updatedAt: number };
function decodeRecord(raw: string): Record {
  const record = JSON.parse(raw) as Record;
  const arrayKeys = new Set(['messages','children','rows','columns','options','markers','routePolyline']);
  const walk = (value: any) => { if (!value || typeof value !== 'object') return; for (const [key, item] of Object.entries(value)) {
    if (arrayKeys.has(key) && item && !Array.isArray(item) && typeof item === 'object' && Object.keys(item).length === 0) value[key] = [];
    else walk(item);
  } };
  walk(record.state); return record;
}
const claimScript = `local existing=redis.call('GET',KEYS[1]); if existing then
 local r=cjson.decode(existing); if r.owner~=ARGV[1] then return {'FORBIDDEN'} end
 if r.accountId~=ARGV[2] then return {'ACCOUNT_MISMATCH'} end
 if redis.call('EXISTS',KEYS[3])==1 then redis.call('PERSIST',KEYS[1]); redis.call('SADD',KEYS[4],KEYS[1]) else redis.call('EXPIRE',KEYS[1],ARGV[4]) end; redis.call('SADD',KEYS[2],KEYS[1]); redis.call('EXPIRE',KEYS[2],ARGV[4]); return {'OK',existing} end
 if ARGV[5]~='1' or redis.call('EXISTS',KEYS[3])==1 then return {'NOT_FOUND'} end
 redis.call('SET',KEYS[1],ARGV[3],'EX',ARGV[4]); redis.call('SADD',KEYS[2],KEYS[1]); redis.call('EXPIRE',KEYS[2],ARGV[4]); return {'OK',ARGV[3]}`;
type CivicAction = 'confirm_smartcity_checkout' | 'pay_utilities_bill' | 'pay_dewa_bill' | 'pay_police_fines';
type CivicOwner = { subject: string; accountId: string; sessionId: string; action: CivicAction; surfaceRevision?: string };
export type CivicStepName = 'WALLET' | 'UTILITY' | 'FINES' | 'TOLL';
type CivicStepState = 'STARTED' | 'CONFIRMED' | 'REJECTED' | 'UNKNOWN';
type CivicStep = { name: CivicStepName; state: CivicStepState; receiptReference?: string; operationId?: string; serviceEpoch?: string; retryNonce?: string; recoveredFrom?: 'STARTED' | 'UNKNOWN' };
const civicReference = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
type CivicReview = { billId: string; billAmountMinor: number; fines: Array<{ fineId: string; amountMinor: number }>; tagNumber: string; tollAmountMinor: number };
function civicReview(value: unknown): CivicReview | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as { billId?: unknown; billAmountMinor?: unknown; fines?: unknown; tagNumber?: unknown; tollAmountMinor?: unknown };
  const id = (item: unknown): item is string => typeof item === 'string' && item.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(item);
  const amount = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 100000000;
  if (!id(v.billId) || !id(v.tagNumber) || !amount(v.billAmountMinor) || v.tollAmountMinor !== 10000 || !Array.isArray(v.fines) || v.fines.length > 20) return;
  const fines: CivicReview['fines'] = [];
  for (const item of v.fines) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const fine = item as { fineId?: unknown; amountMinor?: unknown };
    if (!id(fine.fineId) || !amount(fine.amountMinor) || fine.amountMinor === 0 || fines.some(existing => existing.fineId === fine.fineId)) return;
    fines.push({ fineId: fine.fineId, amountMinor: fine.amountMinor });
  }
  return { billId: v.billId, billAmountMinor: v.billAmountMinor, fines, tagNumber: v.tagNumber, tollAmountMinor: v.tollAmountMinor };
}

const civicStepNames: ReadonlySet<string> = new Set(['WALLET', 'UTILITY', 'FINES', 'TOLL']);
const civicStepStates: ReadonlySet<string> = new Set(['STARTED', 'CONFIRMED', 'REJECTED', 'UNKNOWN']);
const civicOwnerDigest = (subject: string, accountId: string) => createHash('sha256').update(JSON.stringify([subject, accountId])).digest('hex');
const civicRetiredKey = (prefix: string, owner: string, sessionId: string, surfaceRevision: string) => `${prefix}civic-retired:${createHash('sha256').update(JSON.stringify([owner, sessionId, surfaceRevision])).digest('hex')}`;
const civicActions: ReadonlySet<string> = new Set(['confirm_smartcity_checkout', 'pay_utilities_bill', 'pay_dewa_bill', 'pay_police_fines']);
export class RedisSessionStore {
  readonly client: RedisClientType;
  readonly ttl: number;
  readonly prefix: string;
  private ready?: Promise<void>;
  private subscriber?: RedisClientType;
  private subscriptions = new Map<string, Set<(event: A2UIMessageEnvelope) => void>>();
  constructor(url: string, ttl = 3600, prefix = 'superapp:') {
    this.ttl = ttl; this.prefix = prefix;
    this.client = createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false }, disableOfflineQueue: true });
    this.client.on('error', () => { /* Requests fail closed; do not log credentials or session data. */ });
  }
  async connect() {
    if (this.client.isReady) return;
    if (!this.client.isOpen) this.ready = undefined;
    this.ready ||= this.client.connect().then(() => {});
    try { await this.ready; } catch { this.ready = undefined; throw new SessionError(503, 'SESSION_STORE_UNAVAILABLE', 'Session storage is unavailable. No request was started.'); }
  }
  private key(sid: string) { return `${this.prefix}session:${sid}`; }
  private userKey(owner: string) { return `${this.prefix}user:${createHash('sha256').update(owner).digest('hex')}`; }
  private pendingCompositeUserKey(owner: string) { return `${this.userKey(owner)}:composite-pending`; }
  private compositeFenceKey(owner: string, accountId: string) { return `${this.prefix}integrated-composite:${civicOwnerDigest(owner, accountId)}`; }
  private compositeMarkerKey(sid: string) { return `${this.key(sid)}:composite-pending`; }
  private compositeDispatchKey(sid: string) { return `${this.key(sid)}:composite-dispatch`; }
  async inspectCompositeDispatch(owner: string, accountId: string, sid: string, operationId: string): Promise<'NOT_STARTED' | 'UNCONFIRMED'> {
    await this.connect();
    const fence = JSON.stringify({ owner: civicOwnerDigest(owner, accountId), sessionId: sid, operationId });
    const prepared = await this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] and redis.call('GET',KEYS[2])==ARGV[1] and redis.call('GET',KEYS[3])=='PREPARED:'..ARGV[1] then return 1 end; return 0`, {
      keys: [this.compositeMarkerKey(sid), this.compositeFenceKey(owner, accountId), this.compositeDispatchKey(sid)], arguments: [fence],
    });
    return prepared === 1 ? 'NOT_STARTED' : 'UNCONFIRMED';
  }
  async inspectCompositeFence(owner: string, accountId: string): Promise<{ status: 'CLEAR' | 'BLOCKED'; sessionId?: string; operationId?: string }> {
    await this.connect();
    const raw = await this.client.get(this.compositeFenceKey(owner, accountId));
    if (!raw) return { status: 'CLEAR' };
    try {
      const value = JSON.parse(raw) as { owner?: unknown; sessionId?: unknown; operationId?: unknown };
      if (value.owner === civicOwnerDigest(owner, accountId) && typeof value.sessionId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value.sessionId) && typeof value.operationId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value.operationId)) return { status: 'BLOCKED', sessionId: value.sessionId, operationId: value.operationId };
    } catch { /* A malformed fence remains blocked. */ }
    throw new SessionError(503, 'COMPOSITE_STATUS_UNAVAILABLE', 'The original composite checkout cannot be inspected.');
  }
  async claim(sid: string, owner: string, accountId: string, create = true): Promise<SuperAppAgentState> {
    await this.connect();
    const state: SuperAppAgentState = { sessionId: sid, messages: [], activeDomain: 'concierge', metadata: { accountId } };
    const record: Record = { owner, accountId, state, updatedAt: Date.now() };
    const result = await this.client.eval(claimScript, { keys: [this.key(sid), this.userKey(owner), this.compositeMarkerKey(sid), this.pendingCompositeUserKey(owner)], arguments: [owner, accountId, JSON.stringify(record), String(this.ttl), create ? '1' : '0'] }) as string[];
    if (result[0] === 'FORBIDDEN') throw new SessionError(403, 'SESSION_FORBIDDEN', 'Session belongs to a different user.');
    if (result[0] === 'ACCOUNT_MISMATCH') throw new SessionError(409, 'SESSION_ACCOUNT_MISMATCH', 'Start a new conversation when switching accounts.');
    if (result[0] === 'NOT_FOUND') throw new SessionError(404, 'SESSION_NOT_FOUND', 'Session not found or expired.');
    return decodeRecord(result[1]).state;
  }
  /** A shared fixture has one civic-payment lane. Retain this record after an uncertain outcome or process loss. */
  async acquireCivicFence(owner: CivicOwner) {
    if (!owner.subject || !owner.accountId || !/^[a-zA-Z0-9_-]{8,128}$/.test(owner.sessionId) || !civicActions.has(owner.action) || owner.surfaceRevision !== undefined && !/^[0-9a-f-]{36}$/.test(owner.surfaceRevision)) throw new SessionError(400, 'CIVIC_CONTEXT_INVALID', 'The civic payment context is invalid.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`;
    let record = { version: 20, nonce: randomUUID(), owner: civicOwnerDigest(owner.subject, owner.accountId), sessionId: owner.sessionId, action: owner.action, surfaceRevision: owner.surfaceRevision ?? null, steps: [] as CivicStep[], review: null as CivicReview | null };
    let current = JSON.stringify(record);
    const retired = owner.surfaceRevision ? civicRetiredKey(this.prefix, record.owner, owner.sessionId, owner.surfaceRevision) : `${this.prefix}civic-retired:none`;
    const admitted = await this.client.eval(`if ARGV[2]=='1' and redis.call('EXISTS',KEYS[2])~=0 then return -1 end
      if redis.call('EXISTS',KEYS[1])~=0 then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); return 1`, { keys: [key, retired], arguments: [current, owner.surfaceRevision ? '1' : '0'] });
    if (admitted === -1) throw new SessionError(409, 'CIVIC_APPROVAL_RESOLVED', 'This civic approval was already resolved.');
    if (admitted !== 1) throw new SessionError(409, 'CIVIC_RECONCILIATION_REQUIRED', 'An offline civic payment is in progress or needs reconciliation.');
    const save = async (updated: typeof record) => {
      const next = JSON.stringify(updated);
      await this.connect();
      const saved = await this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 1 else return 0 end`, { keys: [key], arguments: [current, next] });
      if (saved !== 1) throw new SessionError(503, 'CIVIC_FENCE_LOST', 'Civic payment coordination was lost.');
      current = next; record = updated;
    };
    return {
      bindReview: async (value: unknown) => {
        const review = civicReview(value);
        if (record.action !== 'confirm_smartcity_checkout' || record.review || record.steps.length || !review) throw new SessionError(409, 'CIVIC_REVIEW_INVALID', 'The civic payment review cannot be bound.');
        await save({ ...record, review });
      },
      startStep: async (name: CivicStepName, serviceEpoch?: string) => {
        if (record.action === 'confirm_smartcity_checkout' && !record.review) throw new SessionError(409, 'CIVIC_REVIEW_REQUIRED', 'The civic payment review is required before starting a step.');
        if (serviceEpoch !== undefined && (record.action !== 'confirm_smartcity_checkout' || !/^[0-9a-f-]{36}$/.test(serviceEpoch))) throw new SessionError(409, 'CIVIC_STEP_INVALID', 'The fixture lifetime is invalid.');
        if (!civicStepNames.has(name) || record.steps.length >= 4 || record.steps.some(step => step.name === name || step.state !== 'CONFIRMED')) throw new SessionError(409, 'CIVIC_STEP_INVALID', 'The civic payment step cannot be started.');
        const operationId = ['WALLET', 'UTILITY', 'FINES', 'TOLL'].includes(name) && record.action === 'confirm_smartcity_checkout' ? `CIVIC-${randomUUID()}` : undefined;
        await save({ ...record, steps: [...record.steps, { name, state: 'STARTED', ...(operationId ? { operationId } : {}), ...(serviceEpoch ? { serviceEpoch } : {}) }] });
        return operationId;
      },
      finishStep: async (name: CivicStepName, state: Exclude<CivicStepState, 'STARTED'>, receiptReference?: string) => {
        const last = record.steps.at(-1);
        if (!last || last.name !== name || last.state !== 'STARTED' || !['CONFIRMED', 'REJECTED', 'UNKNOWN'].includes(state) || receiptReference !== undefined && (state !== 'CONFIRMED' || !civicReference(receiptReference))) throw new SessionError(409, 'CIVIC_STEP_INVALID', 'The civic payment step cannot be finished.');
        await save({ ...record, steps: [...record.steps.slice(0, -1), { ...last, state, ...(receiptReference ? { receiptReference } : {}) }] });
      },
      release: async () => {
        await this.connect();
        await this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`, { keys: [key], arguments: [current] });
      },
    };
  }
  async inspectCivicFence(subject: string, accountId: string): Promise<{ status: 'CLEAR' | 'BLOCKED'; sessionId?: string; action?: CivicAction; civicSteps?: CivicStep[]; civicReview?: CivicReview; revision?: string; surfaceRevision?: string; observedFromRevision?: string; utilityObservedFromRevision?: string; finesObservedFromRevision?: string; tollObservedFromRevision?: string }> {
    await this.connect();
    const raw = await this.client.get(`${this.prefix}offline-civic-fence`);
    if (raw === null) return { status: 'CLEAR' };
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; sessionId?: unknown; action?: unknown; steps?: unknown; review?: unknown; surfaceRevision?: unknown; observedFromRevision?: unknown; utilityObservedFromRevision?: unknown; finesObservedFromRevision?: unknown; tollObservedFromRevision?: unknown };
      const tollObserved = typeof record.version === 'number' && record.version >= 28 && record.version <= 35;
      const tollIdentities = typeof record.version === 'number' && record.version >= 20 && record.version <= 35;
      const schemaVersion = tollObserved ? (record.version as number) - 16 : tollIdentities ? (record.version as number) - 8 : record.version;
      if (record && (schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && record.owner === civicOwnerDigest(subject, accountId) &&
          typeof record.sessionId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(record.sessionId) &&
          typeof record.action === 'string' && civicActions.has(record.action)) {
        if (schemaVersion === 1) return { status: 'BLOCKED', sessionId: record.sessionId, action: record.action as CivicAction };
        if (Array.isArray(record.steps) && record.steps.length <= 4 && record.steps.every((step: unknown) => !!step && typeof step === 'object' && civicStepNames.has((step as CivicStep).name) && civicStepStates.has((step as CivicStep).state))) {
          const review = (schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && record.review !== null ? civicReview(record.review) : undefined;
          if ((schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && record.review !== null && !review) return { status: 'BLOCKED' };
          if ((schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && record.steps.some((step: CivicStep) => step.receiptReference !== undefined && (step.state !== 'CONFIRMED' || !civicReference(step.receiptReference)))) return { status: 'BLOCKED' };
          if ((schemaVersion === 6 || schemaVersion === 7) && record.steps.some((step: CivicStep) => (step.name === 'WALLET' && record.action === 'confirm_smartcity_checkout' && !step.operationId) || (step.operationId !== undefined && (step.name !== 'WALLET' || !/^CIVIC-[0-9a-f-]{36}$/.test(step.operationId))))) return { status: 'BLOCKED' };
          if ((schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && record.steps.some((step: CivicStep) => ((tollIdentities ? ['WALLET', 'UTILITY', 'FINES', 'TOLL'] : [12, 13, 14, 15, 16, 17, 18, 19].includes(schemaVersion as number) ? ['WALLET', 'UTILITY', 'FINES'] : ['WALLET', 'UTILITY']).includes(step.name) && record.action === 'confirm_smartcity_checkout' && !step.operationId) || (step.operationId !== undefined && (!(tollIdentities ? ['WALLET', 'UTILITY', 'FINES', 'TOLL'] : [12, 13, 14, 15, 16, 17, 18, 19].includes(schemaVersion as number) ? ['WALLET', 'UTILITY', 'FINES'] : ['WALLET', 'UTILITY']).includes(step.name) || !/^CIVIC-[0-9a-f-]{36}$/.test(step.operationId))))) return { status: 'BLOCKED' };
          if (record.steps.some((step: CivicStep) => step.serviceEpoch !== undefined && (!tollIdentities || !['WALLET', 'UTILITY', 'FINES', 'TOLL'].includes(step.name) || !step.operationId || !/^[0-9a-f-]{36}$/.test(step.serviceEpoch)))) return { status: 'BLOCKED' };
          if ((schemaVersion === 7 || schemaVersion === 9 || schemaVersion === 11 || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 15 || schemaVersion === 19)) && (typeof record.observedFromRevision !== 'string' || !/^[a-f0-9]{64}$/.test(record.observedFromRevision) || record.action !== 'confirm_smartcity_checkout' || !record.steps.length || record.steps[0].name !== 'WALLET' || record.steps[0].state !== 'CONFIRMED' || !['STARTED', 'UNKNOWN'].includes(record.steps[0].recoveredFrom) || !record.steps[0].receiptReference || !record.steps[0].operationId || record.steps.slice((schemaVersion === 11 || (schemaVersion === 15 || schemaVersion === 19)) ? 2 : 1).some((step: CivicStep) => step.recoveredFrom !== undefined && !([16, 17, 18, 19].includes(schemaVersion as number) && step.name === 'FINES') && !(tollObserved && step.name === 'TOLL')))) return { status: 'BLOCKED' };
          if ((schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && (typeof record.utilityObservedFromRevision !== 'string' || !/^[a-f0-9]{64}$/.test(record.utilityObservedFromRevision) || record.action !== 'confirm_smartcity_checkout' || record.steps.length < 2 || record.steps[0].name !== 'WALLET' || record.steps[0].state !== 'CONFIRMED' || record.steps[1].name !== 'UTILITY' || record.steps[1].state !== 'CONFIRMED' || !['STARTED', 'UNKNOWN'].includes(record.steps[1].recoveredFrom) || !record.steps[1].receiptReference || !record.steps[1].operationId || ((schemaVersion === 10 || (schemaVersion === 14 || schemaVersion === 18)) && record.steps[0].recoveredFrom !== undefined) || record.steps.slice(2).some((step: CivicStep) => step.recoveredFrom !== undefined && !([16, 17, 18, 19].includes(schemaVersion as number) && step.name === 'FINES') && !(tollObserved && step.name === 'TOLL')))) return { status: 'BLOCKED' };
          if ([16, 17, 18, 19].includes(schemaVersion as number)) {
            const expectsUtility = !!review && review.billAmountMinor > 0, fineIndex = expectsUtility ? 2 : 1, fine = record.steps[fineIndex];
            if (typeof record.finesObservedFromRevision !== 'string' || !/^[a-f0-9]{64}$/.test(record.finesObservedFromRevision) || record.action !== 'confirm_smartcity_checkout' || !review || !review.fines.length || ![fineIndex + 1, fineIndex + 2].includes(record.steps.length) || (record.steps.length === fineIndex + 2 && record.steps.at(-1).name !== 'TOLL') || record.steps[0].name !== 'WALLET' || record.steps[0].state !== 'CONFIRMED' || (expectsUtility && (record.steps[1].name !== 'UTILITY' || record.steps[1].state !== 'CONFIRMED')) || !fine || fine.name !== 'FINES' || fine.state !== 'CONFIRMED' || !['STARTED', 'UNKNOWN'].includes(fine.recoveredFrom) || !fine.receiptReference || !fine.operationId) return { status: 'BLOCKED' };
          }
          if (tollObserved) {
            const last = record.steps.at(-1);
            if (typeof record.tollObservedFromRevision !== 'string' || !/^[a-f0-9]{64}$/.test(record.tollObservedFromRevision) || record.action !== 'confirm_smartcity_checkout' || !review || !completeCivicSteps(review, record.steps) || !last || last.name !== 'TOLL' || !['STARTED', 'UNKNOWN'].includes(last.recoveredFrom) || !last.operationId) return { status: 'BLOCKED' };
          }
          return { status: 'BLOCKED', sessionId: record.sessionId, action: record.action as CivicAction, ...((schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) ? { revision: createHash('sha256').update(raw).digest('hex') } : {}), ...((schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && typeof record.surfaceRevision === 'string' && /^[0-9a-f-]{36}$/.test(record.surfaceRevision) ? { surfaceRevision: record.surfaceRevision } : {}), ...((schemaVersion === 7 || schemaVersion === 9 || schemaVersion === 11 || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 15 || schemaVersion === 19)) ? { observedFromRevision: record.observedFromRevision as string } : {}), ...((schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) ? { utilityObservedFromRevision: record.utilityObservedFromRevision as string } : {}), ...([16, 17, 18, 19].includes(schemaVersion as number) ? { finesObservedFromRevision: record.finesObservedFromRevision as string } : {}), ...(tollObserved ? { tollObservedFromRevision: record.tollObservedFromRevision as string } : {}), ...(review ? { civicReview: review } : {}), civicSteps: record.steps.map((step: CivicStep) => ({ name: step.name, state: step.state, ...((schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && step.receiptReference ? { receiptReference: step.receiptReference } : {}), ...((schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && step.operationId ? { operationId: step.operationId } : {}), ...(step.serviceEpoch ? { serviceEpoch: step.serviceEpoch } : {}), ...((schemaVersion === 7 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11 || (schemaVersion === 12 || schemaVersion === 16) || (schemaVersion === 13 || schemaVersion === 17) || (schemaVersion === 14 || schemaVersion === 18) || (schemaVersion === 15 || schemaVersion === 19)) && step.recoveredFrom ? { recoveredFrom: step.recoveredFrom } : {}) })) };
        }
      }
    } catch { /* A legacy or unreadable fence stays blocked without exposing its contents. */ }
    return { status: 'BLOCKED' };
  }
  async observeCivicWallet(subject: string, accountId: string, revision: string, receiptReference: string): Promise<string> {
    if (!civicReference(receiptReference)) throw new SessionError(409, 'CIVIC_EVIDENCE_INCOMPLETE', 'Wallet evidence is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; steps?: CivicStep[] };
      const step = Array.isArray(record.steps) && record.steps.length === 1 ? record.steps[0] : undefined;
      if ((record.version !== 6 && record.version !== 8 && record.version !== 12 && record.version !== 20) || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !step || step.name !== 'WALLET' || !['STARTED', 'UNKNOWN'].includes(step.state) || !step.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(step.operationId)) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, version: record.version === 6 ? 7 : record.version === 8 ? 9 : record.version === 12 ? 13 : 21, observedFromRevision: revision, steps: [{ ...step, state: 'CONFIRMED', receiptReference, recoveredFrom: step.state }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return createHash('sha256').update(updated).digest('hex');
  }
  async observeCivicUtility(subject: string, accountId: string, revision: string, receiptReference: string): Promise<string> {
    if (!civicReference(receiptReference)) throw new SessionError(409, 'CIVIC_EVIDENCE_INCOMPLETE', 'Utility evidence is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; steps?: CivicStep[] };
      const steps = record.steps, wallet = Array.isArray(steps) && steps.length === 2 ? steps[0] : undefined, utility = Array.isArray(steps) && steps.length === 2 ? steps[1] : undefined;
      if ((record.version !== 8 && record.version !== 9 && record.version !== 12 && record.version !== 13 && record.version !== 20 && record.version !== 21) || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !wallet || wallet.name !== 'WALLET' || wallet.state !== 'CONFIRMED' || !utility || utility.name !== 'UTILITY' || !['STARTED', 'UNKNOWN'].includes(utility.state) || !utility.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(utility.operationId)) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, version: record.version === 8 ? 10 : record.version === 9 ? 11 : record.version === 12 ? 14 : record.version === 13 ? 15 : record.version === 20 ? 22 : 23, utilityObservedFromRevision: revision, steps: [wallet, { ...utility, state: 'CONFIRMED', receiptReference, recoveredFrom: utility.state }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return createHash('sha256').update(updated).digest('hex');
  }
  async observeCivicFines(subject: string, accountId: string, revision: string, receiptReference: string): Promise<string> {
    if (!civicReference(receiptReference)) throw new SessionError(409, 'CIVIC_EVIDENCE_INCOMPLETE', 'Fine evidence is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; review?: unknown; steps?: CivicStep[] };
      const review = civicReview(record.review), steps = record.steps, fine = Array.isArray(steps) ? steps.at(-1) : undefined;
      const expectsUtility = !!review && review.billAmountMinor > 0;
      if (![12, 13, 14, 15, 20, 21, 22, 23].includes(record.version as number) || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !review || !review.fines.length || !Array.isArray(steps) || steps.length !== (expectsUtility ? 3 : 2) || steps[0].name !== 'WALLET' || steps[0].state !== 'CONFIRMED' || (expectsUtility && (steps[1].name !== 'UTILITY' || steps[1].state !== 'CONFIRMED')) || !fine || fine.name !== 'FINES' || !['STARTED', 'UNKNOWN'].includes(fine.state) || !fine.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(fine.operationId)) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, version: (record.version as number) + 4, finesObservedFromRevision: revision, steps: [...steps.slice(0, -1), { ...fine, state: 'CONFIRMED', receiptReference, recoveredFrom: fine.state }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return createHash('sha256').update(updated).digest('hex');
  }
  async observeCivicToll(subject: string, accountId: string, revision: string, receiptReference: string): Promise<string> {
    if (!civicReference(receiptReference)) throw new SessionError(409, 'CIVIC_EVIDENCE_INCOMPLETE', 'Toll evidence is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; review?: unknown; steps?: CivicStep[] };
      const review = civicReview(record.review), steps = record.steps, toll = Array.isArray(steps) ? steps.at(-1) : undefined;
      if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 20 || record.version > 27 || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !review || !Array.isArray(steps) || !toll || toll.name !== 'TOLL' || !['STARTED', 'UNKNOWN'].includes(toll.state) || !toll.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(toll.operationId) || !completeCivicSteps(review, [...steps.slice(0, -1), { ...toll, state: 'CONFIRMED', receiptReference }])) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, version: record.version + 8, tollObservedFromRevision: revision, steps: [...steps.slice(0, -1), { ...toll, state: 'CONFIRMED', receiptReference, recoveredFrom: toll.state }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return createHash('sha256').update(updated).digest('hex');
  }
  async startCivicContinuation(subject: string, accountId: string, revision: string, nextName: CivicStepName, serviceEpoch: string): Promise<{ name: CivicStepName; operationId: string; revision: string }> {
    if (!/^[0-9a-f-]{36}$/.test(serviceEpoch)) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The fixture lifetime is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string, name: CivicStepName, operationId: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; surfaceRevision?: unknown; review?: unknown; steps?: CivicStep[] };
      const review = civicReview(record.review), steps = record.steps;
      if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 20 || record.version > 27 || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || typeof record.surfaceRevision !== 'string' || !/^[0-9a-f-]{36}$/.test(record.surfaceRevision) || !review || !Array.isArray(steps)) throw new Error('context mismatch');
      const expected: CivicStepName[] = ['WALLET', ...(review.billAmountMinor ? ['UTILITY' as const] : []), ...(review.fines.length ? ['FINES' as const] : []), 'TOLL'];
      if (!steps.length || steps.length >= expected.length || steps.some((step, index) => step.name !== expected[index] || step.state !== 'CONFIRMED' || !civicReference(step.receiptReference))) throw new Error('context mismatch');
      name = expected[steps.length]; if (name !== nextName) throw new Error('step mismatch');
      operationId = `CIVIC-${randomUUID()}`;
      updated = JSON.stringify({ ...record, steps: [...steps, { name, state: 'STARTED', operationId, serviceEpoch }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The original checkout cannot continue.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return { name, operationId, revision: createHash('sha256').update(updated).digest('hex') };
  }
  async retryCivicContinuation(subject: string, accountId: string, revision: string, rejectedEpoch?: string): Promise<{ name: CivicStepName; operationId: string; serviceEpoch: string; revision: string }> {
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string, name: CivicStepName, operationId: string, serviceEpoch: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; action?: unknown; surfaceRevision?: unknown; review?: unknown; steps?: CivicStep[] };
      const review = civicReview(record.review), steps = record.steps, last = Array.isArray(steps) ? steps.at(-1) : undefined;
      if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 20 || record.version > 27 || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || typeof record.surfaceRevision !== 'string' || !/^[0-9a-f-]{36}$/.test(record.surfaceRevision) || !review || !Array.isArray(steps) || !last || !['STARTED', 'UNKNOWN', 'REJECTED'].includes(last.state) || !last.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(last.operationId) || !last.serviceEpoch || !/^[0-9a-f-]{36}$/.test(last.serviceEpoch)) throw new Error('context mismatch');
      const expected: CivicStepName[] = ['WALLET', ...(review.billAmountMinor ? ['UTILITY' as const] : []), ...(review.fines.length ? ['FINES' as const] : []), 'TOLL'];
      if (steps.length < 1 || steps.length > expected.length || last.name !== expected[steps.length - 1] || steps.slice(0, -1).some((step, index) => step.name !== expected[index] || step.state !== 'CONFIRMED' || !civicReference(step.receiptReference))) throw new Error('context mismatch');
      if (last.state === 'REJECTED') {
        if (last.retryNonce !== undefined || !rejectedEpoch || !/^[0-9a-f-]{36}$/.test(rejectedEpoch)) throw new Error('rejected step cannot rebind');
      } else if (rejectedEpoch !== undefined) throw new Error('uncertain step cannot rebind');
      name = last.name; operationId = last.operationId; serviceEpoch = rejectedEpoch ?? last.serviceEpoch;
      updated = JSON.stringify({ ...record, steps: [...steps.slice(0, -1), { ...last, state: 'STARTED', serviceEpoch, ...(serviceEpoch !== last.serviceEpoch ? { previousServiceEpoch: last.serviceEpoch } : {}), retryNonce: randomUUID() }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The original step cannot be retried.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return { name, operationId, serviceEpoch, revision: createHash('sha256').update(updated).digest('hex') };
  }
  async finishCivicContinuation(subject: string, accountId: string, revision: string, operationId: string, state: 'CONFIRMED' | 'REJECTED' | 'UNKNOWN', receiptReference?: string): Promise<string> {
    if (receiptReference !== undefined && (state !== 'CONFIRMED' || !civicReference(receiptReference)) || state === 'CONFIRMED' && !receiptReference) throw new SessionError(409, 'CIVIC_EVIDENCE_INCOMPLETE', 'The continuation receipt is unavailable.');
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let updated: string;
    try {
      const record = JSON.parse(raw) as { owner?: unknown; action?: unknown; steps?: CivicStep[] };
      const steps = record.steps, last = Array.isArray(steps) ? steps.at(-1) : undefined;
      if (record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !steps || !last || last.state !== 'STARTED' || last.operationId !== operationId) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, steps: [...steps.slice(0, -1), { ...last, state, ...(receiptReference ? { receiptReference } : {}) }] });
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`, { keys: [key], arguments: [raw, updated] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    return createHash('sha256').update(updated).digest('hex');
  }
  async civicApprovalResolved(subject: string, accountId: string, sessionId: string, surfaceRevision: string): Promise<boolean> {
    await this.connect();
    return await this.client.exists(civicRetiredKey(this.prefix, civicOwnerDigest(subject, accountId), sessionId, surfaceRevision)) === 1;
  }
  async hasCivicResolution(subject: string, accountId: string, revision: string): Promise<boolean> {
    await this.connect();
    const [raw, active] = await this.client.mGet([`${this.prefix}civic-resolution:${revision}`, `${this.prefix}offline-civic-fence`]);
    if (!raw || raw === active || createHash('sha256').update(raw).digest('hex') !== revision) return false;
    try { const record = JSON.parse(raw) as { version?: unknown; owner?: unknown }; return (record.version === 5 || record.version === 6 || record.version === 7 || record.version === 8 || record.version === 9 || record.version === 10 || record.version === 11 || record.version === 12 || record.version === 13 || record.version === 14 || record.version === 15 || record.version === 16 || record.version === 17 || record.version === 18 || record.version === 19 || (typeof record.version === 'number' && record.version >= 20 && record.version <= 35)) && record.owner === civicOwnerDigest(subject, accountId); }
    catch { return false; }
  }
  async resolveCivicFence(subject: string, accountId: string, revision: string): Promise<void> {
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let retired: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; sessionId?: unknown; surfaceRevision?: unknown };
      if ((record.version !== 5 && record.version !== 6 && record.version !== 7 && record.version !== 8 && record.version !== 9 && record.version !== 10 && record.version !== 11 && record.version !== 12 && record.version !== 13 && record.version !== 14 && record.version !== 15 && record.version !== 16 && record.version !== 17 && record.version !== 18 && record.version !== 19 && !(typeof record.version === 'number' && record.version >= 20 && record.version <= 35)) || record.owner !== civicOwnerDigest(subject, accountId) || typeof record.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(record.sessionId) || typeof record.surfaceRevision !== 'string' || !/^[0-9a-f-]{36}$/.test(record.surfaceRevision)) throw new Error('context mismatch');
      retired = civicRetiredKey(this.prefix, record.owner, record.sessionId, record.surfaceRevision);
    } catch { throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.'); }
    const saved = await this.client.eval(`if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
      local archived=redis.call('GET',KEYS[2]); if archived and archived~=ARGV[1] then return 0 end
      redis.call('SET',KEYS[3],'1'); if not archived then redis.call('SET',KEYS[2],ARGV[1]) end; redis.call('DEL',KEYS[1]); return 1`, { keys: [key, `${this.prefix}civic-resolution:${revision}`, retired], arguments: [raw] });
    if (saved !== 1) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
  }
  async acquire(sid: string) {
    await this.connect();
    const key = `${this.key(sid)}:lock`, token = randomUUID();
    if (await this.client.set(key, token, { NX: true, PX: 120000 }) !== 'OK') throw new SessionError(409, 'SESSION_BUSY', 'A request is already running. Wait for its result.');
    await this.client.eval(`if redis.call('EXISTS',KEYS[2])==1 then return redis.call('PERSIST',KEYS[1]) else return redis.call('EXPIRE',KEYS[1],ARGV[1]) end`, { keys: [this.key(sid), this.compositeMarkerKey(sid)], arguments: [String(Math.max(this.ttl, 180))] });
    let lost = false;
    const assert = async () => { if (lost || await this.client.get(key) !== token) throw new SessionError(503, 'SESSION_LOCK_LOST', 'Request coordination was lost. Check operation status before retrying.'); };
    const timer = setInterval(() => { void this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then if redis.call('EXISTS',KEYS[3])==1 then redis.call('PERSIST',KEYS[2]) else redis.call('EXPIRE',KEYS[2],ARGV[2]) end; return redis.call('PEXPIRE',KEYS[1],120000) else return 0 end`, { keys: [key, this.key(sid), this.compositeMarkerKey(sid)], arguments: [token, String(Math.max(this.ttl, 180))] }).then(value => { if (value !== 1) lost = true; }).catch(() => { lost = true; }); }, 30000);
    timer.unref();
    return { assert,
      save: async (state: SuperAppAgentState) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw) throw new SessionError(503, 'SESSION_EXPIRED', 'Session expired before it could be saved.');
        const record = decodeRecord(raw);
        record.state = state; record.updatedAt = Date.now();
        // Serialize in JavaScript: Redis Lua cjson converts empty arrays into objects.
        const saved = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          if redis.call('EXISTS',KEYS[3])==1 then redis.call('SET',KEYS[1],ARGV[2]) else redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) end; return 1`, {
          keys: [this.key(sid), key, this.compositeMarkerKey(sid)], arguments: [token, JSON.stringify(record), String(this.ttl)],
        });
        if (saved !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'Session could not be saved. Check operation status before retrying.');
      },
      beginComposite: async (state: SuperAppAgentState) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw || !state.compositeAttempt) throw new SessionError(503, 'SESSION_EXPIRED', 'The original checkout cannot be saved.');
        const record = decodeRecord(raw), attempt = state.compositeAttempt;
        record.state = state; record.updatedAt = Date.now();
        const fence = JSON.stringify({ owner: civicOwnerDigest(record.owner, record.accountId), sessionId: sid, operationId: attempt.operationId });
        const saved = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          if redis.call('EXISTS',KEYS[3])==1 or redis.call('EXISTS',KEYS[4])==1 or redis.call('EXISTS',KEYS[6])==1 then return -1 end
          redis.call('SET',KEYS[1],ARGV[2]); redis.call('SET',KEYS[3],ARGV[3]); redis.call('SET',KEYS[4],ARGV[3]); redis.call('SADD',KEYS[5],KEYS[1]); redis.call('SET',KEYS[6],'PREPARED:'..ARGV[3]); return 1`, {
          keys: [this.key(sid), key, this.compositeMarkerKey(sid), this.compositeFenceKey(record.owner, record.accountId), this.pendingCompositeUserKey(record.owner), this.compositeDispatchKey(sid)], arguments: [token, JSON.stringify(record), fence],
        });
        if (saved === -1) throw new SessionError(409, 'COMPOSITE_RECONCILIATION_REQUIRED', 'An earlier composite checkout is in progress or needs reconciliation.');
        if (saved !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'The original checkout could not be saved.');
      },
      markCompositeDispatch: async (operationId: string) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw) throw new SessionError(503, 'SESSION_EXPIRED', 'The original checkout cannot be saved.');
        const record = decodeRecord(raw);
        const fence = JSON.stringify({ owner: civicOwnerDigest(record.owner, record.accountId), sessionId: sid, operationId });
        const marked = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          if redis.call('GET',KEYS[3])~=ARGV[2] or redis.call('GET',KEYS[4])~=ARGV[2] or redis.call('GET',KEYS[5])~='PREPARED:'..ARGV[2] then return -1 end
          redis.call('SET',KEYS[5],'DISPATCHING:'..ARGV[2]); return 1`, {
          keys: [this.key(sid), key, this.compositeMarkerKey(sid), this.compositeFenceKey(record.owner, record.accountId), this.compositeDispatchKey(sid)], arguments: [token, fence],
        });
        if (marked === -1) throw new SessionError(409, 'COMPOSITE_FENCE_CHANGED', 'The original checkout fence changed.');
        if (marked !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'The original checkout could not be saved.');
      },
      finishComposite: async (state: SuperAppAgentState, operationId: string) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw) throw new SessionError(503, 'SESSION_EXPIRED', 'The original checkout cannot be saved.');
        const record = decodeRecord(raw);
        record.state = state; record.updatedAt = Date.now();
        const fence = JSON.stringify({ owner: civicOwnerDigest(record.owner, record.accountId), sessionId: sid, operationId });
        const saved = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          local marker=redis.call('GET',KEYS[3]); local active=redis.call('GET',KEYS[4]); if marker and (marker~=ARGV[4] or active~=ARGV[4]) then return -1 end; if not marker and active==ARGV[4] then return -1 end
          local stage=redis.call('GET',KEYS[7]); if stage and stage~='DISPATCHING:'..ARGV[4] then return -1 end
          if marker then redis.call('DEL',KEYS[3],KEYS[4],KEYS[7]) end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); redis.call('SADD',KEYS[6],KEYS[1]); redis.call('EXPIRE',KEYS[6],ARGV[3]); redis.call('SREM',KEYS[5],KEYS[1]); return 1`, {
          keys: [this.key(sid), key, this.compositeMarkerKey(sid), this.compositeFenceKey(record.owner, record.accountId), this.pendingCompositeUserKey(record.owner), this.userKey(record.owner), this.compositeDispatchKey(sid)], arguments: [token, JSON.stringify(record), String(this.ttl), fence],
        });
        if (saved === -1) throw new SessionError(409, 'COMPOSITE_FENCE_CHANGED', 'The original checkout fence changed.');
        if (saved !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'The original checkout could not be saved.');
      },
      cancelUndispatchedComposite: async (state: SuperAppAgentState, operationId: string) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw) throw new SessionError(503, 'SESSION_EXPIRED', 'The original checkout cannot be saved.');
        const record = decodeRecord(raw);
        record.state = state; record.updatedAt = Date.now();
        const fence = JSON.stringify({ owner: civicOwnerDigest(record.owner, record.accountId), sessionId: sid, operationId });
        const saved = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          if redis.call('GET',KEYS[3])~=ARGV[4] or redis.call('GET',KEYS[4])~=ARGV[4] or redis.call('GET',KEYS[7])~='PREPARED:'..ARGV[4] then return -1 end
          redis.call('DEL',KEYS[3],KEYS[4],KEYS[7]); redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); redis.call('SADD',KEYS[6],KEYS[1]); redis.call('EXPIRE',KEYS[6],ARGV[3]); redis.call('SREM',KEYS[5],KEYS[1]); return 1`, {
          keys: [this.key(sid), key, this.compositeMarkerKey(sid), this.compositeFenceKey(record.owner, record.accountId), this.pendingCompositeUserKey(record.owner), this.userKey(record.owner), this.compositeDispatchKey(sid)], arguments: [token, JSON.stringify(record), String(this.ttl), fence],
        });
        if (saved === -1) throw new SessionError(409, 'COMPOSITE_DISPATCH_UNCONFIRMED', 'The original checkout may have started and cannot be cancelled this way.');
        if (saved !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'The original checkout could not be saved.');
      },
      remove: async (owner: string) => {
        const removed = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end
          if redis.call('EXISTS',KEYS[5])==1 then return -1 end
          redis.call('DEL',KEYS[1],KEYS[3]); redis.call('SREM',KEYS[4],KEYS[1]); return 1`, {
          keys: [this.key(sid), key, `${this.key(sid)}:events`, this.userKey(owner), this.compositeMarkerKey(sid)], arguments: [token],
        });
        if (removed === -1) throw new SessionError(409, 'COMPOSITE_RECONCILIATION_REQUIRED', 'The original checkout needs reconciliation before the session can be removed.');
        if (removed !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'Session could not be removed. Check operation status before retrying.');
      },
      release: async () => { clearInterval(timer); await this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`, { keys: [key], arguments: [token] }); },
    };
  }
  async list(owner: string) {
    await this.connect(); const [ordinary, pending] = await Promise.all([this.client.sMembers(this.userKey(owner)), this.client.sMembers(this.pendingCompositeUserKey(owner))]);
    const keys = [...new Set([...ordinary, ...pending])]; if (!keys.length) return [];
    const records = await this.client.mGet(keys);
    const ordinaryKeys = new Set(ordinary);
    const expired = keys.filter((key, i) => records[i] === null && ordinaryKeys.has(key)); if (expired.length) await this.client.sRem(this.userKey(owner), expired);
    return records.filter((r): r is string => r !== null).map(raw => decodeRecord(raw)).filter(r => r.owner === owner)
      .map(r => ({ sessionId: r.state.sessionId, accountId: r.accountId, updatedAt: r.updatedAt, title: r.state.messages.find(m => m.role === 'user')?.content.slice(0, 80) || 'New conversation' })).sort((a,b) => b.updatedAt-a.updatedAt);
  }
  async read(sid: string, owner: string): Promise<Record> {
    await this.connect(); const raw = await this.client.get(this.key(sid));
    if (!raw) throw new SessionError(404, 'SESSION_NOT_FOUND', 'Session not found or expired.');
    const record = decodeRecord(raw);
    if (record.owner !== owner) throw new SessionError(403, 'SESSION_FORBIDDEN', 'Session belongs to a different user.');
    return record;
  }
  async remove(sid: string, owner: string) {
    const lock = await this.acquire(sid);
    try { const record = await this.read(sid, owner); if (record.state.compositeAttempt) throw new SessionError(409, 'RECONCILIATION_REQUIRED', 'The original composite checkout needs reconciliation before this conversation can be deleted.'); await lock.remove(owner); }
    finally { await lock.release(); }
  }
  async publish(sid: string, event: A2UIMessageEnvelope) {
    await this.connect(); const raw = JSON.stringify(event);
    await this.client.multi().rPush(`${this.key(sid)}:events`, raw).lTrim(`${this.key(sid)}:events`, -100, -1).expire(`${this.key(sid)}:events`, this.ttl).publish(`${this.key(sid)}:channel`, raw).exec();
  }
  async after(sid: string, cursor: string) {
    await this.connect(); const events = (await this.client.lRange(`${this.key(sid)}:events`, 0, -1)).map(raw => JSON.parse(raw) as A2UIMessageEnvelope);
    const index = events.findIndex(e => e.id === cursor); return index < 0 ? undefined : events.slice(index + 1);
  }
  async subscribe(sid: string, callback: (event: A2UIMessageEnvelope) => void) {
    await this.connect();
    if (!this.subscriber) { this.subscriber = this.client.duplicate({ socket: { connectTimeout: 3000, reconnectStrategy: retries => Math.min(1000, 100 * retries) } }); this.subscriber.on('error', () => {}); await this.subscriber.connect(); }
    let callbacks = this.subscriptions.get(sid);
    if (!callbacks) {
      callbacks = new Set(); this.subscriptions.set(sid, callbacks);
      await this.subscriber.subscribe(`${this.key(sid)}:channel`, raw => { try { const event = JSON.parse(raw); for (const fn of this.subscriptions.get(sid) || []) fn(event); } catch {} });
    }
    callbacks.add(callback);
    return async () => { callbacks!.delete(callback); if (!callbacks!.size) { this.subscriptions.delete(sid); await this.subscriber?.unsubscribe(`${this.key(sid)}:channel`); } };
  }
  async close() { if (this.subscriber?.isOpen) await this.subscriber.quit(); if (this.client.isOpen) await this.client.quit(); }
}
let store: RedisSessionStore | undefined;
export function redisSessions() {
  if (process.env.SESSION_STORE !== 'redis') return undefined;
  if (!process.env.REDIS_URL) throw new SessionError(503, 'SESSION_STORE_UNAVAILABLE', 'REDIS_URL is required for Redis sessions.');
  const ttl = Number(process.env.SESSION_TTL_SECONDS || 3600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error('SESSION_TTL_SECONDS must be between 60 and 86400');
  const prefix = process.env.SESSION_KEY_PREFIX || 'superapp:';
  if (!/^[A-Za-z0-9:_-]{1,100}:$/.test(prefix)) throw new Error('SESSION_KEY_PREFIX must be a bounded Redis key prefix.');
  if (store && store.prefix !== prefix) {
    if (store.client.isOpen) throw new Error('Cannot switch an open session store namespace.');
    store = undefined;
  }
  return store ||= new RedisSessionStore(process.env.REDIS_URL, ttl, prefix);
}
