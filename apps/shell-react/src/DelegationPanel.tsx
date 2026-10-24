import { useEffect, useState } from 'react';
import { delegationResult } from '../../../packages/protocol-core/src/delegation-client.ts';
type Grant = { id: string; purpose: string; provider: string; method: string; path: string; body: { amountMinor?: number }; accountId: string; used: number; maxOperations: number; expiresAt: number; revokedAt?: number };
export function DelegationPanel({ gateway, accountId, getToken }: { gateway: string; accountId: string; getToken: () => Promise<string> }) {
  const [grants, setGrants] = useState<Grant[]>([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [history, setHistory] = useState('');
  async function api(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(`${gateway}/api/delegation/grants${path}`, { method, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || data.code || 'Delegation unavailable'); return data;
  }
  async function load() { const data = await api(); setGrants(data.grants); }
  async function work(fn: () => Promise<void>) { setBusy(true); setNotice(''); try { await fn(); await load(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); } }
  useEffect(() => { void load().catch(e => setNotice(e.message)); }, [accountId]);
  const create = (write: boolean) => work(async () => {
    await api('', 'POST', { accountId, provider: 'payments', method: write ? 'POST' : 'GET', path: write ? '/topups' : '/wallet', body: write ? { amountMinor: 100, source: 'demo_approved' } : {}, purpose: write ? 'Approve one synthetic AED 1 wallet credit' : 'Check my synthetic wallet balance', expiresInSeconds: 300, maxOperations: write ? 1 : 3 });
    setNotice('Consent saved. Review the grant below before running it.');
  });
  return <section className="delegation-panel" aria-label="Delegated access">
    <h2>Delegated access</h2><p>Let the Cityside demo broker perform one exact operation on your current account. Consent expires in five minutes and can be revoked here.</p>
    <p><strong>Actor:</strong> Cityside delegation broker. <strong>Scope:</strong> the displayed account and operation only. Synthetic data.</p>
    <div className="delegation-actions"><button disabled={busy || !accountId} onClick={() => void create(false)}>Allow up to 3 wallet balance checks</button><button disabled={busy || !accountId} onClick={() => void create(true)}>Approve one AED 1 demo wallet credit</button><button disabled={busy} onClick={() => void work(load)}>Refresh grants</button></div>
    <p role="status">{busy ? 'Checking current authority…' : notice}</p>
    {grants.filter(g => g.accountId === accountId).map(g => <article key={g.id}>
      <h3>{g.purpose}</h3><p>{g.method === 'GET' ? 'Read the wallet balance' : `Credit the demo wallet by AED ${((g.body.amountMinor || 0) / 100).toFixed(2)}`}</p>
      <p>{g.revokedAt ? 'Revoked' : g.expiresAt <= Date.now() ? 'Expired' : 'Active'} · {g.used}/{g.maxOperations} executions · expires {new Date(g.expiresAt).toLocaleTimeString()}</p>
      <div className="delegation-actions"><button disabled={busy || Boolean(g.revokedAt) || g.expiresAt <= Date.now() || g.used >= g.maxOperations} onClick={() => void work(async () => { const data = await api(`/${g.id}/execute`, 'POST', { requestKey: crypto.randomUUID() }); setNotice(delegationResult(data.result)); })}>Run approved operation</button><button disabled={busy || Boolean(g.revokedAt)} onClick={() => void work(async () => { await api(`/${g.id}`, 'DELETE'); setNotice('Consent revoked. Further delegated operations will be denied.'); })}>Revoke consent</button><button disabled={busy} onClick={() => void work(async () => { const data = await api(`/${g.id}/history`); setHistory(data.history.map((entry: { at: number; event: string }) => `${new Date(entry.at).toLocaleTimeString()} ${entry.event}`).join('\n')); })}>View audit history</button></div>
    </article>)}
    {!grants.some(g => g.accountId === accountId) && <p>No delegated grants for this account.</p>}
    {history && <pre aria-label="Delegation audit history">{history}</pre>}
  </section>;
}
