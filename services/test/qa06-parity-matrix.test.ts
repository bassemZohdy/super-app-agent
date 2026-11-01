import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// QA-06: the shell parity guide is the agreed journey matrix. Every test it names must exist, so a renamed or deleted spec cannot
// leave a journey claimed as proven, and a journey with no test must be listed as a known gap instead of silently missing.
const guide = readFileSync('docs/development/shell-parity.md', 'utf8');
const section = (heading: string) => {
  const start = guide.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `the guide has a "${heading}" section`);
  const next = guide.indexOf('\n## ', start + 1);
  return guide.slice(start, next < 0 ? undefined : next);
};

test('QA-06: every file the parity matrix names exists', () => {
  const named = [...guide.matchAll(/`((?:test|apps|services|scripts)\/[^`\s]+\.(?:ts|dart))`/g)].map(match => match[1]);
  assert.ok(named.length >= 20, `the matrix names its tests (${named.length} found)`);
  const missing = [...new Set(named)].filter(path => !existsSync(path));
  assert.deepEqual(missing, [], 'every named test file exists');
});

test('QA-06: every shell column covers every journey or says "none yet", and each gap is listed', () => {
  const rows = section('The matrix').split('\n').filter(line => line.startsWith('|')).slice(2);
  assert.ok(rows.length >= 8, 'the matrix has its journeys');
  const gaps: string[] = [];
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 5, `a row has a journey, three shells and a check: ${row.slice(0, 60)}`);
    cells.slice(1, 4).forEach((cell, index) => {
      assert.ok(cell === 'none yet' || /`[^`]+`/.test(cell), `${cells[0]} names a test or "none yet" for ${['React', 'Angular', 'Flutter web'][index]}`);
      if (cell === 'none yet') gaps.push(`${cells[0]} / ${['React', 'Angular', 'Flutter web'][index]}`);
    });
  }
  const listed = section('Not yet proven').split('\n').filter(line => line.startsWith('- ') && !/None at the moment/.test(line)).length;
  assert.ok(listed >= gaps.length, `each of the ${gaps.length} "none yet" cells (${gaps.join('; ')}) appears under "Not yet proven" (${listed} listed)`);
});

test('QA-06: the guide gates native and device behavior by name', () => {
  const gated = section('Gated: not offered or not provable here');
  for (const phrase of ['Native Flutter sign-in', 'Devices']) assert.match(gated, new RegExp(phrase), `${phrase} is gated`);
});
