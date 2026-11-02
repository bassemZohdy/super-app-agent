import { expect, isolatedTest as test, login } from '../stack.ts';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import { accountIdFor } from '../../../packages/backend-kit/src/context.ts';
import { EligibilityClient, EligibilityReadError } from '../../../packages/backend-kit/src/eligibility-client.ts';
import { RedisSessionStore, redisSessions } from '../../../services/agent-core/src/session-store.ts';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

test('the reviewed composite identity is saved before dispatch and survives a lost wallet response', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`;
  const endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(review.status).toBe(200);
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const expectedOperation = `${surface.revision}:confirm_composite_checkout`;
  const original = ProviderClient.prototype.call;
  let seen = false;
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    if (provider === 'payments' && method === 'POST' && path === '/charges') {
      const saved = await redisSessions()!.read(sessionId, actor.sub);
      expect(saved.state.compositeAttempt).toMatchObject({ operationId: expectedOperation, terms: binding, eligibilityEpoch: expect.any(String) });
      expect(saved.state.reconciliation?.outcome).toBe('UNKNOWN');
      seen = true;
      await original.call(this, provider, actor, method, path, body, key);
      throw new UpstreamError(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Simulated lost response');
    }
    return original.call(this, provider, actor, method, path, body, key);
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(seen).toBe(true);
    expect(result.data.outcome).toBe('UNKNOWN');
    const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    const saved = await redisSessions()!.read(sessionId, claims.sub);
    expect(saved.state.compositeAttempt).toMatchObject({ operationId: expectedOperation, terms: binding });
    expect(saved.state.reconciliation?.outcome).toBe('UNKNOWN');
    const sessionResponse = await fetch(`${endpoint}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    const sessionData = await sessionResponse.json() as { compositeAttempt: { operationId: string; terms: Record<string, unknown> } };
    expect(sessionResponse.status).toBe(200);
    expect(sessionData.compositeAttempt).toMatchObject({ operationId: expectedOperation, terms: binding });
    const remove = await fetch(`${endpoint}/api/sessions/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect(remove.status).toBe(409);
    expect((await redisSessions()!.read(sessionId, claims.sub)).state.compositeAttempt).toMatchObject({ operationId: expectedOperation, terms: binding });
    const inspected = await fetch(`http://localhost:${stack.corePort + 3}/wallet/operations/${encodeURIComponent(expectedOperation)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': residentApi.accountId } });
    expect(inspected.status).toBe(200);
    const chargesBefore = stack.stores.get('payments')!.list(residentApi.accountId, 'charge').length;
    const ridesBefore = stack.stores.get('rta')!.list(residentApi.accountId, 'ride').length;
    const evidence = await fetch(`${endpoint}/api/composite/reconciliation?${new URLSearchParams({ sessionId, accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect(evidence.status).toBe(200);
    const report = await evidence.json() as { operationId: string; dispatch: string; startedStep: string; evidence: Array<{ step: string; assessment: string }> };
    expect(report.operationId).toBe(expectedOperation);
    expect(report.dispatch).toBe('UNCONFIRMED');
    expect(report.startedStep).toBe('WALLET');
    expect(report.evidence).toEqual([{ step: 'WALLET', assessment: 'MATCH' }, { step: 'RIDE', assessment: 'UNCONFIRMED' }, { step: 'FOOD', assessment: 'UNCONFIRMED' }]);
    const fenceResponse = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    const fence = await fenceResponse.json() as { status: string; sessionId: string; operationId: string };
    expect(fenceResponse.status).toBe(200);
    expect(fence).toMatchObject({ status: 'BLOCKED', sessionId, operationId: expectedOperation });
    const userIndex = `${redisSessions()!.prefix}user:${createHash('sha256').update(claims.sub).digest('hex')}`;
    await redisSessions()!.client.del(userIndex); // Simulate the ordinary history index expiring.
    const listed = await fetch(`${endpoint}/api/sessions`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect(listed.status).toBe(200);
    expect((await listed.json()).sessions.filter((session: { sessionId: string }) => session.sessionId === sessionId)).toHaveLength(1);
    expect(await redisSessions()!.client.ttl(`${redisSessions()!.prefix}session:${sessionId}`)).toBe(-1);
    // An attempt fenced before the pending-history index existed is indexed when claimed.
    await redisSessions()!.client.del(`${userIndex}:composite-pending`);
    await redisSessions()!.claim(sessionId, claims.sub, residentApi.accountId, false);
    await redisSessions()!.client.del(userIndex);
    expect((await redisSessions()!.list(claims.sub)).some(session => session.sessionId === sessionId)).toBe(true);
    const sessionLock = await redisSessions()!.acquire(sessionId);
    await sessionLock.release();
    expect(await redisSessions()!.client.ttl(`${redisSessions()!.prefix}session:${sessionId}`)).toBe(-1);
    await redisSessions()!.close();
    await redisSessions()!.connect();
    expect(await redisSessions()!.inspectCompositeFence(claims.sub, residentApi.accountId)).toMatchObject({ status: 'BLOCKED', sessionId, operationId: expectedOperation });
    expect((await redisSessions()!.inspectCompositeProgress(claims.sub, residentApi.accountId, sessionId, expectedOperation)).startedStep).toBe('WALLET');
    const progressKey = `${redisSessions()!.prefix}session:${sessionId}:composite-step`;
    const progress = await redisSessions()!.client.get(progressKey);
    expect(progress).not.toBeNull();
    await redisSessions()!.client.del(progressKey);
    try { expect((await redisSessions()!.inspectCompositeProgress(claims.sub, residentApi.accountId, sessionId, expectedOperation)).startedStep).toBe('UNAVAILABLE'); }
    finally { await redisSessions()!.client.set(progressKey, progress!); }
    const sessionKey = `${redisSessions()!.prefix}session:${sessionId}`;
    const originalSession = await redisSessions()!.client.get(sessionKey);
    expect(originalSession).not.toBeNull();
    await redisSessions()!.client.del(sessionKey);
    try {
      await expect(redisSessions()!.claim(sessionId, claims.sub, residentApi.accountId)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    } finally { await redisSessions()!.client.set(sessionKey, originalSession!); }
    const otherAccount = stack.stores.get('payments')!.accounts(claims.sub).find(account => account.id !== residentApi.accountId)!;
    const otherFence = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: otherAccount.id })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect((await otherFence.json()).status).toBe('CLEAR');
    const otherSession = `composite_${crypto.randomUUID()}`;
    const otherSend = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId: otherSession, accountId: residentApi.accountId }) });
      return { status: response.status, data: await response.json() };
    };
    const otherReview = await otherSend('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
    expect(otherReview.status).toBe(200);
    const otherSurface = otherReview.data.surface as typeof surface;
    const otherBinding = otherSurface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
    const blocked = await otherSend('/api/a2ui/action', { surfaceRevision: otherSurface.revision, action: 'confirm_composite_checkout', payload: otherBinding });
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe('COMPOSITE_RECONCILIATION_REQUIRED');
    const cannotCancel = await send('/api/composite/reconciliation/cancel-undispatched', { operationId: expectedOperation });
    expect(cannotCancel.status).toBe(409);
    const dispatchKey = `${redisSessions()!.prefix}session:${sessionId}:composite-dispatch`;
    const dispatchStage = await redisSessions()!.client.get(dispatchKey);
    expect(dispatchStage).not.toBeNull();
    await redisSessions()!.client.del(dispatchKey);
    try { expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId: expectedOperation })).status).toBe(409); }
    finally { await redisSessions()!.client.set(dispatchKey, dispatchStage!); }
    const incomplete = await send('/api/composite/reconciliation/resolve', { operationId: expectedOperation });
    expect(incomplete.status).toBe(409);
    expect(incomplete.data.code).toBe('COMPOSITE_EVIDENCE_UNCONFIRMED');
    expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(chargesBefore);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(ridesBefore);
    const otherToken = await login('bassem');
    const otherClaims = JSON.parse(Buffer.from(otherToken.split('.')[1], 'base64url').toString()) as { sub: string };
    const otherHistory = await fetch(`${endpoint}/api/sessions`, { headers: { Authorization: `Bearer ${otherToken}` } });
    expect((await otherHistory.json()).sessions.some((session: { sessionId: string }) => session.sessionId === sessionId)).toBe(false);
    const other = await fetch(`${endpoint}/api/composite/reconciliation?${new URLSearchParams({ sessionId, accountId: accountIdFor(otherClaims.sub) })}`, { headers: { Authorization: `Bearer ${otherToken}` } });
    expect(other.status).toBe(403);
    const otherResolve = await fetch(`${endpoint}/api/composite/reconciliation/resolve`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, accountId: accountIdFor(otherClaims.sub), operationId: expectedOperation }) });
    expect(otherResolve.status).toBe(403);
    const otherCancel = await fetch(`${endpoint}/api/composite/reconciliation/cancel-undispatched`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, accountId: accountIdFor(otherClaims.sub), operationId: expectedOperation }) });
    expect(otherCancel.status).toBe(403);
    expect((await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' })).data.code).toBe('RECONCILIATION_REQUIRED');
  } finally { ProviderClient.prototype.call = original; }
});

test('the owner continues only the next unstarted step after matching original evidence', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const operationId = `${surface.revision}:confirm_composite_checkout`, original = ProviderClient.prototype.call;
  let loseWallet = true, loseRide = true, changedFare = false, entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    if (provider === 'payments' && method === 'POST' && path === '/charges' && loseWallet) {
      loseWallet = false; await original.call(this, provider, actor, method, path, body, key); throw new UpstreamError(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Lost wallet response');
    }
    if (provider === 'rta' && method === 'POST' && path === '/rides/bookings' && loseRide) {
      loseRide = false; await original.call(this, provider, actor, method, path, body, key); entered(); await held; throw new UpstreamError(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Lost ride response');
    }
    const result = await original.call(this, provider, actor, method, path, body, key);
    if (changedFare && provider === 'rta' && method === 'GET' && path.startsWith('/rides/options')) return { ...result, options: result.options.map((option: { id: string; fare: number }) => option.id === binding.driverId ? { ...option, fare: option.fare + 1 } : option) };
    return result;
  };
  try {
    expect((await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding })).data.outcome).toBe('UNKNOWN');
    const otherSession = `composite_${crypto.randomUUID()}`;
    const otherSend = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId: otherSession, accountId: residentApi.accountId }) });
      return { status: response.status, data: await response.json() };
    };
    const otherReview = await otherSend('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
    expect(otherReview.status).toBe(200);
    const otherSurface = otherReview.data.surface as typeof surface;
    const otherBinding = otherSurface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
    const otherAction = () => otherSend('/api/a2ui/action', { surfaceRevision: otherSurface.revision, action: 'confirm_composite_checkout', payload: otherBinding });
    const blocked = await otherAction();
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe('COMPOSITE_RECONCILIATION_REQUIRED');
    const continueStep = (step: string, id = operationId) => send('/api/composite/reconciliation/continue', { operationId: id, step });
    expect((await continueStep('FOOD')).status).toBe(409);
    expect((await continueStep('RIDE', '11111111-1111-4111-8111-111111111111:confirm_composite_checkout')).status).toBe(409);
    const otherToken = await login('bassem');
    const otherClaims = JSON.parse(Buffer.from(otherToken.split('.')[1], 'base64url').toString()) as { sub: string };
    const other = await fetch(`${endpoint}/api/composite/reconciliation/continue`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, accountId: accountIdFor(otherClaims.sub), operationId, step: 'RIDE' }) });
    expect(other.status).toBe(403);
    const key = `${redisSessions()!.prefix}session:${sessionId}:composite-step`, savedStep = await redisSessions()!.client.get(key);
    expect(savedStep).not.toBeNull(); await redisSessions()!.client.del(key);
    try { expect((await continueStep('RIDE')).status).toBe(409); } finally { await redisSessions()!.client.set(key, savedStep!); }
    const payments = stack.stores.get('payments')!, charge = payments.list(residentApi.accountId, 'charge')[0] as { id: string; refunded: boolean };
    payments.put(residentApi.accountId, 'charge', { ...charge, refunded: true }, charge.id);
    try { expect((await continueStep('RIDE')).status).toBe(409); } finally { payments.put(residentApi.accountId, 'charge', charge, charge.id); }
    changedFare = true; expect((await continueStep('RIDE')).status).toBe(409); changedFare = false;
    const owner = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    const sessionLock = await redisSessions()!.acquire(sessionId);
    const current = (await redisSessions()!.read(sessionId, owner.sub)).state;
    const originalEpoch = current.compositeAttempt!.eligibilityEpoch;
    expect(originalEpoch).toEqual(expect.any(String));
    current.metadata = { ...current.metadata, eligibilityEpoch: '9:9' };
    delete current.compositeAttempt!.eligibilityEpoch;
    await sessionLock.save(current); await sessionLock.release();
    expect((await continueStep('RIDE')).status).toBe(409);
    const restoreLock = await redisSessions()!.acquire(sessionId);
    const restored = (await redisSessions()!.read(sessionId, owner.sub)).state;
    restored.compositeAttempt!.eligibilityEpoch = originalEpoch;
    await restoreLock.save(restored); await restoreLock.release();
    const eligibility = EligibilityClient.prototype.require;
    EligibilityClient.prototype.require = async function (actor, epoch) { if (epoch) { expect(epoch).toBe(originalEpoch); throw new EligibilityReadError(409, 'Changed permission'); } return eligibility.call(this, actor, epoch); };
    try { expect((await continueStep('RIDE')).status).toBe(409); } finally { EligibilityClient.prototype.require = eligibility; }
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
    const pendingRide = continueStep('RIDE');
    await Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Ride was not reached')), 15000))]);
    expect((await continueStep('RIDE')).status).toBe(409);
    release();
    const ride = await pendingRide;
    expect(ride.status).toBe(503);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(1);
    expect((await continueStep('RIDE')).data.continuation).toBe('ALREADY_CONFIRMED');
    const originalFetch = globalThis.fetch;
    let lostFood = false;
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.port === String(stack.corePort + 2) && url.pathname === '/orders/create' && init?.method === 'POST') { await response.arrayBuffer(); lostFood = true; throw new Error('Lost food response'); }
      return response;
    };
    try { expect((await continueStep('FOOD')).status).toBe(503); expect(lostFood).toBe(true); }
    finally { globalThis.fetch = originalFetch; }
    expect((await continueStep('FOOD')).data.continuation).toBe('ALREADY_CONFIRMED');
    expect((await send('/api/composite/reconciliation/resolve', { operationId })).data.resolution).toBe('RESOLVED');
    expect(payments.list(residentApi.accountId, 'charge')).toHaveLength(1);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(1);
    const foodDb = new DatabaseSync(join(process.env.APP_DATA_DIR!, 'service-food.sqlite'), { readOnly: true });
    try { expect(foodDb.prepare("SELECT count(*) AS n FROM resources WHERE account_id=? AND kind='order'").get(residentApi.accountId)!.n).toBe(1); }
    finally { foodDb.close(); }
    // Resolution releases the account fence; a newly reviewed session may then start its own operation.
    const nextReview = await otherSend('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
    expect(nextReview.status).toBe(200);
    const nextSurface = nextReview.data.surface as typeof surface;
    const nextBinding = nextSurface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
    expect((await otherSend('/api/a2ui/action', { surfaceRevision: nextSurface.revision, action: 'confirm_composite_checkout', payload: nextBinding })).status).toBe(200);
    expect(payments.list(residentApi.accountId, 'charge')).toHaveLength(2);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(2);
  } finally { release(); ProviderClient.prototype.call = original; }
});

test('competing sessions cannot both start a composite checkout for one account', async ({ residentApi, stack }) => {
  const endpoint = `http://localhost:${stack.corePort}`;
  const send = async (sessionId: string, path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const sessions = [`composite_${crypto.randomUUID()}`, `composite_${crypto.randomUUID()}`];
  const reviews = await Promise.all(sessions.map(sessionId => send(sessionId, '/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' })));
  expect(reviews.map(review => review.status)).toEqual([200, 200]);
  const surfaces = reviews.map(review => review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } });
  const bindings = surfaces.map(surface => surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload);
  const original = ProviderClient.prototype.call;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    if (provider === 'payments' && method === 'POST' && path === '/charges') { entered(); await held; }
    return original.call(this, provider, actor, method, path, body, key);
  };
  try {
    const first = send(sessions[0], '/api/a2ui/action', { surfaceRevision: surfaces[0].revision, action: 'confirm_composite_checkout', payload: bindings[0] });
    await Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('First checkout did not reach the wallet')), 15000))]);
    const second = await send(sessions[1], '/api/a2ui/action', { surfaceRevision: surfaces[1].revision, action: 'confirm_composite_checkout', payload: bindings[1] });
    expect(second.status).toBe(409);
    expect(second.data.code).toBe('COMPOSITE_RECONCILIATION_REQUIRED');
    const cancel = await send(sessions[0], '/api/composite/reconciliation/cancel-undispatched', { operationId: `${surfaces[0].revision}:confirm_composite_checkout` });
    expect(cancel.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(1);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(1);
    const fence = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect((await fence.json()).status).toBe('CLEAR');
  } finally { release(); ProviderClient.prototype.call = original; }
});

