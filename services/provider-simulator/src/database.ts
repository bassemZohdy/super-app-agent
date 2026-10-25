import type { AccountEligibility } from './account-eligibility.ts';
import type { IssuerScenarios } from './issuer-scenarios.ts';
import type { PaymentEvents } from './payment-events.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { accountIdFor } from '../../../packages/backend-kit/src/context.ts';
export class AccountDatabase {
  readonly db: DatabaseSync;
  readonly path: string;
  eligibility?:AccountEligibility;
  events?:PaymentEvents;
  issuerScenarios?:IssuerScenarios;
  automationRuns?:import('./automation-runs.ts').AutomationRuns;
  scenarioControls?:import('./scenario-controls.ts').ScenarioControls;
  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resources (account_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(account_id,kind,id));
      CREATE TABLE IF NOT EXISTS idempotency (account_id TEXT NOT NULL REFERENCES accounts(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(account_id,key));`);
  }
  accounts(subject: string) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO accounts(id,owner,label) VALUES(?,?,?)');
    for (const [slot, label] of [['personal', 'Personal account'], ['household', 'Household account']]) insert.run(accountIdFor(subject, slot), subject, label);
    return this.db.prepare('SELECT id,label FROM accounts WHERE owner=? ORDER BY label DESC').all(subject) as Array<{ id: string; label: string }>;
  }
  owns(subject: string, id: string) { return this.db.prepare('SELECT id FROM accounts WHERE id=? AND owner=?').get(id, subject) !== undefined; }
  get<T = any>(account: string, kind: string, id = 'current'): T | undefined {
    const row = this.db.prepare('SELECT body FROM resources WHERE account_id=? AND kind=? AND id=?').get(account, kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  put(account: string, kind: string, value: any, id = 'current') {
    this.db.prepare('INSERT INTO resources(account_id,kind,id,body) VALUES(?,?,?,?) ON CONFLICT(account_id,kind,id) DO UPDATE SET body=excluded.body').run(account, kind, id, JSON.stringify(value));
  }
  list(account: string, kind: string) { return this.db.prepare('SELECT body FROM resources WHERE account_id=? AND kind=? ORDER BY rowid DESC LIMIT 100').all(account, kind).map((row: any) => JSON.parse(row.body)); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
