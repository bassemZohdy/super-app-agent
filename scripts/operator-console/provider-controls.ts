/** `RunControls` backed by the provider's scenario-control routes for one isolated run (SIM-05). The operator's token is requested
 *  per call from `token()`, which the launcher refreshes, and is never given to the page. A failed call reports only its status. */
import type { RunControls } from './console.ts';

export function providerRunControls(options: { base: string; runId: string; operator: string; token: () => Promise<string> }): RunControls {
  const root = `${options.base}/internal/scenario-controls/${options.runId}`;
  const call = async (suffix: string, body?: unknown) => {
    const response = await fetch(`${root}${suffix}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${await options.token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`The run answered ${response.status}.`);
    return response.json() as Promise<any>;
  };
  return {
    runId: options.runId, operator: options.operator,
    status: () => call(''), inspect: () => call('/inspect'), export: () => call('/export'),
    arm: (name, times, requestKey) => call('/arm', { name, times, requestKey }),
    clear: () => call('/clear', {}), reset: requestKey => call('/reset', { requestKey }),
  };
}

/** A password-grant token for the local demo operator that is requested again shortly before it expires. */
export function refreshingToken(login: () => Promise<string>, now: () => number = () => Date.now()): () => Promise<string> {
  let cached: { token: string; until: number } | undefined, pending: Promise<string> | undefined;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    pending ??= login().then(token => {
      const exp = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp) * 1000;
      cached = { token, until: exp - 30_000 }; return token;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
