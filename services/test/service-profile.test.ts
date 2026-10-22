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

