import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { brokerClient, deny, digest, grantInput, type GrantInput, type Operation } from './policy.ts';

export type Grant = GrantInput & { id: string; owner: string; issuer: string; actor: string; version: number; createdAt: number; expiresAt: number; revokedAt?: number; used: number; eligibilityEpoch?:string };
type Binding = { grantId: string; version: number; sub: string; actor: string; exp: number; operationId: string; requestDigest: string };
type Job = { id: string; grantId: string; requestKey: string; state: string; result?: unknown };
export class GrantStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(fingerprint TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,grant_id TEXT NOT NULL,request_key TEXT NOT NULL,state TEXT NOT NULL,result TEXT,UNIQUE(grant_id,request_key));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,grant_id TEXT,event TEXT NOT NULL,body TEXT NOT NULL);`);
  }
  atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  audit(id: string, event: string, body: unknown = {}) { this.db.prepare('INSERT INTO audit(at,grant_id,event,body) VALUES(?,?,?,?)').run(Date.now(), id, event, JSON.stringify(body)); }
  create(owner: string, input: GrantInput,eligibilityEpoch?:string): Grant {
    const valid = grantInput(owner, input), now = Date.now();
    if(eligibilityEpoch!==undefined&&!/^[1-9][0-9]{0,6}:[1-9][0-9]{0,6}$/.test(eligibilityEpoch))deny('INVALID_ELIGIBILITY_EPOCH');
    const grant: Grant = { ...valid,...(eligibilityEpoch?{eligibilityEpoch}:{}), id: randomUUID(), owner, issuer: process.env.KEYCLOAK_ISSUER || 'test-issuer', actor: brokerClient, version: 1, createdAt: now, expiresAt: now + valid.expiresInSeconds * 1000, used: 0 };
    return this.atomic(() => { this.save(grant, true); this.audit(grant.id, 'consent.created', { owner, actor: brokerClient, operation: digest(valid), purpose: valid.purpose }); return grant; });
  }
  private save(grant: Grant, insert = false) { this.db.prepare(insert ? 'INSERT INTO grants(id,owner,body) VALUES(?,?,?)' : 'UPDATE grants SET body=? WHERE id=? AND owner=?').run(...(insert ? [grant.id, grant.owner, JSON.stringify(grant)] : [JSON.stringify(grant), grant.id, grant.owner])); }
  get(id: string, owner?: string): Grant {
    const row = this.db.prepare('SELECT body FROM grants WHERE id=?').get(id) as { body: string } | undefined;
    if (!row) deny('GRANT_NOT_FOUND'); const grant = JSON.parse(row.body) as Grant;
    if (owner && grant.owner !== owner) deny('GRANT_NOT_FOUND'); return grant;
  }
  active(id: string): Grant { const grant = this.get(id); if (grant.issuer !== (process.env.KEYCLOAK_ISSUER || 'test-issuer') || grant.revokedAt || grant.expiresAt <= Date.now()) deny('GRANT_INACTIVE');
    // Retain old consent/audit, but never execute a grant outside today's explicit reviewed profile.
    grantInput(grant.owner,{accountId:grant.accountId,provider:grant.provider,method:grant.method,path:grant.path,body:grant.body,purpose:grant.purpose,expiresInSeconds:grant.expiresInSeconds,maxOperations:grant.maxOperations});return grant; }
  list(owner: string): Grant[] { return this.db.prepare('SELECT body FROM grants WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner).map(row => JSON.parse(String(row.body))); }
  history(id: string, owner: string) { this.get(id, owner); return this.db.prepare('SELECT seq,at,event,body FROM audit WHERE grant_id=? ORDER BY seq DESC LIMIT 200').all(id).map(row => ({ ...row, body: JSON.parse(String(row.body)) })); }
  jobs(id: string, owner: string) { this.get(id, owner); return this.db.prepare('SELECT id,request_key,state,result FROM jobs WHERE grant_id=? ORDER BY rowid DESC LIMIT 100').all(id).map(row => ({ ...row, result: row.result ? JSON.parse(String(row.result)) : undefined })); }
  revoke(id: string, owner: string) { return this.atomic(() => { const g = this.get(id, owner); if (!g.revokedAt) { g.revokedAt = Date.now(); g.version++; this.save(g); this.audit(id, 'consent.revoked', { owner, version: g.version }); } return g; }); }
  narrow(id: string, owner: string, input: { maxOperations: number; expiresAt: number }) {
    return this.atomic(() => {
      const g = this.get(id, owner); this.active(id);
      if (!input || Object.keys(input).sort().join(',') !== 'expiresAt,maxOperations' || !Number.isInteger(input.maxOperations) || input.maxOperations < g.used || input.maxOperations > g.maxOperations || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > g.expiresAt) deny('GRANT_EXPANSION_FORBIDDEN');
      g.maxOperations = input.maxOperations; g.expiresAt = input.expiresAt; g.version++;
      this.save(g); this.audit(id, 'consent.narrowed', { owner, version: g.version, maxOperations: g.maxOperations, expiresAt: g.expiresAt }); return g;
    });
  }
  start(id: string, requestKey: string): { job: Job; replay: boolean } {
    return this.atomic(() => {
      const g = this.active(id);
      const row = this.db.prepare('SELECT id,state,result FROM jobs WHERE grant_id=? AND request_key=?').get(id, requestKey) as { id: string; state: string; result?: string } | undefined;
      if (row) return { job: { id: row.id, grantId: id, requestKey, state: row.state, result: row.result ? JSON.parse(row.result) : undefined }, replay: true };
      const pending = this.db.prepare("SELECT id FROM jobs WHERE grant_id=? AND state!='completed'").get(id);
      if (pending) deny('RECONCILIATION_REQUIRED', 'A previous execution needs reconciliation; no new effect is permitted.');
      if (g.used >= g.maxOperations) deny('GRANT_LIMIT_REACHED');
      const job: Job = { id: randomUUID(), grantId: id, requestKey, state: 'pending' };
      this.db.prepare('INSERT INTO jobs(id,grant_id,request_key,state) VALUES(?,?,?,?)').run(job.id, id, requestKey, job.state);
      this.audit(id, 'execution.started', { operationId: job.id }); return { job, replay: false };
    });
  }
  bind(fingerprint: string, binding: Binding) {
    this.atomic(() => { const g = this.active(binding.grantId),job=this.db.prepare('SELECT state FROM jobs WHERE id=? AND grant_id=?').get(binding.operationId,g.id);
      if (!/^[a-f0-9]{64}$/.test(fingerprint)||!Number.isSafeInteger(binding.exp)||binding.exp*1000<=Date.now()||binding.exp*1000>g.expiresAt+1000||g.version!==binding.version||g.owner!==binding.sub||g.actor!==binding.actor||job?.state!=='pending'||binding.requestDigest!==digest({provider:g.provider,method:g.method,path:g.path,body:g.body}))deny('BINDING_MISMATCH');
      this.db.prepare('INSERT INTO bindings(fingerprint,body) VALUES(?,?)').run(fingerprint, JSON.stringify(binding)); this.audit(g.id, 'token.bound', { fingerprint, operationId: binding.operationId, exp: binding.exp }); });
  }
  boundGrant(fingerprint:string):Grant{const row=this.db.prepare('SELECT body FROM bindings WHERE fingerprint=?').get(fingerprint);if(!row)deny('TOKEN_NOT_BOUND');return this.active((JSON.parse(String(row!.body)) as Binding).grantId);}
  authorize(fingerprint: string, sub: string, actor: string, account: string, operation: Operation): Grant {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT body FROM bindings WHERE fingerprint=?').get(fingerprint) as { body: string } | undefined;
      if (!row) deny('TOKEN_NOT_BOUND'); const b = JSON.parse(row.body) as Binding, g = this.active(b.grantId);
      if (b.exp * 1000 <= Date.now() || b.version !== g.version || b.sub !== sub || g.owner !== sub || b.actor !== actor || g.actor !== actor || g.accountId !== account || b.requestDigest !== digest(operation) || digest({ provider: g.provider, method: g.method, path: g.path, body: g.body }) !== digest(operation)) deny('DELEGATION_MISMATCH');
      const job = this.db.prepare('SELECT state FROM jobs WHERE id=? AND grant_id=?').get(b.operationId, g.id) as { state: string } | undefined;
      if (!job || job.state !== 'pending') deny('OPERATION_ALREADY_AUTHORIZED');
      if (g.used >= g.maxOperations) deny('GRANT_LIMIT_REACHED');
      g.used++; this.save(g);
      this.db.prepare("UPDATE jobs SET state='authorized' WHERE id=?").run(b.operationId);
      this.audit(g.id, 'execution.authorized', { operationId: b.operationId, sub, actor, account, operation: digest(operation), amountMinor: g.body.amountMinor || 0 }); return g;
    });
  }
  finish(job: Job, result: unknown, success: boolean) { this.atomic(() => {
    const current=this.db.prepare('SELECT state FROM jobs WHERE id=? AND grant_id=? AND request_key=?').get(job.id,job.grantId,job.requestKey);
    if(!current||!['pending','authorized'].includes(String(current.state))||success&&current.state!=='authorized')deny('OPERATION_STATE_CHANGED','Only the original admitted operation can record completion; terminal results are retained.');
    const saved=this.db.prepare('UPDATE jobs SET state=?,result=? WHERE id=? AND state=?').run(success?'completed':'unknown',JSON.stringify(result),job.id,String(current.state));if(saved.changes!==1)deny('OPERATION_STATE_CHANGED');
    this.audit(job.grantId, success ? 'execution.completed' : 'execution.unknown', { operationId: job.id }); }); }
  close() { this.db.close(); }
}
