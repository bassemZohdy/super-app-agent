import { useEffect, useState } from 'react';
import { formatTime, translate, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

type Operation = { operationId: string; method: string; path: string };
type Provider = { provider: string; ok: boolean; checkedAt: number; operations: Operation[]; problem?: string };
type Call = { at: number; provider: string; method: string; path: string; status: number; code?: string; ms: number };

const NAMES: Record<string, string> = { rta: 'RTA', dewa: 'DEWA', etisalat: 'etisalat', du: 'du', police: 'Dubai Police', dld: 'DLD', payments: 'Payments' };

/** What each provider advertises and what this resident's own calls to it did. Read-only: it shows the operations the providers
 *  describe and the calls made, with failures marked in words, and it can ask the gateway to read the providers again. */
export function ConnectionsPanel({ gateway, getToken, locale = 'en' }: { gateway: string; getToken: () => Promise<string>; locale?: Locale }) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const [providers, setProviders] = useState<Provider[]>([]), [calls, setCalls] = useState<Call[]>([]), [busy, setBusy] = useState(false);
  // The notice is kept as what happened, not as text, so it is worded in the current language when it is shown.
  const [outcome, setOutcome] = useState<{ kind: 'loading' } | { kind: 'ok'; count: number } | { kind: 'problem'; problems: number; count: number } | { kind: 'error'; message?: string }>({ kind: 'loading' });
  async function load(refresh: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`${gateway}/api/connections${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '');
      setProviders(data.providers); setCalls(data.calls);
      const refused = (data.providers as Provider[]).filter(item => !item.ok).length;
      setOutcome(refused ? { kind: 'problem', problems: refused, count: data.providers.length } : { kind: 'ok', count: data.providers.length });
    } catch (error) { setOutcome({ kind: 'error', message: (error as Error).message || undefined }); } finally { setBusy(false); }
  }
  useEffect(() => { void load(false); }, []);
  return <section className="payment-review connections-panel" role="region" aria-labelledby="connections-heading">
    <h2 id="connections-heading">{t('connections.title')}</h2>
    <p>{t('connections.intro')}</p>
    <div className="payment-actions"><button disabled={busy} onClick={() => void load(true)}>{t('connections.check')}</button></div>
    <p role="status">{busy ? t('connections.checking') : outcome.kind === 'loading' ? t('connections.loading') : outcome.kind === 'ok' ? t('connections.allReachable', { count: outcome.count }) : outcome.kind === 'problem' ? t('connections.someProblem', { problems: outcome.problems, count: outcome.count }) : outcome.message ?? t('connections.unavailable')}</p>
    {providers.map(item => <article key={item.provider} aria-label={t('connections.connectionLabel', { name: NAMES[item.provider] ?? item.provider })}>
      <h3>{NAMES[item.provider] ?? item.provider}</h3>
      <p>{item.ok ? (item.operations.length === 1 ? t('connections.reachableOne', { count: 1 }) : t('connections.reachableMany', { count: item.operations.length })) : t('connections.refused', { reason: item.problem ?? t('connections.unknownProblem') })}</p>
      {item.ok && <details><summary>{t('connections.showOperations', { name: NAMES[item.provider] ?? item.provider })}</summary>
        <div className="table-scroll" role="region" aria-label={t('connections.operationsLabel', { name: NAMES[item.provider] ?? item.provider })} tabIndex={0}>
          <table><caption>{t('connections.caption')}</caption><thead><tr><th scope="col">{t('connections.operation')}</th><th scope="col">{t('connections.method')}</th><th scope="col">{t('connections.path')}</th></tr></thead>
            <tbody>{item.operations.map(operation => <tr key={operation.operationId}><td>{operation.operationId}</td><td>{operation.method}</td><td>{operation.path}</td></tr>)}</tbody></table>
        </div></details>}
    </article>)}
    <h3>{t('connections.recent')}</h3>
    {calls.length === 0 ? <p>{t('connections.noCalls')}</p> : <ol aria-label={t('connections.recentLabel')}>
      {calls.map((call, index) => <li key={`${call.at}-${index}`}>{formatTime(locale, call.at)} · {NAMES[call.provider] ?? call.provider} · {call.method} {call.path} · {call.status >= 200 && call.status < 300 ? t('connections.callOk', { status: call.status }) : `${t('connections.callFailed', { status: call.status })}${call.code ? ` ${call.code}` : ''}`} · {t('connections.ms', { ms: call.ms })}</li>)}
    </ol>}
  </section>;
}