test('a lost fence write response preserves the original attempt without dispatching', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const originalAcquire = RedisSessionStore.prototype.acquire;
  const operationId = `${surface.revision}:confirm_composite_checkout`;
  RedisSessionStore.prototype.acquire = async function (sid) {
    const lock = await originalAcquire.call(this, sid), begin = lock.beginComposite;
    lock.beginComposite = async state => { await begin(state); throw new Error('Simulated lost fence response'); };
    return lock;
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(result.status).toBeGreaterThanOrEqual(500);
    const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    expect((await redisSessions()!.read(sessionId, claims.sub)).state.compositeAttempt).toMatchObject({ operationId, terms: binding });
    expect(await redisSessions()!.inspectCompositeFence(claims.sub, residentApi.accountId)).toMatchObject({ status: 'BLOCKED', sessionId });
    expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(0);
  } finally { RedisSessionStore.prototype.acquire = originalAcquire; }
  const inspection = await fetch(`${endpoint}/api/composite/reconciliation?${new URLSearchParams({ sessionId, accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect(await inspection.json()).toMatchObject({ dispatch: 'NOT_STARTED', startedStep: 'NONE' });
  const wrong = await send('/api/composite/reconciliation/cancel-undispatched', { operationId: '11111111-1111-4111-8111-111111111111:confirm_composite_checkout' });
  expect(wrong.status).toBe(409);
  const otherToken = await login('bassem');
  const otherClaims = JSON.parse(Buffer.from(otherToken.split('.')[1], 'base64url').toString()) as { sub: string };
  const otherCancel = await fetch(`${endpoint}/api/composite/reconciliation/cancel-undispatched`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, accountId: accountIdFor(otherClaims.sub), operationId }) });
  expect(otherCancel.status).toBe(403);
  const cancelled = await send('/api/composite/reconciliation/cancel-undispatched', { operationId });
  expect(cancelled.status).toBe(200);
  expect(cancelled.data.cancellation).toBe('CANCELLED');
  expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).data.cancellation).toBe('ALREADY_CANCELLED');
  const savedSession = await fetch(`${endpoint}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect((await savedSession.json()).compositeCancellation).toMatchObject({ operationId, terms: binding });
  const fence = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect((await fence.json()).status).toBe('CLEAR');
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(0);
  expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
  const next = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(next.status).toBe(200);
  const nextSurface = next.data.surface as typeof surface;
  const nextBinding = nextSurface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  expect((await send('/api/a2ui/action', { surfaceRevision: nextSurface.revision, action: 'confirm_composite_checkout', payload: nextBinding })).status).toBe(200);
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(1);
});

