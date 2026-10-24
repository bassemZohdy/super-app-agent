import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, logEvent } from '../../packages/backend-kit/src/redact.ts';

test('redact: replaces every named sensitive key case-insensitively', () => {
  const keys = ['authorization', 'Cookie', 'set-cookie', 'PASSWORD', 'client_secret', 'clientSecret',
    'token', 'access_token', 'refresh_token', 'id_token', 'secret', 'api_key', 'apiKey'];
  for (const key of keys) {
    assert.deepStrictEqual(redact({ [key]: 'value-that-is-not-a-pan' }), { [key]: '[REDACTED]' }, key);
  }
});

test('redact: replaces any key containing "secret" or "token" case-insensitively', () => {
  const out = redact({ myTOKENValue: 'a', webhookSecretId: 'b', tokenCount: 'c', harmless: 'd' });
  assert.deepStrictEqual(out, { myTOKENValue: '[REDACTED]', webhookSecretId: '[REDACTED]', tokenCount: '[REDACTED]', harmless: 'd' });
});

test('redact: walks nested objects and arrays', () => {
  const input = { outer: { inner: [{ password: 'x', name: 'ok' }, { headers: { Authorization: 'abc' } }] } };
  assert.deepStrictEqual(redact(input), {
    outer: { inner: [{ password: '[REDACTED]', name: 'ok' }, { headers: { Authorization: '[REDACTED]' } }] },
  });
});

test('redact: replaces bearer-looking string values', () => {
  assert.deepStrictEqual(redact({ note: 'Bearer abc.def.ghi' }), { note: '[REDACTED]' });
  assert.deepStrictEqual(redact(['Bearer xyz']), ['[REDACTED]']);
});

test('redact: masks Luhn-valid card numbers but not other 16-digit runs', () => {
  assert.equal(redact('card 4111111111111111'), 'card [REDACTED_PAN]');
  assert.equal(redact('4111 1111 1111 1111'), '[REDACTED_PAN]');
  assert.equal(redact('4111-1111-1111-1111'), '[REDACTED_PAN]');
  assert.equal(redact('ref 4111111111111112'), 'ref 4111111111111112');
});

test('redact: leaves non-sensitive primitives unchanged', () => {
  assert.deepStrictEqual(redact({ n: 42, b: true, s: 'hello', z: null }), { n: 42, b: true, s: 'hello', z: null });
});

test('redact: handles cycles without throwing', () => {
  const node: Record<string, unknown> = { name: 'loop' };
  node.self = node;
  const out = redact(node) as Record<string, unknown>;
  assert.equal(out.name, 'loop');
  assert.equal(out.self, '[CIRCULAR]');
});

test('redact: truncates beyond depth 10', () => {
  let deep: Record<string, unknown> = { leaf: 'value' };
  for (let i = 0; i < 15; i += 1) deep = { next: deep };
  let cursor: any = redact(deep);
  for (let i = 0; i < 10; i += 1) cursor = cursor.next;
  assert.equal(cursor.next, '[TRUNCATED]');
});

test('redact: returns "[UNREADABLE]" for throwing getters instead of throwing', () => {
  const hostile = {
    ok: 'fine',
    get boom(): string { throw new Error('getter exploded'); },
  };
  assert.deepStrictEqual(redact(hostile), { ok: 'fine', boom: '[UNREADABLE]' });
});

test('redact: does not mutate the input', () => {
  const input = { token: 'secret-value', nested: { password: 'p', list: ['Bearer x', '4111111111111111'] } };
  const snapshot = JSON.stringify(input);
  redact(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('redact: keeps "__proto__" as plain data without prototype pollution', () => {
  const input = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}');
  const out = redact(input) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(out.name, 'x');
});

test('logEvent: writes one valid JSON line without secrets to console.log', t => {
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: string) => { lines.push(line); });
  logEvent('info', 'Token exchange ok', { access_token: 'eyJsecret', status: 200, card: '4111111111111111' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('\n'), false);
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'info');
  assert.equal(record.message, 'Token exchange ok');
  assert.equal(record.status, 200);
  assert.equal(record.access_token, '[REDACTED]');
  assert.equal(record.card, '[REDACTED_PAN]');
  assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(lines[0].includes('eyJsecret'), false);
  assert.equal(lines[0].includes('4111111111111111'), false);
});

test('logEvent: uses console.error for error level and survives BigInt and cycles', t => {
  const errors: string[] = [];
  t.mock.method(console, 'error', (line: string) => { errors.push(line); });
  const fields: Record<string, unknown> = { size: 10n };
  fields.self = fields;
  logEvent('error', 'boom', fields);
  assert.equal(errors.length, 1);
  const record = JSON.parse(errors[0]);
  assert.equal(record.level, 'error');
  assert.equal(record.size, '10');
  assert.equal(record.self, '[CIRCULAR]');
});
