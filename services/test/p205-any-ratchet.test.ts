import test from 'node:test';
import assert from 'node:assert/strict';
import { countAny, compareToBaseline } from '../../scripts/check-any-types.ts';

const count = (text: string) => countAny([{ path: 'x/a.ts', text }])['x/a.ts'] ?? 0;

test('P2-05: any is counted where it is a type, and not in comments, strings or words', () => {
  assert.equal(count('const a: any = 1;'), 1);
  assert.equal(count('const a = b as any;'), 1);
  assert.equal(count('const a = <any>b;'), 1);
  assert.equal(count('function f(x: any, y: any): Promise<any> {}'), 3);
  assert.equal(count('type T = Record<string, any>; type U = any[];'), 2);
  assert.equal(count('type V = string | any;'), 1);
  assert.equal(count('// a: any in a comment\nconst note = "x: any"; /* as any */ const many = company;'), 0);
  assert.equal(count('const unknownValue: unknown = 1; const anything = 2;'), 0);
  assert.deepEqual(countAny([{ path: 'x/a.d.ts', text: 'declare const a: any;' }, { path: 'x/a.js', text: 'let a: any' }]), {}, 'only ts and tsx source is scanned');
});

test('P2-05: a file that gains any fails, a new file with any fails, and an improvement must lower the baseline', () => {
  assert.deepEqual(compareToBaseline({ 'a.ts': 2 }, { 'a.ts': 2 }), { regressions: [], stale: [] });
  assert.match(compareToBaseline({ 'a.ts': 3 }, { 'a.ts': 2 }).regressions[0], /a\.ts: 3 uses of any, baseline 2/);
  assert.match(compareToBaseline({ 'new.ts': 1 }, {}).regressions[0], /new\.ts: 1 uses of any, baseline 0/);
  assert.match(compareToBaseline({ 'a.ts': 1 }, { 'a.ts': 2 }).stale[0], /a\.ts: now 1, baseline 2/);
  assert.match(compareToBaseline({}, { 'gone.ts': 2 }).stale[0], /gone\.ts: now 0/);
});
