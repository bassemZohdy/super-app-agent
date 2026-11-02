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
 redis.call('EXPIRE',KEYS[1],ARGV[4]); redis.call('SADD',KEYS[2],KEYS[1]); redis.call('EXPIRE',KEYS[2],ARGV[4]); return {'OK',existing} end
 if ARGV[5]~='1' then return {'NOT_FOUND'} end
 redis.call('SET',KEYS[1],ARGV[3],'EX',ARGV[4]); redis.call('SADD',KEYS[2],KEYS[1]); redis.call('EXPIRE',KEYS[2],ARGV[4]); return {'OK',ARGV[3]}`;
type CivicAction = 'confirm_smartcity_checkout' | 'pay_utilities_bill' | 'pay_dewa_bill' | 'pay_police_fines';
type CivicOwner = { subject: string; accountId: string; sessionId: string; action: CivicAction; surfaceRevision?: string };
export type CivicStepName = 'WALLET' | 'UTILITY' | 'FINES' | 'TOLL';
type CivicStepState = 'STARTED' | 'CONFIRMED' | 'REJECTED' | 'UNKNOWN';
type CivicStep = { name: CivicStepName; state: CivicStepState; receiptReference?: string; operationId?: string; recoveredFrom?: 'STARTED' | 'UNKNOWN' };
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
  async claim(sid: string, owner: string, accountId: string, create = true): Promise<SuperAppAgentState> {
    await this.connect();
    const state: SuperAppAgentState = { sessionId: sid, messages: [], activeDomain: 'concierge', metadata: { accountId } };
    const record: Record = { owner, accountId, state, updatedAt: Date.now() };
    const result = await this.client.eval(claimScript, { keys: [this.key(sid), this.userKey(owner)], arguments: [owner, accountId, JSON.stringify(record), String(this.ttl), create ? '1' : '0'] }) as string[];
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
    let record = { version: 6, nonce: randomUUID(), owner: civicOwnerDigest(owner.subject, owner.accountId), sessionId: owner.sessionId, action: owner.action, surfaceRevision: owner.surfaceRevision ?? null, steps: [] as CivicStep[], review: null as CivicReview | null };
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
      startStep: async (name: CivicStepName) => {
        if (record.action === 'confirm_smartcity_checkout' && !record.review) throw new SessionError(409, 'CIVIC_REVIEW_REQUIRED', 'The civic payment review is required before starting a step.');
        if (!civicStepNames.has(name) || record.steps.length >= 4 || record.steps.some(step => step.name === name || step.state !== 'CONFIRMED')) throw new SessionError(409, 'CIVIC_STEP_INVALID', 'The civic payment step cannot be started.');
        const operationId = name === 'WALLET' && record.action === 'confirm_smartcity_checkout' ? `CIVIC-${randomUUID()}` : undefined;
        await save({ ...record, steps: [...record.steps, { name, state: 'STARTED', ...(operationId ? { operationId } : {}) }] });
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
  async inspectCivicFence(subject: string, accountId: string): Promise<{ status: 'CLEAR' | 'BLOCKED'; sessionId?: string; action?: CivicAction; civicSteps?: CivicStep[]; civicReview?: CivicReview; revision?: string; surfaceRevision?: string; observedFromRevision?: string }> {
    await this.connect();
    const raw = await this.client.get(`${this.prefix}offline-civic-fence`);
    if (raw === null) return { status: 'CLEAR' };
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; sessionId?: unknown; action?: unknown; steps?: unknown; review?: unknown; surfaceRevision?: unknown; observedFromRevision?: unknown };
      if (record && (record.version === 1 || record.version === 2 || record.version === 3 || record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) && record.owner === civicOwnerDigest(subject, accountId) &&
          typeof record.sessionId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(record.sessionId) &&
          typeof record.action === 'string' && civicActions.has(record.action)) {
        if (record.version === 1) return { status: 'BLOCKED', sessionId: record.sessionId, action: record.action as CivicAction };
        if (Array.isArray(record.steps) && record.steps.length <= 4 && record.steps.every((step: unknown) => !!step && typeof step === 'object' && civicStepNames.has((step as CivicStep).name) && civicStepStates.has((step as CivicStep).state))) {
          const review = (record.version === 3 || record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) && record.review !== null ? civicReview(record.review) : undefined;
          if ((record.version === 3 || record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) && record.review !== null && !review) return { status: 'BLOCKED' };
          if ((record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) && record.steps.some((step: CivicStep) => step.receiptReference !== undefined && (step.state !== 'CONFIRMED' || !civicReference(step.receiptReference)))) return { status: 'BLOCKED' };
          if ((record.version === 6 || record.version === 7) && record.steps.some((step: CivicStep) => (step.name === 'WALLET' && record.action === 'confirm_smartcity_checkout' && !step.operationId) || (step.operationId !== undefined && (step.name !== 'WALLET' || !/^CIVIC-[0-9a-f-]{36}$/.test(step.operationId))))) return { status: 'BLOCKED' };
          if (record.version === 7 && (typeof record.observedFromRevision !== 'string' || !/^[a-f0-9]{64}$/.test(record.observedFromRevision) || record.action !== 'confirm_smartcity_checkout' || !record.steps.length || record.steps[0].name !== 'WALLET' || record.steps[0].state !== 'CONFIRMED' || !['STARTED', 'UNKNOWN'].includes(record.steps[0].recoveredFrom) || !record.steps[0].receiptReference || !record.steps[0].operationId || record.steps.slice(1).some((step: CivicStep) => step.recoveredFrom !== undefined))) return { status: 'BLOCKED' };
          return { status: 'BLOCKED', sessionId: record.sessionId, action: record.action as CivicAction, ...((record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) ? { revision: createHash('sha256').update(raw).digest('hex') } : {}), ...((record.version === 5 || record.version === 6 || record.version === 7) && typeof record.surfaceRevision === 'string' && /^[0-9a-f-]{36}$/.test(record.surfaceRevision) ? { surfaceRevision: record.surfaceRevision } : {}), ...(record.version === 7 ? { observedFromRevision: record.observedFromRevision as string } : {}), ...(review ? { civicReview: review } : {}), civicSteps: record.steps.map((step: CivicStep) => ({ name: step.name, state: step.state, ...((record.version === 4 || record.version === 5 || record.version === 6 || record.version === 7) && step.receiptReference ? { receiptReference: step.receiptReference } : {}), ...((record.version === 6 || record.version === 7) && step.operationId ? { operationId: step.operationId } : {}), ...(record.version === 7 && step.recoveredFrom ? { recoveredFrom: step.recoveredFrom } : {}) })) };
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
      if (record.version !== 6 || record.owner !== civicOwnerDigest(subject, accountId) || record.action !== 'confirm_smartcity_checkout' || !step || step.name !== 'WALLET' || !['STARTED', 'UNKNOWN'].includes(step.state) || !step.operationId || !/^CIVIC-[0-9a-f-]{36}$/.test(step.operationId)) throw new Error('context mismatch');
      updated = JSON.stringify({ ...record, version: 7, observedFromRevision: revision, steps: [{ ...step, state: 'CONFIRMED', receiptReference, recoveredFrom: step.state }] });
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
    try { const record = JSON.parse(raw) as { version?: unknown; owner?: unknown }; return (record.version === 5 || record.version === 6 || record.version === 7) && record.owner === civicOwnerDigest(subject, accountId); }
    catch { return false; }
  }
  async resolveCivicFence(subject: string, accountId: string, revision: string): Promise<void> {
    await this.connect();
    const key = `${this.prefix}offline-civic-fence`, raw = await this.client.get(key);
    if (!raw || createHash('sha256').update(raw).digest('hex') !== revision) throw new SessionError(409, 'CIVIC_REVIEW_CHANGED', 'The civic review changed.');
    let retired: string;
    try {
      const record = JSON.parse(raw) as { version?: unknown; owner?: unknown; sessionId?: unknown; surfaceRevision?: unknown };
      if ((record.version !== 5 && record.version !== 6 && record.version !== 7) || record.owner !== civicOwnerDigest(subject, accountId) || typeof record.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(record.sessionId) || typeof record.surfaceRevision !== 'string' || !/^[0-9a-f-]{36}$/.test(record.surfaceRevision)) throw new Error('context mismatch');
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
    await this.client.expire(this.key(sid), Math.max(this.ttl, 180));
    let lost = false;
    const assert = async () => { if (lost || await this.client.get(key) !== token) throw new SessionError(503, 'SESSION_LOCK_LOST', 'Request coordination was lost. Check operation status before retrying.'); };
    const timer = setInterval(() => { void this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('EXPIRE',KEYS[2],ARGV[2]); return redis.call('PEXPIRE',KEYS[1],120000) else return 0 end`, { keys: [key, this.key(sid)], arguments: [token, String(Math.max(this.ttl, 180))] }).then(value => { if (value !== 1) lost = true; }).catch(() => { lost = true; }); }, 30000);
    timer.unref();
    return { assert,
      save: async (state: SuperAppAgentState) => {
        const raw = await this.client.get(this.key(sid));
        if (!raw) throw new SessionError(503, 'SESSION_EXPIRED', 'Session expired before it could be saved.');
        const record = decodeRecord(raw);
        record.state = state; record.updatedAt = Date.now();
        // Serialize in JavaScript: Redis Lua cjson converts empty arrays into objects.
        const saved = await this.client.eval(`if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('EXISTS',KEYS[1])==0 then return 0 end
          redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1`, {
          keys: [this.key(sid), key], arguments: [token, JSON.stringify(record), String(this.ttl)],
        });
        if (saved !== 1) throw new SessionError(503, 'SESSION_LOCK_LOST', 'Session could not be saved. Check operation status before retrying.');
      },
      release: async () => { clearInterval(timer); await this.client.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`, { keys: [key], arguments: [token] }); },
    };
  }
  async list(owner: string) {
    await this.connect(); const keys = await this.client.sMembers(this.userKey(owner)); if (!keys.length) return [];
    const records = await this.client.mGet(keys);
    const expired = keys.filter((_, i) => records[i] === null); if (expired.length) await this.client.sRem(this.userKey(owner), expired);
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
    await this.read(sid, owner); const lock = await this.acquire(sid);
    try { await this.client.del([this.key(sid), `${this.key(sid)}:events`]); await this.client.sRem(this.userKey(owner), this.key(sid)); }
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
  return store ||= new RedisSessionStore(process.env.REDIS_URL, ttl);
}