test('a lost dispatch marker response can be cancelled only when no step started', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const operationId = `${surface.revision}:confirm_composite_checkout`;
  const originalAcquire = RedisSessionStore.prototype.acquire;
  RedisSessionStore.prototype.acquire = async function (sid) {
    const lock = await originalAcquire.call(this, sid), mark = lock.markCompositeDispatch;
    lock.markCompositeDispatch = async operation => { await mark(operation); throw new Error('Simulated lost dispatch marker response'); };
    return lock;
  };
  try {
    expect((await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding })).status).toBeGreaterThanOrEqual(500);
  } finally { RedisSessionStore.prototype.acquire = originalAcquire; }
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  expect(await redisSessions()!.inspectCompositeFence(claims.sub, residentApi.accountId)).toMatchObject({ status: 'BLOCKED', sessionId, operationId });
  expect((await redisSessions()!.read(sessionId, claims.sub)).state.compositeAttempt).toMatchObject({ operationId, terms: binding });
  const progress = await redisSessions()!.inspectCompositeProgress(claims.sub, residentApi.accountId, sessionId, operationId);
  expect(progress).toEqual({ dispatch: 'NOT_STARTED', startedStep: 'NONE' });
  const stepKey = `${redisSessions()!.prefix}session:${sessionId}:composite-step`, savedStep = await redisSessions()!.client.get(stepKey);
  expect(savedStep).not.toBeNull();
  await redisSessions()!.client.del(stepKey);
  try { expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).status).toBe(409); }
  finally { await redisSessions()!.client.set(stepKey, savedStep!); }
  await redisSessions()!.client.set(stepKey, 'NONE:unrelated');
  try { expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).status).toBe(409); }
  finally { await redisSessions()!.client.set(stepKey, savedStep!); }
  const cancelled = await send('/api/composite/reconciliation/cancel-undispatched', { operationId });
  expect(cancelled.status).toBe(200);
  expect(cancelled.data.cancellation).toBe('CANCELLED');
  expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).data.cancellation).toBe('ALREADY_CANCELLED');
  expect(await redisSessions()!.inspectCompositeFence(claims.sub, residentApi.accountId)).toMatchObject({ status: 'CLEAR' });
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(0);
  expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
});

