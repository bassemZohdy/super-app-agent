import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION_OPERATIONS } from '../../packages/backend-kit/src/application-openapi.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// P1-14: a malformed or hostile request must fail safely on every validated application operation. For each operation that has a
// request contract, an array, a prototype-pollution key, an oversized string, a field the contract does not name, a null value
// and a deeply nested value are each refused with a 400 (never accepted, never thrown), in the body and in the query, and the
// caller's input is left untouched.
const nested = JSON.parse('{"a":'.repeat(40) + '1' + '}'.repeat(40));
const hostile: [string, unknown][] = [
  ['an array', []],
  ['a prototype-pollution key', JSON.parse('{"__proto__":{"polluted":true}}')],
  ['an oversized string', { x: 'a'.repeat(300_000) }],
  ['a field the contract does not name', { zz_unknown_field: 1 }],
  ['a null value', { a: null }],
  ['a deeply nested value', nested],
];

const validated = APPLICATION_OPERATIONS.filter(operation => !('manualSchema' in operation && operation.manualSchema));

test('P1-14: the validated operations are enumerated, so the check below cannot pass over nothing', () => {
  assert.ok(validated.length >= 30, `${validated.length} operations have a request contract`);
});

test('P1-14: positive control: the validator still accepts a valid request, so refusing hostile input is not refusing everything', () => {
  const accepting = validated.filter(operation => {
    const contract = ('contract' in operation && typeof operation.contract === 'string' ? operation.contract : operation.path).replace(/\{[^}]+\}/g, 'x1');
    return validateRequest(operation.service, operation.method, contract, {}, {}) === undefined;
  });
  assert.ok(accepting.length >= 1, 'at least one operation accepts an empty valid request');
});

test('P1-14: every validated application operation refuses hostile input safely and leaves it untouched', () => {
  const failures: string[] = [];
  for (const operation of validated) {
    const contract = ('contract' in operation && typeof operation.contract === 'string' ? operation.contract : operation.path).replace(/\{[^}]+\}/g, 'x1');
    for (const [name, value] of hostile) {
      for (const where of ['body', 'query'] as const) {
        const input = structuredClone(value);
        const before = JSON.stringify(input);
        let refused: ReturnType<typeof validateRequest>;
        try {
          refused = where === 'body'
            ? validateRequest(operation.service, operation.method, contract, {}, input)
            : validateRequest(operation.service, operation.method, contract, input, {});
        } catch (error) {
          failures.push(`${operation.method} ${operation.path}: ${name} in the ${where} threw ${String(error).slice(0, 60)}`);
          continue;
        }
        if (refused?.status !== 400) failures.push(`${operation.method} ${operation.path}: ${name} in the ${where} was not refused (${refused?.status ?? 'accepted'})`);
        if (JSON.stringify(input) !== before) failures.push(`${operation.method} ${operation.path}: ${name} in the ${where} was changed by validation`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.slice(0, 5).join('\n'));
});
