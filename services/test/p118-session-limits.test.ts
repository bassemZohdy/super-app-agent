import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLimits, sessionLimitsFromEnv } from '../agent-core/src/session-limits.ts';
import { issueApproval, actionIsApproved } from '../agent-core/src/approvals.ts';
import { handleConversation } from '../agent-core/src/conversation.ts';

const never = () => false;
const clock = (start = 1_000_000) => { let now = start; return { now: () => now, advance: (ms: number) => { now += ms; } }; };

test('P1-18: the thread count per owner is bounded and the owner\'s least recently used thread goes first', () => {
  const c = clock(), limits = new SessionLimits({ maxPerOwner: 3, maxTotal: 100, idleMs: 3_600_000, now: c.now });
  for (const sid of ['a1', 'a2', 'a3']) { assert.deepEqual(limits.admit(sid, 'alice', never), { evicted: [] }); c.advance(10); }
  limits.admit('a1', 'alice', never); c.advance(10);                               // a1 is used again, so a2 is now the oldest
  assert.deepEqual(limits.admit('a4', 'alice', never), { evicted: ['a2'] });
  assert.equal(limits.countFor('alice'), 3);
});

test('P1-18: one owner\'s churn never evicts another owner\'s threads', () => {
  const c = clock(), limits = new SessionLimits({ maxPerOwner: 2, maxTotal: 100, now: c.now });
  limits.admit('b1', 'bob', never); c.advance(10); limits.admit('b2', 'bob', never); c.advance(10);
  for (let i = 0; i < 50; i++) { limits.admit(`a${i}`, 'alice', never); c.advance(10); }
  assert.equal(limits.countFor('bob'), 2);
  assert.equal(limits.countFor('alice'), 2);
});

test('P1-18: the overall count is bounded and the global least recently used thread goes first', () => {
  const c = clock(), limits = new SessionLimits({ maxPerOwner: 10, maxTotal: 3, now: c.now });
  for (const [sid, owner] of [['x1', 'u1'], ['x2', 'u2'], ['x3', 'u3']]) { limits.admit(sid, owner, never); c.advance(10); }
  assert.deepEqual(limits.admit('x4', 'u4', never), { evicted: ['x1'] });
  assert.equal(limits.size, 3);
});

test('P1-18: idle threads expire and a thread with a request in flight is never evicted', () => {
  const c = clock(), limits = new SessionLimits({ maxPerOwner: 2, maxTotal: 100, idleMs: 1000, now: c.now });
  limits.admit('i1', 'alice', never); limits.admit('i2', 'alice', never);
  c.advance(2000);
  assert.deepEqual(limits.sweep(id => id === 'i1').sort(), ['i2'], 'a busy thread outlives its idle time');
  limits.admit('i3', 'alice', id => id === 'i1');
  assert.equal(limits.admit('i4', 'alice', id => id === 'i1' || id === 'i3'), undefined, 'when every candidate is busy the new thread is refused');
  assert.equal(limits.countFor('alice'), 2, 'nothing busy was dropped');
});

test('P1-18: only the owner\'s own activity keeps a thread alive', () => {
  const c = clock(), limits = new SessionLimits({ idleMs: 1000, now: c.now });
  limits.admit('k1', 'alice', never);
  c.advance(800); limits.admit('k1', 'mallory', never);                            // another caller touching it does not refresh it
  c.advance(800);
  assert.deepEqual(limits.sweep(never), ['k1']);
  limits.admit('k2', 'alice', never); c.advance(800); limits.admit('k2', 'alice', never); c.advance(800);
  assert.deepEqual(limits.sweep(never), [], 'the owner\'s use refreshes it');
});

test('P1-18: memory stays bounded under churn', () => {
  const c = clock(), limits = new SessionLimits({ maxPerOwner: 5, maxTotal: 40, idleMs: 600_000, now: c.now });
  let largest = 0;
  for (let i = 0; i < 20_000; i++) { limits.admit(`s${i}`, `owner${i % 37}`, never); c.advance(7); largest = Math.max(largest, limits.size); }
  assert.ok(largest <= 40, `peak ${largest}`);
  for (let o = 0; o < 37; o++) assert.ok(limits.countFor(`owner${o}`) <= 5);
});

test('P1-18: forgetting a thread frees its slot', () => {
  const limits = new SessionLimits({ maxPerOwner: 1 });
  limits.admit('f1', 'alice', never); limits.forget('f1');
  assert.deepEqual(limits.admit('f2', 'alice', never), { evicted: [] });
});

