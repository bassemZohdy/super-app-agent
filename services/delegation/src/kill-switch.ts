/** Desired kill-switch state held by the broker (AUTO-15 step 3b-ii).
 *
 *  The admin client writes it; the automation worker reads it and applies it to its own store. The broker never runs or
 *  pauses anything itself, and nothing here grants any other authority: a write needs the admin client with its admin scope,
 *  a read needs the worker's execute scope, and every other caller is refused. */
import { DatabaseSync } from 'node:sqlite';
import { DelegationError, automationAdminClient, automationWorkerClient } from './policy.ts';

export type DesiredKillSwitch = { engaged: boolean; reason: string; setBy: string; at: number };
type Claims = { sub?: unknown; azp?: unknown; scope?: unknown; act?: unknown };

const scopes = (claims: Claims) => String(claims.scope || '').split(' ');

/** Only the admin client, with its admin scope and no delegation chain, may set the desired state. */
export function authorizeKillSwitchWrite(claims: Claims) {
  if (claims.azp !== automationAdminClient || claims.act !== undefined || !scopes(claims).includes('automation.admin'))
    throw new DelegationError(403, 'KILL_SWITCH_ADMIN_REQUIRED', 'Only the automation admin client may set the kill switch.');
}

/** Only the automation worker, with its execute scope, may read the desired state it applies. */
export function authorizeKillSwitchRead(claims: Claims) {
  if (claims.azp !== automationWorkerClient || claims.act !== undefined || !scopes(claims).includes('automation.execute'))
    throw new DelegationError(403, 'KILL_SWITCH_WORKER_REQUIRED', 'Only the automation worker may read the kill switch.');
}

export class DesiredKillSwitchStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS desired_kill_switch(id TEXT PRIMARY KEY CHECK(id='global'),engaged INTEGER NOT NULL CHECK(engaged IN (0,1)),reason TEXT NOT NULL,set_by TEXT NOT NULL,at INTEGER NOT NULL);`);
  }
  get(): DesiredKillSwitch | undefined {
    const r = this.db.prepare("SELECT engaged,reason,set_by,at FROM desired_kill_switch WHERE id='global'").get();
    return r ? { engaged: Number(r.engaged) === 1, reason: String(r.reason), setBy: String(r.set_by), at: Number(r.at) } : undefined;
  }
  set(engaged: boolean, reason: string, setBy: string, now = Date.now()): DesiredKillSwitch {
    this.db.prepare("INSERT INTO desired_kill_switch(id,engaged,reason,set_by,at) VALUES('global',?,?,?,?) ON CONFLICT(id) DO UPDATE SET engaged=excluded.engaged,reason=excluded.reason,set_by=excluded.set_by,at=excluded.at")
      .run(engaged ? 1 : 0, reason.slice(0, 120), setBy.slice(0, 200), now);
    return this.get()!;
  }
}
