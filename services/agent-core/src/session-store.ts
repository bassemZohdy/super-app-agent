import { createClient, type RedisClientType } from 'redis';
import { createHash, randomUUID } from 'node:crypto';
import type { SuperAppAgentState } from './langgraph/state.ts';
import type { A2UIMessageEnvelope } from '../../../packages/protocol-core/src/index.ts';
export class SessionError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
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