test('cancellation after lease loss prevents the old request from starting its wallet step', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const operationId = `${surface.revision}:confirm_composite_checkout`, originalAcquire = RedisSessionStore.prototype.acquire;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  RedisSessionStore.prototype.acquire = async function (sid) {
    const lock = await originalAcquire.call(this, sid), mark = lock.markCompositeStep;
    lock.markCompositeStep = async (operation, step) => { if (step === 'WALLET') { entered(); await held; } await mark(operation, step); };
    return lock;
  };
  try {
    const original = send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    await Promise.race([reached, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Wallet step was not reached')), 15000))]);
    expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).status).toBe(409);
    await redisSessions()!.client.del(`${redisSessions()!.prefix}session:${sessionId}:lock`);
    expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).status).toBe(200);
    release();
    expect((await original).status).toBeGreaterThanOrEqual(400);
    expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(0);
    expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
  } finally { release(); RedisSessionStore.prototype.acquire = originalAcquire; }
});

test('a lost step marker response holds the partial checkout before the next effect', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const operationId = `${surface.revision}:confirm_composite_checkout`, originalAcquire = RedisSessionStore.prototype.acquire;
  RedisSessionStore.prototype.acquire = async function (sid) {
    const lock = await originalAcquire.call(this, sid), mark = lock.markCompositeStep;
    lock.markCompositeStep = async (operation, step) => { await mark(operation, step); if (step === 'RIDE') throw new Error('Simulated lost step response'); };
    return lock;
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(result.status).toBe(409);
    expect(result.data.outcome).toBe('PARTIALLY_COMPLETED');
  } finally { RedisSessionStore.prototype.acquire = originalAcquire; }
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  expect((await redisSessions()!.inspectCompositeProgress(claims.sub, residentApi.accountId, sessionId, operationId)).startedStep).toBe('RIDE');
  expect(await redisSessions()!.inspectCompositeFence(claims.sub, residentApi.accountId)).toMatchObject({ status: 'BLOCKED', sessionId, operationId });
  expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId })).status).toBe(409);
  expect((await send('/api/composite/reconciliation/continue', { operationId, step: 'RIDE' })).status).toBe(409);
  expect((await send('/api/composite/reconciliation/continue', { operationId, step: 'FOOD' })).status).toBe(409);
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(1);
  expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
});

