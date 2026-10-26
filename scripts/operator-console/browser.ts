/** The scenario console's page script (SIM-05). Plain TypeScript with no imports: the server strips the types and serves it as a
 *  classic script. It builds the page with textContent only, never innerHTML, and holds no secret: the browser has a cookie
 *  the server set, and the operator's own token stays in the launcher process. */
(() => {
  type State = {
    runId: string; operator: string;
    failpoints: Array<{ name: string; description: string }>;
    armed: Array<{ name: string; fired: number; remaining: number }>;
    audit: Array<{ at: string; event: string; name?: string; times?: number }>;
    accounts: Array<{ accountId: string; walletMinor: number; openOrders: number; heldMinor: number; claims: number }>;
    pendingEvents: number;
  };
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const aed = (minor: number) => `AED ${(minor / 100).toFixed(2)}`;
  const say = (text: string) => { el('notice').textContent = text; };
  const make = (tag: string, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };

  async function call(path: string, init: { method?: string; body?: unknown } = {}) {
    const response = await fetch(path, {
      method: init.method ?? 'GET', credentials: 'same-origin',
      headers: { 'X-Console-Request': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) throw new Error(String((data as { error?: string }).error || `The request failed (${response.status}).`));
    return data as Record<string, unknown>;
  }

  function render(state: State) {
    const run = el('run'); run.replaceChildren();
    for (const [label, value] of [['Run', state.runId], ['Operator', state.operator]]) { run.append(make('dt', label), make('dd', value)); }

    const select = el<HTMLSelectElement>('failpoint');
    if (!select.options.length) for (const point of state.failpoints) { const option = make('option', `${point.name} — ${point.description}`) as HTMLOptionElement; option.value = point.name; select.append(option); }

    const armed = el('armed'); armed.replaceChildren();
    for (const point of state.armed) armed.append(make('li', `${point.name}: ${point.remaining > 0 ? `armed, ${point.remaining} hit${point.remaining === 1 ? '' : 's'} left` : 'not armed'}; fired ${point.fired} time${point.fired === 1 ? '' : 's'}`));

    const body = el('inspection-body'); body.replaceChildren();
    if (!state.accounts.length) { const row = make('tr'); const cell = make('td', 'No account has been used in this run yet.') as HTMLTableCellElement; cell.colSpan = 5; row.append(cell); body.append(row); }
    for (const account of state.accounts) {
      const row = make('tr');
      row.append(make('th', account.accountId), make('td', aed(account.walletMinor)), make('td', aed(account.heldMinor)), make('td', String(account.openOrders)), make('td', String(account.claims)));
      (row.firstChild as HTMLElement).setAttribute('scope', 'row');
      body.append(row);
    }
    el('pending-events').textContent = `${state.pendingEvents} payment event${state.pendingEvents === 1 ? '' : 's'} waiting to be delivered.`;

    const audit = el('audit'); audit.replaceChildren();
    if (!state.audit.length) audit.append(make('li', 'Nothing has been changed yet.'));
    for (const entry of state.audit) audit.append(make('li', `${entry.at} · ${entry.event}${entry.name ? ` · ${entry.name}${entry.times ? ` ×${entry.times}` : ''}` : ''}`));
  }

  const load = async () => { const state = await call('/api/state') as unknown as State; render(state); return state; };
  const guarded = (action: () => Promise<void>) => async (event?: Event) => { event?.preventDefault(); try { await action(); } catch (error) { say((error as Error).message); } };
  const resetConfirm = el('reset-confirm');
  let nonce = '';

  el('arm-form').addEventListener('submit', guarded(async () => {
    const name = el<HTMLSelectElement>('failpoint').value, times = Number(el<HTMLInputElement>('times').value);
    render(await call('/api/arm', { method: 'POST', body: { name, times } }) as unknown as State);
    say(`Armed ${name} for its next ${times} hit${times === 1 ? '' : 's'}.`);
  }));
  el('clear').addEventListener('click', guarded(async () => { render(await call('/api/clear', { method: 'POST', body: {} }) as unknown as State); say('All failpoints are cleared.'); }));
  el('export').addEventListener('click', guarded(async () => {
    const data = await call('/api/export'), link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `scenario-run-${String((data as { runId?: string }).runId || 'export')}.json`; link.click(); URL.revokeObjectURL(link.href);
    say('The run export was downloaded. It is read only and has secrets removed.');
  }));
  el('reset-start').addEventListener('click', guarded(async () => {
    const prepared = await call('/api/reset/prepare', { method: 'POST', body: {} });
    nonce = String(prepared.nonce); resetConfirm.hidden = false; el('reset-start').hidden = true; el('reset-do').focus();
    say('Confirm to replace this run with a fresh one. Its funds, orders and history are deleted.');
  }));
  el('reset-cancel').addEventListener('click', guarded(async () => { nonce = ''; resetConfirm.hidden = true; el('reset-start').hidden = false; el('reset-start').focus(); say('The reset was cancelled.'); }));
  el('reset-do').addEventListener('click', guarded(async () => {
    const confirmed = nonce; nonce = ''; resetConfirm.hidden = true; el('reset-start').hidden = false;
    await call('/api/reset', { method: 'POST', body: { nonce: confirmed } });
    say('Resetting the run…');
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { await load(); say('The run was reset. Accounts are created again, with fresh funds, on first use.'); return; } catch { /* the server restarts; keep waiting */ }
    }
    throw new Error('The run did not come back in time. Check the launcher output.');
  }));

  load().then(() => say('Ready.'), error => say((error as Error).message));
})();
