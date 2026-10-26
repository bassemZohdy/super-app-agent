import { useEffect, useState } from 'react';

type Operation = { operationId: string; method: string; path: string };
type Provider = { provider: string; ok: boolean; checkedAt: number; operations: Operation[]; problem?: string };
type Call = { at: number; provider: string; method: string; path: string; status: number; code?: string; ms: number };

const NAMES: Record<string, string> = { rta: 'RTA', dewa: 'DEWA', etisalat: 'etisalat', du: 'du', police: 'Dubai Police', dld: 'DLD', payments: 'Payments' };
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** What each provider advertises and what this resident's own calls to it did. Read-only: it shows the operations the providers
 *  describe and the calls made, with failures marked in words, and it can ask the gateway to read the providers again. */
export function ConnectionsPanel({ gateway, getToken }: { gateway: string; getToken: () => Promise<string> }) {
  const [providers, setProviders] = useState<Provider[]>([]), [calls, setCalls] = useState<Call[]>([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState('Loading connections…');
  async function load(refresh: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`${gateway}/api/connections${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connections are unavailable.');
      setProviders(data.providers); setCalls(data.calls);
      const refused = (data.providers as Provider[]).filter(item => !item.ok).length;
      setNotice(refused ? `${refused} of ${data.providers.length} connections have a problem.` : `All ${data.providers.length} connections are reachable.`);
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { void load(false); }, []);
  return <section className="payment-review connections-panel" role="region" aria-labelledby="connections-heading">
    <h2 id="connections-heading">Connections</h2>
    <p>The services your concierge talks to, the operations each one advertises, and the calls made for you. Providers are read at most every 30 seconds.</p>
    <div className="payment-actions"><button disabled={busy} onClick={() => void load(true)}>Check connections</button></div>
    <p role="status">{busy ? 'Checking connections…' : notice}</p>
    {providers.map(item => <article key={item.provider} aria-label={`${NAMES[item.provider] ?? item.provider} connection`}>
      <h3>{NAMES[item.provider] ?? item.provider}</h3>
      <p>{item.ok ? `Reachable · ${item.operations.length} operation${item.operations.length === 1 ? '' : 's'} advertised` : `Refused · ${item.problem ?? 'unknown problem'}`}</p>
      {item.ok && <details><summary>Show operations for {NAMES[item.provider] ?? item.provider}</summary>
        <div className="table-scroll" role="region" aria-label={`${NAMES[item.provider] ?? item.provider} operations`} tabIndex={0}>
          <table><caption>Advertised operations</caption><thead><tr><th scope="col">Operation</th><th scope="col">Method</th><th scope="col">Path</th></tr></thead>
            <tbody>{item.operations.map(operation => <tr key={operation.operationId}><td>{operation.operationId}</td><td>{operation.method}</td><td>{operation.path}</td></tr>)}</tbody></table>
        </div></details>}
    </article>)}
    <h3>Recent calls</h3>
    {calls.length === 0 ? <p>No calls have been made for you yet.</p> : <ol aria-label="Recent provider calls">
      {calls.map((call, index) => <li key={`${call.at}-${index}`}>{time(call.at)} · {NAMES[call.provider] ?? call.provider} · {call.method} {call.path} · {call.status >= 200 && call.status < 300 ? `OK ${call.status}` : `Failed ${call.status}${call.code ? ` ${call.code}` : ''}`} · {call.ms} ms</li>)}
    </ol>}
  </section>;
}