test('a pre-dispatch composite refusal clears the saved attempt without moving funds', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(review.status).toBe(200);
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const before = (await residentApi.call('overview')).data.wallet.balanceMinor;
  const original = ProviderClient.prototype.call;
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    const result = await original.call(this, provider, actor, method, path, body, key);
    if (provider === 'rta' && method === 'GET' && path.startsWith('/rides/options')) {
      return { ...result, options: result.options.map((option: { id: string; fare: number }) => option.id === binding.driverId ? { ...option, fare: option.fare + 1 } : option) };
    }
    return result;
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(result.status).toBe(409);
    expect((await residentApi.call('overview')).data.wallet.balanceMinor).toBe(before);
    const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    const saved = await redisSessions()!.read(sessionId, claims.sub);
    expect(saved.state.compositeAttempt).toBeUndefined();
    expect(saved.state.reconciliation).toBeUndefined();
    const userIndex = `${redisSessions()!.prefix}user:${createHash('sha256').update(claims.sub).digest('hex')}`;
    expect(await redisSessions()!.client.sIsMember(`${userIndex}:composite-pending`, `${redisSessions()!.prefix}session:${sessionId}`)).toBeFalsy();
    const fence = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect((await fence.json()).status).toBe('CLEAR');
  } finally { ProviderClient.prototype.call = original; }
});

