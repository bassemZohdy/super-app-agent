import { useEffect, useState } from 'react';
import { delegationResult } from '../../../packages/protocol-core/src/delegation-client.ts';
import { formatMoney, formatTime, translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
type Grant = { id: string; purpose: string; provider: string; method: string; path: string; body: { amountMinor?: number }; accountId: string; used: number; maxOperations: number; expiresAt: number; revokedAt?: number };
export function DelegationPanel({ gateway, accountId, getToken, locale = 'en' }: { gateway: string; accountId: string; getToken: () => Promise<string>; locale?: Locale }) {
  const t = (key: CatalogKey, values?: Record<string, string | number>) => translate(locale, key, values);
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
    setNotice(t('delegation.saved'));
  });
  return <section className="delegation-panel" aria-label={t('delegation.title')}>
    <h2>{t('delegation.title')}</h2><p>{t('delegation.intro')}</p>
    <p><strong>{t('delegation.actor')}</strong> {t('delegation.actorValue')} <strong>{t('delegation.scope')}</strong> {t('delegation.scopeValue')}</p>
    <div className="delegation-actions"><button disabled={busy || !accountId} onClick={() => void create(false)}>{t('delegation.allowReads')}</button><button disabled={busy || !accountId} onClick={() => void create(true)}>{t('delegation.allowCredit')}</button><button disabled={busy} onClick={() => void work(load)}>{t('delegation.refresh')}</button></div>
    <p role="status">{busy ? t('delegation.checking') : notice}</p>
    {grants.filter(g => g.accountId === accountId).map(g => <article key={g.id}>
      <h3>{g.purpose}</h3><p>{g.method === 'GET' ? t('delegation.readBalance') : t('delegation.creditWallet', { amount: locale === 'ar' ? formatMoney('ar', g.body.amountMinor || 0, 'AED', { grouping: false }) : `AED ${((g.body.amountMinor || 0) / 100).toFixed(2)}` })}</p>
      <p>{t('delegation.status', { state: g.revokedAt ? t('delegation.revoked') : g.expiresAt <= Date.now() ? t('delegation.expired') : t('delegation.active'), used: g.used, max: g.maxOperations, time: locale === 'ar' ? formatTime('ar', g.expiresAt) : new Date(g.expiresAt).toLocaleTimeString() })}</p>
      <div className="delegation-actions"><button disabled={busy || Boolean(g.revokedAt) || g.expiresAt <= Date.now() || g.used >= g.maxOperations} onClick={() => void work(async () => { const data = await api(`/${g.id}/execute`, 'POST', { requestKey: crypto.randomUUID() }); setNotice(delegationResult(data.result)); })}>{t('delegation.run')}</button><button disabled={busy || Boolean(g.revokedAt)} onClick={() => void work(async () => { await api(`/${g.id}`, 'DELETE'); setNotice(t('delegation.revokedNotice')); })}>{t('delegation.revoke')}</button><button disabled={busy} onClick={() => void work(async () => { const data = await api(`/${g.id}/history`); setHistory(data.history.map((entry: { at: number; event: string }) => `${new Date(entry.at).toLocaleTimeString()} ${entry.event}`).join('\n')); })}>{t('delegation.history')}</button></div>
    </article>)}
    {!grants.some(g => g.accountId === accountId) && <p>{t('delegation.none')}</p>}
    {history && <pre aria-label={t('delegation.historyLabel')}>{history}</pre>}
  </section>;
}
