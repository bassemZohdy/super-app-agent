import { useState } from 'react';
import { formatAED } from '../../../packages/protocol-core/src/payments.ts';
import type { RecoveryAction, RecoveryAudit, RecoveryCase, RecoveryInspection } from '../../../packages/protocol-core/src/payment-reconciliation.ts';
type Props = {
  busy: boolean;
  read(path: string, query?: Record<string, string>): Promise<any>;
  mutate(path: string, input: Record<string, unknown>): Promise<any>;
  work(fn: () => Promise<void>): Promise<void>;
};
const actionLabel: Record<RecoveryAction, string> = {
  RECOVER_ORIGINAL: 'Resume original operation',
  REQUEST_REFUND_REVIEW: 'Request original-source refund review',
  REFUND_UNAPPLIED_LEGACY: 'Return confirmed unapplied capture',
};
/** Fetch recovery evidence on demand; ordinary account opening needs no extra source calls. */
export function PaymentRecoveryPanel({ busy, read, mutate, work }: Props) {
  const [cases, setCases] = useState<RecoveryCase[]>(), [cursor, setCursor] = useState<string | null>(null);
  const [inspection, setInspection] = useState<RecoveryInspection>(), [audit, setAudit] = useState<RecoveryAudit[]>([]);
  const [inspectionId, setInspectionId] = useState('');
  const inspect = (c: RecoveryCase) => void work(async () => {
    setInspection(undefined); setAudit([]);
    const result = await mutate('reconciliation/inspect', { kind: c.kind, operationId: c.operationId });
    setInspection(result.inspection); setInspectionId(result.inspection.id);
    setAudit((await read('reconciliation/audit', { kind: c.kind, operationId: c.operationId })).audit);
  });
  const refreshAudit = async (i: RecoveryInspection) => setAudit((await read('reconciliation/audit', { kind: i.kind, operationId: i.operationId })).audit);
  return <section className="payment-review" aria-label="Payment recovery">
    <h3>Payment recovery</h3>
    <p>Inspect the original capture and current provider status before choosing a recovery action. Missing provider evidence keeps funds blocked.</p>
    <button disabled={busy} onClick={() => void work(async () => {
      const result = await read('reconciliation'); setCases(result.cases); setCursor(result.nextCursor);
    })}>Load recovery cases</button>
    {cases && <><p>{cases.length} cases loaded. All amounts are simulated.</p><ul>{cases.map(c => <li key={`${c.kind}:${c.operationId}`}>
      <strong>{c.kind} · {formatAED(c.amountMinor)}</strong><p>{c.provider} · {c.sourceLabel} · {c.state}</p><p>{c.operationId}</p>
      <button disabled={busy} onClick={() => inspect(c)}>Inspect {c.operationId}</button>
    </li>)}</ul>{cursor && <button disabled={busy} onClick={() => void work(async () => {
      const result = await read('reconciliation', { cursor });
      setCases(current => [...(current || []), ...result.cases.filter((c: RecoveryCase) => !current?.some(x => x.kind === c.kind && x.operationId === c.operationId))]); setCursor(result.nextCursor);
    })}>Load more recovery cases</button>}</>}
    <label>Saved inspection reference<input value={inspectionId} maxLength={160} onChange={e => setInspectionId(e.target.value)} placeholder="recovery_…" /></label>
    <button disabled={busy || !/^recovery_[a-f0-9-]{36}$/.test(inspectionId)} onClick={() => void work(async () => {
      const result = await read('reconciliation/inspection', { inspectionId }); setInspection(result.inspection); await refreshAudit(result.inspection);
    })}>Read saved recovery outcome</button>
    {inspection && <article aria-label="Recovery evidence">
      <h4>{inspection.classification.replace(/_/g, ' ')} · {formatAED(inspection.amountMinor)}</h4>
      <p>Original {inspection.operationId} · {inspection.state}</p><p>Funding {inspection.sourceLabel}</p>
      <p>Capture: {inspection.captureState} · Provider: {inspection.sourceState}</p><p>{inspection.reason}</p>
      <p>Inspection {inspection.id} · Action status {inspection.status}</p>
      {inspection.status === 'OPEN' && <p>Decision expires {new Date(inspection.expiresAt).toLocaleTimeString()}. Actions recheck current evidence.</p>}
      {inspection.resultId && <p>Result {inspection.resultId} · {inspection.resultState}. Refund reviews require separate approval in Payment refunds.</p>}
      {inspection.status !== 'COMPLETED' && inspection.actions.map(action => <button key={action} disabled={busy || inspection.status === 'RUNNING'} onClick={() => void work(async () => {
        const result = await mutate('reconciliation/act', { inspectionId: inspection.id, decisionDigest: inspection.decisionDigest, action });
        setInspection(result.inspection); await refreshAudit(result.inspection);
      })}>{actionLabel[action]}{action === 'REFUND_UNAPPLIED_LEGACY' ? ` · ${formatAED(inspection.amountMinor)}` : ''}</button>)}
      <button disabled={busy} onClick={() => inspect(inspection)}>Inspect current evidence again</button>
      <h4>Recovery audit</h4><p>Latest 100 records for this original operation.</p>
      <ol>{audit.map(row => <li key={row.id}>{new Date(row.at).toLocaleString()} · {row.phase}{row.state ? ` · ${row.state}` : ''}{row.code ? ` · ${row.code}` : ''}{row.paymentId ? ` · ${row.paymentId}` : ''}{row.resultId ? ` · ${row.resultId}` : ''}</li>)}</ol>
    </article>}
  </section>;
}
