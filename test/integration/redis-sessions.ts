import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { RedisSessionStore } from '../../services/agent-core/src/session-store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/index.ts';

test('concurrent Redis listeners receive events and can resubscribe after cleanup', { timeout: 15000 }, async t => {
  const prefix = `cityside-stream-race:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), first = `redis_${randomUUID()}`, second = `redis_${randomUUID()}`;
  t.after(async () => { await store.connect(); const keys = await store.client.keys(`${prefix}*`); if (keys.length) await store.client.del(keys); await store.close(); });
  const received: number[] = [];
  const offs = await Promise.all(Array.from({ length: 10 }, (_, index) => store.subscribe(index < 5 ? first : second, () => { received.push(index); })));
  await store.publish(first, createA2UIMessage('A2UI_STREAM_DELTA', first, { text: 'first' }));
  await store.publish(second, createA2UIMessage('A2UI_STREAM_DELTA', second, { text: 'second' }));
  const deadline = Date.now() + 5000;
  while (received.length < 10 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(received.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await Promise.all(offs.map(off => off()));
  const off = await store.subscribe(first, () => { received.push(10); });
  await store.publish(first, createA2UIMessage('A2UI_STREAM_DELTA', first, { text: 'again' }));
  while (received.length < 11 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(received.at(-1), 10);
  await off();
});

test('Redis persists empty arrays, isolates owners/accounts, fences locks and replays across clients', async t => {
  const prefix=`cityside-test:${randomUUID()}:`, url=process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const a=new RedisSessionStore(url,60,prefix), b=new RedisSessionStore(url,60,prefix);
  t.after(async()=>{ await a.connect(); const keys=await a.client.keys(`${prefix}*`); if(keys.length) await a.client.del(keys); await a.close(); await b.close(); });
  const sid=`redis_${randomUUID()}`, account=accountIdFor('alice');
  const state=await a.claim(sid,'alice',account);
  await assert.rejects(()=>b.claim(sid,'bob',accountIdFor('bob')),/different user/);
  await assert.rejects(()=>b.claim(sid,'alice',accountIdFor('alice','household')),/switching accounts/);
  const lock=await a.acquire(sid); await assert.rejects(()=>b.acquire(sid),/already running/);
  state.currentSurface={version:'1.0.0',sessionId:sid,timestamp:Date.now(),revision:randomUUID(),view:{type:'SurfaceCard',id:'root',children:[{type:'DataTable',id:'table',properties:{columns:[],rows:[]}}]}};
  await lock.save(state); await lock.release();
  const restored=await b.read(sid,'alice'); assert.deepEqual(restored.state.messages,[]); assert.deepEqual(restored.state.currentSurface?.view.children?.[0].properties?.rows,[]);
  const stale=await a.acquire(sid); await a.client.del(`${prefix}session:${sid}:lock`); const current=await b.acquire(sid);
  await assert.rejects(()=>stale.save(state),/could not be saved/); await stale.release(); await current.assert(); await current.release();
  let received!:()=>void; const eventArrived=new Promise<void>(resolve=>{received=resolve;});
  const off=await b.subscribe(sid,()=>received());
  const one=createA2UIMessage('A2UI_STREAM_DELTA',sid,{text:'one'}),two=createA2UIMessage('A2UI_STREAM_DELTA',sid,{text:'two'});
  await a.publish(sid,one); await a.publish(sid,two); await eventArrived;
  assert.deepEqual((await b.after(sid,one.id))?.map(e=>e.id),[two.id]); await off();
  assert.equal((await b.list('alice')).length,1);
  await b.remove(sid,'alice'); await assert.rejects(()=>a.read(sid,'alice'),/expired/);
});


test('civic coordination survives client restart and only its owner can release it', async t => {
  const prefix = `cityside-civic-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const first = new RedisSessionStore(url, 60, prefix), second = new RedisSessionStore(url, 60, prefix);
  t.after(async () => { await second.connect(); const keys = await second.client.keys(`${prefix}*`); if (keys.length) await second.client.del(keys); await first.close(); await second.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'test_civic_session', action: 'confirm_smartcity_checkout' as const };
  const held = await first.acquireCivicFence(owner);
  assert.equal(await first.client.ttl(`${prefix}offline-civic-fence`), -1, 'uncertain effects must never unlock on a timer');
  await assert.rejects(() => second.acquireCivicFence(owner), /civic payment/i);
  await first.close();
  await assert.rejects(() => second.acquireCivicFence(owner), /civic payment/i, 'a restart retains the fence');
  await held.release();
  const current = await second.acquireCivicFence(owner);
  await assert.rejects(() => held.bindReview({ billId: 'B1', billAmountMinor: 0, fines: [], tagNumber: 'T1', tollAmountMinor: 10000 }), /coordination/i, 'an old owner cannot alter a newer fence');
  await held.release();
  await assert.rejects(() => first.acquireCivicFence(owner), /civic payment/i, 'an old token cannot release a newer fence');
  await current.release();
  const fresh = await first.acquireCivicFence(owner);
  await fresh.release();
});


test('civic fence inspection exposes journey details only to its owner and account', async t => {
  const prefix = `cityside-civic-owner-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix);
  t.after(async () => { await store.connect(); const key = `${prefix}offline-civic-fence`; await store.client.del(key); await store.close(); });
  const owner = { subject: 'alice', accountId: accountIdFor('alice'), sessionId: 'civic_owner_session', action: 'confirm_smartcity_checkout' as const };
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'CLEAR' });
  const fence = await store.acquireCivicFence(owner);
  const initial = await store.inspectCivicFence(owner.subject, owner.accountId);
  assert.equal(initial.status, 'BLOCKED'); assert.equal(initial.sessionId, owner.sessionId); assert.equal(initial.action, owner.action); assert.deepEqual(initial.civicSteps, []); assert.match(initial.revision!, /^[a-f0-9]{64}$/);
  const reviewed = { billId: 'DEWA-1', billAmountMinor: 200, fines: [{ fineId: 'FINE-1', amountMinor: 300 }], tagNumber: 'SLK-1', tollAmountMinor: 10000 };
  await assert.rejects(() => fence.startStep('WALLET'), /review/i);
  await assert.rejects(() => fence.bindReview({ ...reviewed, fines: [reviewed.fines[0], reviewed.fines[0]] }), /review/i);
  await assert.rejects(() => fence.bindReview({ ...reviewed, billAmountMinor: Number.MAX_SAFE_INTEGER }), /review/i);
  await assert.rejects(() => fence.bindReview({ ...reviewed, tollAmountMinor: 9999 }), /review/i);
  await fence.bindReview(reviewed);
  await assert.rejects(() => store.resolveCivicFence(owner.subject, owner.accountId, initial.revision!), /changed/i, 'a stale review cannot clear the current fence');
  assert.deepEqual((await store.inspectCivicFence(owner.subject, owner.accountId)).civicReview, reviewed);
  await assert.rejects(() => fence.bindReview({ ...reviewed, billAmountMinor: 999 }), /review/i);
  const operationId = await fence.startStep('WALLET');
  assert.match(operationId!, /^CIVIC-/);
  assert.deepEqual((await store.inspectCivicFence(owner.subject, owner.accountId)).civicSteps, [{ name: 'WALLET', state: 'STARTED', operationId }]);
  await assert.rejects(() => fence.startStep('UTILITY'), /step/i);
  await assert.rejects(() => fence.finishStep('WALLET', 'CONFIRMED', 'invalid reference with spaces'), /step/i);
  await fence.finishStep('WALLET', 'CONFIRMED', 'GOV-TX-1');
  const utilityOperationId = await fence.startStep('UTILITY');
  assert.match(utilityOperationId!, /^CIVIC-/);
  await assert.rejects(() => fence.finishStep('UTILITY', 'UNKNOWN', 'unexpected-reference'), /step/i);
  await fence.finishStep('UTILITY', 'UNKNOWN');
  assert.deepEqual((await store.inspectCivicFence(owner.subject, owner.accountId)).civicSteps, [{ name: 'WALLET', state: 'CONFIRMED', operationId, receiptReference: 'GOV-TX-1' }, { name: 'UTILITY', state: 'UNKNOWN', operationId: utilityOperationId }]);
  await assert.rejects(() => fence.startStep('FINES'), /step/i);
  assert.deepEqual(await store.inspectCivicFence('bob', owner.accountId), { status: 'BLOCKED' });
  assert.deepEqual(await store.inspectCivicFence(owner.subject, accountIdFor('alice', 'household')), { status: 'BLOCKED' });
  await fence.release();
  const digest = createHash('sha256').update(JSON.stringify([owner.subject, owner.accountId])).digest('hex');
  await store.client.set(`${prefix}offline-civic-fence`, JSON.stringify({ version: 2, owner: digest, sessionId: owner.sessionId, action: owner.action, steps: [{ name: 'WALLET', state: 'UNKNOWN' }] }));
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'BLOCKED', sessionId: owner.sessionId, action: owner.action, civicSteps: [{ name: 'WALLET', state: 'UNKNOWN' }] });
  await store.client.set(`${prefix}offline-civic-fence`, 'legacy-unattributed-token');
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'BLOCKED' });
});


test('older wallet-only journals remain observable after utility identities are introduced', async t => {
  const prefix = `cityside-civic-v6-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), key = `${prefix}offline-civic-fence`;
  t.after(async () => { await store.connect(); await store.client.del(key); await store.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'old_civic_session', action: 'confirm_smartcity_checkout' as const };
  const fence = await store.acquireCivicFence(owner);
  await fence.bindReview({ billId: 'B1', billAmountMinor: 0, fines: [], tagNumber: 'T1', tollAmountMinor: 10000 });
  await fence.startStep('WALLET'); await fence.finishStep('WALLET', 'UNKNOWN');
  const raw = await store.client.get(key); assert.ok(raw);
  await store.client.set(key, JSON.stringify({ ...JSON.parse(raw), version: 6 }));
  const old = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(old.revision);
  await store.observeCivicWallet(owner.subject, owner.accountId, old.revision, 'W1');
  const updated = await store.inspectCivicFence(owner.subject, owner.accountId);
  assert.equal(updated.civicSteps?.[0].state, 'CONFIRMED'); assert.equal(updated.civicSteps?.[0].recoveredFrom, 'UNKNOWN');
});

test('utility observation preserves an earlier recovered wallet journal', async t => {
  const prefix = `cityside-civic-v11-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), key = `${prefix}offline-civic-fence`;
  t.after(async () => { await store.connect(); await store.client.del(key); await store.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'both_recovered_session', action: 'confirm_smartcity_checkout' as const };
  const fence = await store.acquireCivicFence(owner);
  await fence.bindReview({ billId: 'B1', billAmountMinor: 0, fines: [], tagNumber: 'T1', tollAmountMinor: 10000 });
  const walletOperation = await fence.startStep('WALLET'); await fence.finishStep('WALLET', 'UNKNOWN');
  const original = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(original.revision);
  await store.observeCivicWallet(owner.subject, owner.accountId, original.revision, 'W1');
  const raw = await store.client.get(key); assert.ok(raw);
  const utilityOperation = `CIVIC-${randomUUID()}`;
  const record = JSON.parse(raw); record.steps.push({ name: 'UTILITY', state: 'UNKNOWN', operationId: utilityOperation });
  await store.client.set(key, JSON.stringify(record));
  const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
  await store.observeCivicUtility(owner.subject, owner.accountId, before.revision, 'U1');
  const after = await store.inspectCivicFence(owner.subject, owner.accountId);
  assert.equal(after.observedFromRevision, original.revision); assert.equal(after.utilityObservedFromRevision, before.revision);
  assert.equal(after.civicSteps?.[0].operationId, walletOperation); assert.equal(after.civicSteps?.[0].recoveredFrom, 'UNKNOWN');
  assert.equal(after.civicSteps?.[1].operationId, utilityOperation); assert.equal(after.civicSteps?.[1].recoveredFrom, 'UNKNOWN');
  assert.deepEqual(await store.inspectCivicFence(owner.subject, 'another-account'), { status: 'BLOCKED' });
});

test('older utility identity journals remain recoverable after fine identities are introduced', async t => {
  const prefix = `cityside-civic-v8-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), key = `${prefix}offline-civic-fence`;
  t.after(async () => { await store.connect(); await store.client.del(key); await store.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'old_utility_session', action: 'confirm_smartcity_checkout' as const };
  const fence = await store.acquireCivicFence(owner);
  await fence.bindReview({ billId: 'B1', billAmountMinor: 200, fines: [], tagNumber: 'T1', tollAmountMinor: 10000 });
  await fence.startStep('WALLET'); await fence.finishStep('WALLET', 'UNKNOWN');
  const raw = await store.client.get(key); assert.ok(raw);
  await store.client.set(key, JSON.stringify({ ...JSON.parse(raw), version: 8 }));
  const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
  await store.observeCivicWallet(owner.subject, owner.accountId, before.revision, 'W1');
  const observed = await store.client.get(key); assert.ok(observed);
  const record = JSON.parse(observed); assert.equal(record.version, 9);
  record.steps.push({ name: 'UTILITY', state: 'UNKNOWN', operationId: `CIVIC-${randomUUID()}` });
  await store.client.set(key, JSON.stringify(record));
  const utility = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(utility.revision);
  await store.observeCivicUtility(owner.subject, owner.accountId, utility.revision, 'U1');
  const after = await store.inspectCivicFence(owner.subject, owner.accountId);
  assert.equal(after.observedFromRevision, before.revision); assert.equal(after.utilityObservedFromRevision, utility.revision);
  assert.equal(after.civicSteps?.[0].recoveredFrom, 'UNKNOWN'); assert.equal(after.civicSteps?.[1].recoveredFrom, 'UNKNOWN');
});

test('fine observation preserves prior recoveries and supports reviews without a utility step', async t => {
  const prefix = `cityside-fines-observe-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), key = `${prefix}offline-civic-fence`;
  t.after(async () => { await store.connect(); await store.client.del(key); await store.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'fine_observe_session', action: 'confirm_smartcity_checkout' as const };
  await store.acquireCivicFence(owner);
  const raw = await store.client.get(key); assert.ok(raw);
  const base = JSON.parse(raw);
  for (const version of [12, 13, 14, 15, 20, 21, 22, 23]) {
    const baseVersion = version >= 20 ? version - 8 : version;
    const walletRecovered = baseVersion === 13 || baseVersion === 15, utilityRecovered = baseVersion === 14 || baseVersion === 15;
    const wallet = { name: 'WALLET', state: 'CONFIRMED', operationId: `CIVIC-${randomUUID()}`, receiptReference: 'W1', ...(walletRecovered ? { recoveredFrom: 'UNKNOWN' } : {}) };
    const utility = { name: 'UTILITY', state: 'CONFIRMED', operationId: `CIVIC-${randomUUID()}`, receiptReference: 'U1', ...(utilityRecovered ? { recoveredFrom: 'STARTED' } : {}) };
    const fine = { name: 'FINES', state: 'UNKNOWN', operationId: `CIVIC-${randomUUID()}` };
    const record = { ...base, version, review: { billId: 'B1', billAmountMinor: 200, fines: [{ fineId: 'F1', amountMinor: 300 }], tagNumber: 'T1', tollAmountMinor: 10000 }, steps: [wallet, utility, fine], ...(walletRecovered ? { observedFromRevision: 'a'.repeat(64) } : {}), ...(utilityRecovered ? { utilityObservedFromRevision: 'b'.repeat(64) } : {}) };
    await store.client.set(key, JSON.stringify(record));
    const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
    await assert.rejects(() => store.observeCivicFines(owner.subject, 'other-account', before.revision!, 'F1'), /changed/i);
    await store.observeCivicFines(owner.subject, owner.accountId, before.revision, 'F1');
    const after = await store.inspectCivicFence(owner.subject, owner.accountId);
    assert.equal(after.finesObservedFromRevision, before.revision); assert.equal(after.civicSteps?.[2].recoveredFrom, 'UNKNOWN');
    assert.equal(after.observedFromRevision, walletRecovered ? 'a'.repeat(64) : undefined);
    assert.equal(after.utilityObservedFromRevision, utilityRecovered ? 'b'.repeat(64) : undefined);
    await assert.rejects(() => store.observeCivicFines(owner.subject, owner.accountId, before.revision!, 'F1'), /changed/i);
  }
  const record = { ...base, version: 12, review: { billId: 'B1', billAmountMinor: 0, fines: [{ fineId: 'F1', amountMinor: 300 }], tagNumber: 'T1', tollAmountMinor: 10000 }, steps: [{ name: 'WALLET', state: 'CONFIRMED', operationId: `CIVIC-${randomUUID()}`, receiptReference: 'W1' }, { name: 'FINES', state: 'STARTED', operationId: `CIVIC-${randomUUID()}` }] };
  await store.client.set(key, JSON.stringify(record));
  const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
  await store.observeCivicFines(owner.subject, owner.accountId, before.revision, 'F1');
  const after = await store.inspectCivicFence(owner.subject, owner.accountId);
  assert.equal(after.civicSteps?.[1].recoveredFrom, 'STARTED'); assert.equal(after.finesObservedFromRevision, before.revision);
});

test('toll observation preserves earlier recovered steps and handles optional obligations', async t => {
  const prefix = `cityside-toll-observe-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), key = `${prefix}offline-civic-fence`;
  t.after(async () => { await store.connect(); await store.client.del(key); await store.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'toll_observe_session', action: 'confirm_smartcity_checkout' as const };
  await store.acquireCivicFence(owner); const raw = await store.client.get(key); assert.ok(raw); const base = JSON.parse(raw);
  for (const version of [20, 21, 22, 23, 24, 25, 26, 27]) {
    const walletRecovered = [21, 23, 25, 27].includes(version), utilityRecovered = [22, 23, 26, 27].includes(version), fineRecovered = version >= 24;
    const step = (name: string, reference: string, recovered: boolean) => ({ name, state: 'CONFIRMED', operationId: `CIVIC-${randomUUID()}`, receiptReference: reference, ...(recovered ? { recoveredFrom: 'UNKNOWN' } : {}) });
    const record = { ...base, version, review: { billId: 'B1', billAmountMinor: 200, fines: [{ fineId: 'F1', amountMinor: 300 }], tagNumber: 'T1', tollAmountMinor: 10000 }, steps: [step('WALLET', 'W1', walletRecovered), step('UTILITY', 'U1', utilityRecovered), step('FINES', 'F1', fineRecovered), { name: 'TOLL', state: 'UNKNOWN', operationId: `CIVIC-${randomUUID()}` }], ...(walletRecovered ? { observedFromRevision: 'a'.repeat(64) } : {}), ...(utilityRecovered ? { utilityObservedFromRevision: 'b'.repeat(64) } : {}), ...(fineRecovered ? { finesObservedFromRevision: 'c'.repeat(64) } : {}) };
    await store.client.set(key, JSON.stringify(record)); const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
    await assert.rejects(() => store.observeCivicToll(owner.subject, 'other-account', before.revision!, 'T1'), /changed/i);
    await store.observeCivicToll(owner.subject, owner.accountId, before.revision, 'T1'); const after = await store.inspectCivicFence(owner.subject, owner.accountId);
    assert.equal(after.tollObservedFromRevision, before.revision); assert.equal(after.civicSteps?.at(-1)?.recoveredFrom, 'UNKNOWN');
    assert.equal(after.observedFromRevision, walletRecovered ? 'a'.repeat(64) : undefined); assert.equal(after.utilityObservedFromRevision, utilityRecovered ? 'b'.repeat(64) : undefined); assert.equal(after.finesObservedFromRevision, fineRecovered ? 'c'.repeat(64) : undefined);
  }
  for (const utility of [false, true]) for (const fines of [false, true]) {
    const step = (name: string) => ({ name, state: 'CONFIRMED', operationId: `CIVIC-${randomUUID()}`, receiptReference: `${name}-1` });
    const record = { ...base, version: 20, review: { billId: 'B1', billAmountMinor: utility ? 200 : 0, fines: fines ? [{ fineId: 'F1', amountMinor: 300 }] : [], tagNumber: 'T1', tollAmountMinor: 10000 }, steps: [step('WALLET'), ...(utility ? [step('UTILITY')] : []), ...(fines ? [step('FINES')] : []), { name: 'TOLL', state: 'STARTED', operationId: `CIVIC-${randomUUID()}` }] };
    await store.client.set(key, JSON.stringify(record)); const before = await store.inspectCivicFence(owner.subject, owner.accountId); assert.ok(before.revision);
    await store.observeCivicToll(owner.subject, owner.accountId, before.revision, 'T1');
    const after = await store.inspectCivicFence(owner.subject, owner.accountId); assert.equal(after.civicSteps?.at(-1)?.recoveredFrom, 'STARTED');
  }
});


test('Redis subscriptions can be established again after the store closes', { timeout: 10000 }, async t => {
  const prefix = `cityside-close-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix), sid = `redis_${randomUUID()}`;
  t.after(async () => { await store.connect(); const keys = await store.client.keys(`${prefix}*`); if (keys.length) await store.client.del(keys); await store.close(); });
  const oldOff = await store.subscribe(sid, () => {});
  await store.close();
  let resolveEvent!: (id: string) => void;
  const received = new Promise<string>(resolve => { resolveEvent = resolve; });
  const off = await store.subscribe(sid, event => resolveEvent(event.id));
  await oldOff(); // An unsubscribe from the closed generation must not cancel the new one.
  const event = createA2UIMessage('A2UI_STREAM_DELTA', sid, { text: 'after reconnect' });
  await store.publish(sid, event);
  assert.equal(await received, event.id);
  await off();
});
