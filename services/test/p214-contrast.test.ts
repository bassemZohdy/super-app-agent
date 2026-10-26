import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, evaluateContrast, resolveToken, validateSource, buildThemeCss, type Layered } from '../../packages/ui-tokens/src/build.ts';
import { loadSource } from '../../scripts/generate-tokens.ts';

const source = () => loadSource();
const clone = (): Layered => structuredClone(source());

test('P2-14: the contrast ratio matches the WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrastRatio('#767676', '#ffffff').toFixed(2), '4.54');
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrastRatio('#ffffff', '#767676'), contrastRatio('#767676', '#ffffff'), 'the order of the two colors does not matter');
});

test('P2-14: the fills that failed as text are measured, so text must use the separate text roles', () => {
  const s = source(), onWhite = (role: string) => contrastRatio(resolveToken(s, s.semantic.light[role]), '#ffffff');
  assert.deepEqual(['success', 'warning', 'danger'].map(role => onWhite(role).toFixed(2)), ['3.45', '2.15', '3.76']);
  for (const role of ['success', 'warning', 'danger']) {
    assert.ok(onWhite(role) < 4.5, `${role} as a fill is not safe for text`);
    assert.ok(onWhite(`${role}Text`) >= 4.5, `${role}Text is`);
    assert.notEqual(s.semantic.light[`${role}Text`], s.semantic.light[role], 'fill and text are separate roles');
  }
});

test('P2-14: every declared text and background pair meets its minimum in both themes', () => {
  const s = source(), results = evaluateContrast(s), perTheme = (s.contrast ?? []).reduce((sum, pair) => sum + pair.on.length, 0);
  assert.equal(results.length, perTheme * 2, 'every declared pair is evaluated for light and for dark');
  assert.equal(perTheme, 19, 'six text roles and the focus ring on two backgrounds, plus five component pairs');
  assert.deepEqual(results.filter(r => !r.ok), []);
  assert.deepEqual(new Set(results.map(r => r.theme)), new Set(['light', 'dark']));
});

test('P2-14: every semantic text role is declared on both page backgrounds', () => {
  const s = source(), declared = new Set((s.contrast ?? []).filter(p => p.on.includes('{semantic.background}') && p.on.includes('{semantic.surface}')).map(p => p.text));
  for (const role of ['text', 'textMuted', 'primaryText', 'successText', 'warningText', 'dangerText']) assert.ok(declared.has(`{semantic.${role}}`), `${role} needs a declared pair on background and surface`);
  for (const role of Object.keys(s.semantic.light).filter(r => r.endsWith('Text'))) assert.ok(role in s.semantic.dark, `${role} has a dark value, because a light text color is unreadable on a dark surface`);
});

test('P2-14: the primary color as text in the dark theme is readable (it was 2.4 to 2.7:1)', () => {
  const s = source(), dark = (role: string) => resolveToken(s, s.semantic.dark[role] ?? s.semantic.light[role], 'dark');
  assert.ok(contrastRatio(dark('primaryText'), dark('background')) >= 4.5);
  assert.ok(contrastRatio(dark('primaryText'), dark('surface')) >= 4.5);
  assert.ok(contrastRatio(resolveToken(s, s.semantic.light.primary), dark('background')) < 3, 'the fill color itself is not for dark-theme text');
});

test('P2-14: the generator refuses a source whose pair falls below its minimum', () => {
  const weak = clone(); weak.semantic.light.dangerText = '{primitive.color.red-500}';
  assert.throws(() => validateSource(weak), /Contrast below the minimum: light \{semantic\.dangerText\} on \{semantic\.background\} is 3\.76:1, needs 4\.5:1/);
  const darkWeak = clone(); darkWeak.semantic.dark.primaryText = '{primitive.color.teal-700}';
  assert.throws(() => validateSource(darkWeak), /dark \{semantic\.primaryText\}/);
  const badMin = clone(); badMin.contrast![0].min = 1;
  assert.throws(() => validateSource(badMin), /minimum from 3 to 21/);
  const noBackground = clone(); noBackground.contrast![0].on = [];
  assert.throws(() => validateSource(noBackground), /at least one background/);
  const brokenRef = clone(); brokenRef.contrast![0].text = '{semantic.nope}';
  assert.throws(() => validateSource(brokenRef), /Unknown token reference/);
});

test('P2-14: the generated CSS exposes the text roles for each theme', () => {
  const css = buildThemeCss(source());
  for (const name of ['--color-primary-text', '--color-success-text', '--color-warning-text', '--color-danger-text']) assert.equal(css.split(`${name}:`).length, 3, `${name} is defined for light and overridden for dark`);
});