test('composite inspection matches all original effects after the food response is lost', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(review.status).toBe(200);
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const originalFetch = globalThis.fetch;
  let lost = false;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.port === String(stack.corePort + 2) && url.pathname === '/orders/create' && init?.method === 'POST') {
      await response.arrayBuffer();
      lost = true;
      throw new Error('Simulated lost food response');
    }
    return response;
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(lost).toBe(true);
    expect(result.data.outcome).toBe('UNKNOWN');
  } finally { globalThis.fetch = originalFetch; }
  const charges = stack.stores.get('payments')!.list(residentApi.accountId, 'charge').length;
  const rides = stack.stores.get('rta')!.list(residentApi.accountId, 'ride').length;
  const response = await fetch(`${endpoint}/api/composite/reconciliation?${new URLSearchParams({ sessionId, accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect(response.status).toBe(200);
  const report = await response.json() as { startedStep: string; evidence: Array<{ step: string; assessment: string }> };
  expect(report.startedStep).toBe('FOOD');
  expect((await send('/api/composite/reconciliation/cancel-undispatched', { operationId: `${surface.revision}:confirm_composite_checkout` })).status).toBe(409);
  expect(report.evidence).toEqual([{ step: 'WALLET', assessment: 'MATCH' }, { step: 'RIDE', assessment: 'MATCH' }, { step: 'FOOD', assessment: 'MATCH' }]);
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(charges);
  expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(rides);
  expect((await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' })).data.code).toBe('RECONCILIATION_REQUIRED');
  const operationId = `${surface.revision}:confirm_composite_checkout`;
  const wrong = await send('/api/composite/reconciliation/resolve', { operationId: '11111111-1111-4111-8111-111111111111:confirm_composite_checkout' });
  expect(wrong.status).toBe(409);
  const store = stack.stores.get('rta')!;
  const savedRide = store.list(residentApi.accountId, 'ride')[0] as { bookingId: string; dropoff: string };
  store.put(residentApi.accountId, 'ride', { ...savedRide, dropoff: 'Changed destination' }, savedRide.bookingId);
  const stale = await send('/api/composite/reconciliation/resolve', { operationId });
  expect(stale.status).toBe(409);
  expect(stale.data.code).toBe('COMPOSITE_EVIDENCE_UNCONFIRMED');
  store.put(residentApi.accountId, 'ride', savedRide, savedRide.bookingId);
  const originalEligibility = EligibilityClient.prototype.require;
  let gatewayReader: EligibilityClient | undefined, gatewayReads = 0;
  EligibilityClient.prototype.require = async function (actor, epoch) {
    gatewayReader ??= this;
    if (this === gatewayReader && ++gatewayReads === 2) throw new EligibilityReadError(403, 'Simulated revoked access');
    return originalEligibility.call(this, actor, epoch);
  };
  try {
    const revoked = await send('/api/composite/reconciliation/resolve', { operationId });
    expect(revoked.status).toBe(403);
    expect(revoked.data.code).toBe('ELIGIBILITY_DENIED');
  } finally { EligibilityClient.prototype.require = originalEligibility; }
  const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
  const userIndex = `${redisSessions()!.prefix}user:${createHash('sha256').update(claims.sub).digest('hex')}`;
  expect(await redisSessions()!.client.sIsMember(`${userIndex}:composite-pending`, `${redisSessions()!.prefix}session:${sessionId}`)).toBeTruthy();
  await redisSessions()!.client.del(userIndex);
  const competing = await Promise.all([send('/api/composite/reconciliation/resolve', { operationId }), send('/api/composite/reconciliation/resolve', { operationId })]);
  expect(competing.filter(result => result.status === 200 && result.data.resolution === 'RESOLVED')).toHaveLength(1);
  expect(competing.every(result => result.status === 200 || result.status === 409 && result.data.code === 'SESSION_BUSY')).toBe(true);
  expect(competing.find(result => result.data.resolution === 'RESOLVED')!.data.surface.view.id).toBe('composite_reconciled_card');
  const repeated = await send('/api/composite/reconciliation/resolve', { operationId });
  expect(repeated.status).toBe(200);
  expect(repeated.data.resolution).toBe('ALREADY_RESOLVED');
  expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(charges);
  expect(store.list(residentApi.accountId, 'ride')).toHaveLength(rides);
  const session = await fetch(`${endpoint}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  const saved = await session.json() as { compositeResolution?: { operationId: string; terms: Record<string, unknown>; resolvedAt: number }; compositeAttempt?: unknown; reconciliation?: unknown };
  expect(saved.compositeResolution).toMatchObject({ operationId, terms: binding });
  expect(Number.isSafeInteger(saved.compositeResolution?.resolvedAt)).toBe(true);
  expect(saved.compositeAttempt).toBeUndefined();
  expect(saved.reconciliation).toBeUndefined();
  const fenceResponse = await fetch(`${endpoint}/api/composite/fence?${new URLSearchParams({ accountId: residentApi.accountId })}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
  expect((await fenceResponse.json()).status).toBe('CLEAR');
  expect(await redisSessions()!.client.ttl(`${redisSessions()!.prefix}session:${sessionId}`)).toBeGreaterThan(0);
  expect(await redisSessions()!.client.sIsMember(`${userIndex}:composite-pending`, `${redisSessions()!.prefix}session:${sessionId}`)).toBeFalsy();
  expect((await redisSessions()!.list(claims.sub)).some(session => session.sessionId === sessionId)).toBe(true);
  expect((await send('/api/a2ui/intent', { text: 'Show my wallet balance' })).status).toBe(200);
});
