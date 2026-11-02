import { useState } from 'react';
import { formatTime, formatDateTime, translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
import { formatAED } from '../../../packages/protocol-core/src/payments.ts';
import type { RecoveryAudit, RecoveryCase, RecoveryInspection, RecoveryEvidenceIssue } from '../../../packages/protocol-core/src/payment-reconciliation.ts';
type Props = {
  busy: boolean;
  read(path: string, query?: Record<string, string>): Promise<any>;
  mutate(path: string, input: Record<string, unknown>): Promise<any>;
  work(fn: () => Promise<void>): Promise<void>;
  locale?: Locale;
};
/** Fetch recovery evidence on demand; ordinary account opening needs no extra source calls. */
export function PaymentRecoveryPanel({ busy, read, mutate, work, locale = 'en' }: Props) {
  const t = (key: CatalogKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [cases, setCases] = useState<RecoveryCase[]>(), [cursor, setCursor] = useState<string | null>(null);
  const [inspection, setInspection] = useState<RecoveryInspection>(), [audit, setAudit] = useState<RecoveryAudit[]>([]);
  const [inspectionId, setInspectionId] = useState('');
  const [issues, setIssues] = useState<RecoveryEvidenceIssue[] | null>();
  const [issuesTruncated, setIssuesTruncated] = useState(false), [issuesCursor, setIssuesCursor] = useState<string | null>(null);
  const updateIssues = (result: { evidenceIssues?: unknown; evidenceIssuesTruncated?: unknown; evidenceIssuesCursor?: unknown }, append = false) => {
    const rows = result.evidenceIssues, next = result.evidenceIssuesCursor;
    const validCursor = next === undefined || next === null || typeof next === 'string' && /^[A-Za-z0-9_-]{1,2000}$/.test(next);
    if (!Array.isArray(rows) || rows.length > 25 || typeof result.evidenceIssuesTruncated !== 'boolean' || !validCursor || typeof next === 'string' && !result.evidenceIssuesTruncated || rows.some(row => !row || typeof row !== 'object' || !['UNREADABLE_CHARGE','UNREADABLE_TRANSACTION','ORPHANED_CHARGE_JOURNAL'].includes(row.kind) || !(row.id === null || typeof row.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(row.id)))) { setIssues(null); setIssuesTruncated(false); setIssuesCursor(null); return; }
    setIssues(current => append ? [...(current || []), ...rows as RecoveryEvidenceIssue[]] : rows as RecoveryEvidenceIssue[]);
    setIssuesTruncated(result.evidenceIssuesTruncated); setIssuesCursor(typeof next === 'string' ? next : null);
  };
  const inspect = (c: RecoveryCase) => void work(async () => {
    setInspection(undefined); setAudit([]);
    const result = await mutate('reconciliation/inspect', { kind: c.kind, operationId: c.operationId });
    setInspection(result.inspection); setInspectionId(result.inspection.id);
    setAudit((await read('reconciliation/audit', { kind: c.kind, operationId: c.operationId })).audit);
  });
  const refreshAudit = async (i: RecoveryInspection) => setAudit((await read('reconciliation/audit', { kind: i.kind, operationId: i.operationId })).audit);
  return <section className="payment-review" aria-label={t('recovery.title')}>
    <h3>{t('recovery.title')}</h3>
    <p>{t('recovery.intro')}</p>
    <button disabled={busy} onClick={() => void work(async () => {
      const result = await read('reconciliation'); setCases(result.cases); setCursor(result.nextCursor); updateIssues(result);
    })}>{t('recovery.load')}</button>
    {issues === null && <p role="status">{t('recovery.issuesUnknown')}</p>}
    {issues && issues.length > 0 && <section aria-label={t('recovery.evidenceIssues')}><h4>{t('recovery.evidenceIssues')}</h4><p>{t('recovery.evidenceIssuesNote')}</p><ul>{issues.map((issue, index) => <li key={`${issue.kind}:${issue.id ?? index}`}>{t(`recovery.issue.${issue.kind}`)} · {issue.id ?? t('recovery.issueUnknownId')}</li>)}</ul>{issuesTruncated && <p>{t('recovery.issuesMore')}</p>}{issuesCursor && <button disabled={busy} onClick={() => void work(async () => { const result = await read('reconciliation/evidence', { cursor: issuesCursor }); updateIssues(result, true); })}>{t('recovery.issuesLoadMore')}</button>}</section>}
    {cases && <><p>{t('recovery.loaded', { count: cases.length })}</p><ul>{cases.map(c => <li key={`${c.kind}:${c.operationId}`}>
      <strong>{c.kind} · {formatAED(c.amountMinor)}</strong><p>{c.provider} · {c.sourceLabel} · {c.state}</p><p>{c.operationId}</p>
      <button disabled={busy} onClick={() => inspect(c)}>{t('recovery.inspect', { id: c.operationId })}</button>
    </li>)}</ul>{cursor && <button disabled={busy} onClick={() => void work(async () => {
      const result = await read('reconciliation', { cursor });
      setCases(current => [...(current || []), ...result.cases.filter((c: RecoveryCase) => !current?.some(x => x.kind === c.kind && x.operationId === c.operationId))]); setCursor(result.nextCursor);
    })}>{t('recovery.loadMore')}</button>}</>}
    <label>{t('recovery.refLabel')}<input value={inspectionId} maxLength={160} onChange={e => setInspectionId(e.target.value)} placeholder="recovery_…" /></label>
    <button disabled={busy || !/^recovery_[a-f0-9-]{36}$/.test(inspectionId)} onClick={() => void work(async () => {
      const result = await read('reconciliation/inspection', { inspectionId }); setInspection(result.inspection); await refreshAudit(result.inspection);
    })}>{t('recovery.readSaved')}</button>
    {inspection && <article aria-label={t('recovery.evidence')}>
      <h4>{inspection.classification.replace(/_/g, ' ')} · {formatAED(inspection.amountMinor)}</h4>
      <p>{t('recovery.original', { id: inspection.operationId, state: inspection.state })}</p><p>{t('recovery.funding', { source: inspection.sourceLabel })}</p>
      <p>{t('recovery.states', { capture: inspection.captureState, provider: inspection.sourceState })}</p><p>{inspection.reason}</p>
      <p>{t('recovery.inspection', { id: inspection.id, status: inspection.status })}</p>
      {inspection.status === 'OPEN' && <p>{t('recovery.expires', { time: formatTime(locale, new Date(inspection.expiresAt)) })}</p>}
      {inspection.resultId && <p>{t('recovery.result', { id: inspection.resultId, state: inspection.resultState ?? '' })}</p>}
      {inspection.status !== 'COMPLETED' && inspection.actions.map(action => <button key={action} disabled={busy || inspection.status === 'RUNNING'} onClick={() => void work(async () => {
        const result = await mutate('reconciliation/act', { inspectionId: inspection.id, decisionDigest: inspection.decisionDigest, action });
        setInspection(result.inspection); await refreshAudit(result.inspection);
      })}>{t(`recovery.action.${action}`)}{action === 'REFUND_UNAPPLIED_LEGACY' ? ` · ${formatAED(inspection.amountMinor)}` : ''}</button>)}
      <button disabled={busy} onClick={() => inspect(inspection)}>{t('recovery.again')}</button>
      <h4>{t('recovery.auditTitle')}</h4><p>{t('recovery.auditNote')}</p>
      <ol>{audit.map(row => <li key={row.id}>{formatDateTime(locale, new Date(row.at))} · {row.phase}{row.state ? ` · ${row.state}` : ''}{row.code ? ` · ${row.code}` : ''}{row.paymentId ? ` · ${row.paymentId}` : ''}{row.resultId ? ` · ${row.resultId}` : ''}</li>)}</ol>
    </article>}
  </section>;
}