test('P1-18: limits come from the environment and a bad value fails at startup', () => {
  assert.equal(sessionLimitsFromEnv({ SESSION_MAX_PER_OWNER: '2', SESSION_MAX_TOTAL: '9' } as NodeJS.ProcessEnv).countFor('x'), 0);
  for (const bad of ['0', '-1', '1.5', 'many']) assert.throws(() => sessionLimitsFromEnv({ SESSION_MAX_PER_OWNER: bad } as NodeJS.ProcessEnv), /positive integer/);
  assert.throws(() => new SessionLimits({ maxPerOwner: 0 }), /positive integers/);
});

test('P1-18: the running core keeps at most the configured threads per owner and drops the oldest', async t => {
  const saved = { SESSION_MAX_PER_OWNER: process.env.SESSION_MAX_PER_OWNER };
  process.env.SESSION_MAX_PER_OWNER = '3';
  t.after(() => { if (saved.SESSION_MAX_PER_OWNER === undefined) delete process.env.SESSION_MAX_PER_OWNER; else process.env.SESSION_MAX_PER_OWNER = saved.SESSION_MAX_PER_OWNER; });
  const { executeCoreRequest: core, sessions } = await import('../agent-core/src/index.ts');
  const headers = { authorization: 'Bearer demo-local' };
  for (const id of ['limit_s1', 'limit_s2', 'limit_s3', 'limit_s4', 'limit_s5']) {
    const reply = await core('POST', '/api/a2ui/intent', {}, { sessionId: id, text: 'hello' }, headers);
    assert.equal(reply.status, 200, id);
  }
  const mine = [...sessions.keys()].filter(id => id.startsWith('limit_'));
  assert.deepEqual(mine.sort(), ['limit_s3', 'limit_s4', 'limit_s5']);
  assert.equal((await core('GET', '/api/sessions/limit_s1', {}, {}, headers)).status, 404, 'the evicted thread is gone');
  assert.equal((await core('GET', '/api/sessions/limit_s5', {}, {}, headers)).status, 200);
  assert.equal((await core('GET', '/api/sessions/limit_s2', {}, {}, headers)).status, 404, 'every evicted thread is gone, not just the first');
});

// The refusals P1-18 names: a confirmation is bound to its identity, account, reviewed revision and exact fields, and chat assent is not one.

const reviewed = () => {
  const state: any = { sessionId: 'p118_approval', messages: [], activeDomain: 'concierge', metadata: { accountId: 'acc_1' }, user: { sub: 'alice' },
    currentSurface: { version: '1.0.0', sessionId: 'p118_approval', timestamp: Date.now(), revision: 'rev-1', view: { type: 'SurfaceCard', id: 'card', children: [
      { type: 'Button', id: 'pay', properties: { label: 'Pay' }, onEvents: [{ event: 'onPress', actionType: 'AGENT_ACTION_DISPATCH', payload: { action: 'pay', amount: 50 } }] }] } } };
  issueApproval(state);
  return state;
};

test('P1-18: a confirmation is refused for another identity, another account, a newer revision or different fields', () => {
  const state = reviewed();
  assert.equal(actionIsApproved(state, 'pay', { amount: 50 }, 'alice', 'acc_1'), true);
  assert.equal(actionIsApproved(state, 'pay', { amount: 50 }, 'mallory', 'acc_1'), false, 'cross-identity');
  assert.equal(actionIsApproved(state, 'pay', { amount: 50 }, 'alice', 'acc_2'), false, 'cross-account');
  assert.equal(actionIsApproved(state, 'pay', { amount: 51 }, 'alice', 'acc_1'), false, 'changed field');
  assert.equal(actionIsApproved(state, 'pay', { amount: 50, extra: true }, 'alice', 'acc_1'), false, 'extra field');
  assert.equal(actionIsApproved(state, 'refund', { amount: 50 }, 'alice', 'acc_1'), false, 'different action');
  state.currentSurface.revision = 'rev-2';
  assert.equal(actionIsApproved(state, 'pay', { amount: 50 }, 'alice', 'acc_1'), false, 'stale: the reviewed revision was replaced');
});

test('P1-18: a typed yes, confirm or pay-it never approves and leaves the offered approval untouched', () => {
  for (const phrase of ['yes', 'yes please', 'ok', 'confirm it', 'go ahead', 'do it', 'pay it', 'نعم']) {
    const state = reviewed(), before = JSON.stringify(state.approval);
    assert.equal(handleConversation(state, phrase), true, phrase);
    assert.match(state.messages.at(-1).content, /confirmation button/, phrase);
    assert.equal(JSON.stringify(state.approval), before, 'the approval is neither consumed nor created by chat');
    assert.equal(state.paymentFlow, undefined);
  }
});

test('P1-18: cancelling in chat clears the reviewed surface, so the old confirmation cannot be used', () => {
  const state = reviewed();
  assert.equal(handleConversation(state, 'cancel'), true);
  assert.equal(actionIsApproved(state, 'pay', { amount: 50 }, 'alice', 'acc_1'), false);
});
