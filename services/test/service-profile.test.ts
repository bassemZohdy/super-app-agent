import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProfileRequest } from '../service-profile/src/index.ts';

test('service-profile: health check endpoint', () => {
  const health = executeProfileRequest('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.service, 'service-profile');
  assert.strictEqual(health.data.port, 4005);
});

test('service-profile: retrieve profile and verify VIP tier', () => {
  const res = executeProfileRequest('GET', '/profile');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.profile.username, 'bassem');
  assert.strictEqual(res.data.profile.vipTier, 'Gold VIP');
});

test('service-profile: retrieve and update user preferences', () => {
  const getPrefs = executeProfileRequest('GET', '/profile/preferences');
  assert.strictEqual(getPrefs.status, 200);
  assert.ok(getPrefs.data.preferences.dietary.includes('Vegetarian'));

  const update = executeProfileRequest('POST', '/profile/preferences', {}, {
    dietary: ['Vegetarian', 'Gluten-Free'],
    mobility: { preferredTier: 'drv_3', preferredTierName: 'Tesla Model Y (EV)' },
    conciergeTone: 'vip',
  });
  assert.strictEqual(update.status, 200);
  assert.strictEqual(update.data.success, true);
  assert.ok(update.data.preferences.dietary.includes('Gluten-Free'));
  assert.ok(update.data.promptContext.includes('Gold VIP'));
});

test('service-profile: prompt-context generates tailored LLM instructions', () => {
  const ctx = executeProfileRequest('GET', '/profile/prompt-context');
  assert.strictEqual(ctx.status, 200);
  assert.ok(ctx.data.promptContext.includes('USER PROFILE CONTEXT'));
  assert.ok(ctx.data.promptContext.includes('Bassem Zohdy'));
});

test('service-profile: MCP protocol tool definitions', () => {
  const mcp = executeProfileRequest('GET', '/mcp');
  assert.strictEqual(mcp.status, 200);
  assert.strictEqual(mcp.data.protocol, 'mcp-1.0');
  assert.ok(mcp.data.tools.some((t: any) => t.name === 'profile_getPromptContext'));
});

test('P1-18: the profile has a revision that every change moves, and a stale expected revision is refused without a write', () => {
  const start = executeProfileRequest('GET', '/profile').data.revision as number;
  assert.ok(Number.isInteger(start) && start >= 1);
  assert.equal(executeProfileRequest('GET', '/profile/prompt-context').data.revision, start);
  const stale = executeProfileRequest('POST', '/profile/preferences', {}, { conciergeTone: 'formal', expectedRevision: start + 5 });
  assert.deepEqual([stale.status, stale.data.code, stale.data.currentRevision], [409, 'PROFILE_REVISION_CHANGED', start]);
  assert.equal(executeProfileRequest('GET', '/profile').data.revision, start, 'a refused change leaves the revision');
  assert.notEqual(executeProfileRequest('GET', '/profile/preferences').data.preferences.conciergeTone, 'formal', 'and the preferences');
  const changed = executeProfileRequest('POST', '/profile/preferences', {}, { conciergeTone: 'friendly', expectedRevision: start });
  assert.deepEqual([changed.status, changed.data.revision], [200, start + 1]);
  assert.equal(executeProfileRequest('POST', '/profile/preferences', {}, { ui: { denseMode: false } }).data.revision, start + 2, 'a change without an expected revision still works and moves it');
  assert.equal(executeProfileRequest('POST', '/profile/preferences', {}, { expectedRevision: 0 }).status, 400, 'a revision below 1 is not a revision');
});
