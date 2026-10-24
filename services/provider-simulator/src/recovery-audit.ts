/** Append-only gateway recovery decisions. Transactional journals/outboxes remain the money-effect evidence. */
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { RecoveryKind,RecoveryAudit } from '../../../packages/protocol-core/src/payment-reconciliation.ts';
import type { AccountDatabase } from './database.ts';
export function initializeRecoveryAudit(store:AccountDatabase){store.db.exec(`CREATE TABLE IF NOT EXISTS payment_recovery_audit(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)));
  CREATE INDEX IF NOT EXISTS recovery_audit_operation ON payment_recovery_audit(account_id,kind,operation_id);
  CREATE TRIGGER IF NOT EXISTS recovery_audit_no_update BEFORE UPDATE ON payment_recovery_audit BEGIN SELECT RAISE(ABORT,'Recovery audit is immutable');END;
  CREATE TRIGGER IF NOT EXISTS recovery_audit_no_delete BEFORE DELETE ON payment_recovery_audit BEGIN SELECT RAISE(ABORT,'Recovery audit is immutable');END;`);}
export function appendRecoveryAudit(store:AccountDatabase,actor:Actor,kind:RecoveryKind,operationId:string,phase:string,extra:Partial<Pick<RecoveryAudit,'inspectionId'|'state'|'code'|'paymentId'|'resultId'>>={}){
  const row:RecoveryAudit={id:`recovery_audit_${randomUUID()}`,kind,operationId,ownerSub:actor.sub,at:new Date().toISOString(),phase,...(/^recovery_[a-f0-9-]{36}$/.test(actor.requestId)?{inspectionId:actor.requestId}:{}),...extra};
  if(row.code&&!/^[A-Z0-9_]{1,80}$/.test(row.code))row.code='UNKNOWN';
  store.db.prepare('INSERT INTO payment_recovery_audit VALUES(?,?,?,?,?)').run(row.id,actor.accountId,kind,operationId,JSON.stringify(row));return row;
}
