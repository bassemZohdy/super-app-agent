import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDart, buildThemeCss, buildTokensJson, resolveToken, validateSource, type Layered } from '../../packages/ui-tokens/src/build.ts';
import { drift, loadSource } from '../../scripts/generate-tokens.ts';
import { BASELINE, collect, compareToBaseline, countRawColors } from '../../scripts/check-raw-colors.ts';

const source = () => loadSource();
const clone = (): Layered => structuredClone(source());

test('P2-13: the layered source is valid and every role and component resolves', () => {
  const s = source();
  validateSource(s);
  assert.equal(resolveToken(s, s.semantic.light.primary), '#285c76');
  assert.equal(resolveToken(s, s.semantic.dark.background, 'dark'), '#090d16');
  assert.equal(resolveToken(s, '{semantic.surface}', 'dark'), '#131b2e', 'a semantic reference follows the theme');
  assert.equal(resolveToken(s, '{semantic.primary}', 'dark'), '#285c76', 'a role with no dark override keeps its light value');
});

test('P2-13: the layers are enforced: semantic and component tokens reference, never repeat, a value', () => {
  const bad = (change: (s: Layered) => void, message: RegExp) => { const s = clone(); change(s); assert.throws(() => validateSource(s), message); };
  bad(s => { s.semantic.light.primary = '#123456'; }, /must reference a primitive/);
  bad(s => { s.semantic.dark.text = '#ffffff'; }, /must reference a primitive/);
  bad(s => { s.component.button.background = '#123456'; }, /must reference a token/);
  bad(s => { s.semantic.light.primary = '{primitive.color.nope}'; }, /Unknown token reference/);
  bad(s => { s.semantic.light.primary = '{primitive.space.small}'; }, /does not resolve to a color/);
  bad(s => { s.primitive.color.white = '#FFF'; }, /lowercase #rrggbb/);
  bad(s => { s.semantic.dark.invented = '{primitive.color.white}'; }, /has no light role/);
  bad(s => { s.component.card.loop = '{component.card.loop}'; }, /Unknown token reference|cycle/);
});

// Every variable and value the shells used before the source existed. Removing or changing one breaks a consumer.
const LEGACY_LIGHT: Record<string, string> = {
  '--color-primary': '#285c76', '--color-primary-hover': '#1e4961', '--color-secondary': '#64748b', '--color-background': '#ffffff', '--color-surface': '#f8fafc',
  '--color-surface-border': '#e2e8f0', '--color-text': '#0f172a', '--color-text-muted': '#64748b', '--color-success': '#4c987d', '--color-warning': '#f59e0b', '--color-danger': '#ef4444',
  '--font-size-xs': '11px', '--font-size-sm': '13px', '--font-size-base': '15px', '--font-size-lg': '18px', '--font-size-xl': '22px', '--font-size-2xl': '28px',
  '--spacing-small': '8px', '--spacing-medium': '16px', '--spacing-large': '24px', '--spacing-xlarge': '32px',
  '--radius-sm': '6px', '--radius-md': '12px', '--radius-lg': '16px', '--radius-full': '9999px',
};
const LEGACY_DARK: Record<string, string> = { '--color-background': '#090d16', '--color-surface': '#131b2e', '--color-surface-border': '#1e293b', '--color-text': '#f8fafc', '--color-text-muted': '#94a3b8' };

const cssBlock = (css: string, selector: string) => Object.fromEntries([...css.slice(css.indexOf(selector)).split('}')[0].matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)].map(m => [m[1], m[2]]));

test('P2-13: every CSS variable the shells already use keeps its name and value', () => {
  const css = buildThemeCss(source()), light = cssBlock(css, ':root'), dark = cssBlock(css, "[data-theme='dark']");
  for (const [name, value] of Object.entries(LEGACY_LIGHT)) assert.equal(light[name], value, name);
  for (const [name, value] of Object.entries(LEGACY_DARK)) assert.equal(dark[name], value, `dark ${name}`);
  const darkText = ['--color-primary-text', '--color-success-text', '--color-warning-text', '--color-danger-text', '--color-focus-ring'];
  assert.deepEqual(Object.keys(dark).sort(), [...Object.keys(LEGACY_DARK), ...darkText].sort(), 'dark overrides only the roles that differ');
  for (const font of ['--font-family-base', '--font-family-mono', '--shadow-sm', '--shadow-md', '--shadow-lg']) assert.ok(light[font], font);
});

test('P2-13: components follow the theme through their semantic role, and primitives are exposed', () => {
  const light = cssBlock(buildThemeCss(source()), ':root');
  assert.equal(light['--button-background'], 'var(--color-primary)');
  assert.equal(light['--card-background'], 'var(--color-surface)', 'a card flips with the dark theme because it references the role');
  assert.equal(light['--input-placeholder'], 'var(--color-text-muted)');
  assert.equal(light['--button-text'], '#ffffff', 'a primitive reference is a fixed value');
  assert.equal(light['--primitive-color-teal-700'], '#285c76');
});

test('P2-13: tokens.json keeps its legacy shape and gains the dark roles and components', () => {
  const json = JSON.parse(buildTokensJson(source()));
  assert.deepEqual(Object.keys(json).slice(0, 6), ['colors', 'typography', 'spacing', 'radii', 'shadows', 'breakpoints']);
  assert.equal(json.colors.primary, '#285c76');
  assert.equal(json.typography.fontFamily.startsWith('Avenir Next, Avenir,'), true);
  assert.deepEqual(json.colorsDark, { background: '#090d16', surface: '#131b2e', surfaceBorder: '#1e293b', text: '#f8fafc', textMuted: '#94a3b8', primaryText: '#7fb4d0', successText: '#7dd3b0', warningText: '#fbbf24', dangerText: '#f87171', focusRing: '#7fb4d0' });
  assert.equal(json.components.button.background, '#285c76');
});

test('P2-13: the Dart constants carry the same colors, spacing and radii (not compiled here: no Dart toolchain)', () => {
  const dart = buildDart(source());
  for (const line of ['static const Color primary = Color(0xFF285C76);', 'static const Color darkBackground = Color(0xFF090D16);', 'static const Color textMuted = Color(0xFF64748B);', 'static const double spaceSmall = 8.0;', 'static const double spaceNone = 0.0;', 'static const double radiusMd = 12.0;'])
    assert.ok(dart.includes(line), line);
  assert.equal(dart.includes('radiusFull'), false, 'the pill radius is not a fixed Flutter size');
  assert.match(dart, /^\/\/ Generated by npm run tokens:generate/);
  assert.match(dart, /abstract final class CitysideTokens \{[\s\S]*\}\n$/);
});

test('P2-13: drift is detected for a changed, missing or hand-edited output and ignores line endings', () => {
  const s = source(), outputs = Object.fromEntries(['packages/ui-tokens/src/theme.css', 'packages/ui-tokens/src/tokens.json', 'apps/shell-flutter/lib/theme/tokens.g.dart'].map(path => [path, readFileSync(path, 'utf8')]));
  assert.deepEqual(drift(s, path => outputs[path]), []);
  assert.deepEqual(drift(s, path => outputs[path].replaceAll('\n', '\r\n')), [], 'CRLF checkouts are not drift');
  assert.deepEqual(drift(s, path => path.endsWith('theme.css') ? outputs[path].replace('#285c76', '#285c77') : outputs[path]), ['packages/ui-tokens/src/theme.css']);
  assert.deepEqual(drift(s, path => path.endsWith('.dart') ? undefined : outputs[path]), ['apps/shell-flutter/lib/theme/tokens.g.dart']);
  const changed = clone(); changed.primitive.color['teal-700'] = '#285c77';
  assert.equal(drift(changed, path => outputs[path]).length, 3, 'a source change that is not regenerated drifts every output that uses it');
});

test('P2-13: the committed outputs match the source', () => {
  assert.deepEqual(drift(source()), []);
});

test('P2-13: the raw-color count sees hex, rgb and hsl in web source and color literals in Flutter, and nothing else', () => {
  const found = countRawColors([
    { path: 'apps/shell-react/src/a.css', text: 'a{color:#abc;background:#112233;border:1px solid rgba(0,0,0,.1);fill:hsl(10 20% 30%);x:rgb( 1,2,3)}' },
    { path: 'apps/shell-react/src/b.tsx', text: 'const x = "#FFFFFF"; const y = "rgba(var(--x))"; const href = "#main-content";' },
    { path: 'apps/shell-angular/src/app/c.ts', text: "style: '#0f172a'" },
    { path: 'apps/shell-flutter/lib/main.dart', text: 'Color(0xFF123456); Colors.white; Colors.transparent; Colors.red.shade50' },
    { path: 'apps/shell-flutter/lib/theme/tokens.g.dart', text: 'static const Color primary = Color(0xFF285C76);' },
    { path: 'apps/shell-react/src/d.png', text: '#123456' },
    { path: 'services/agent-core/src/e.ts', text: '#123456' },
  ]);
  assert.deepEqual(found, { 'apps/shell-angular/src/app/c.ts': 1, 'apps/shell-flutter/lib/main.dart': 3, 'apps/shell-react/src/a.css': 5, 'apps/shell-react/src/b.tsx': 1 });
});

test('P2-13: the ratchet fails on a new raw color and on a baseline that was not lowered', () => {
  const baseline = { 'a.css': 5, 'b.tsx': 2 };
  assert.deepEqual(compareToBaseline({ 'a.css': 5, 'b.tsx': 2 }, baseline), { regressions: [], stale: [] });
  assert.equal(compareToBaseline({ 'a.css': 6, 'b.tsx': 2 }, baseline).regressions.length, 1, 'a file gained a raw color');
  assert.equal(compareToBaseline({ 'a.css': 5, 'b.tsx': 2, 'new.css': 1 }, baseline).regressions.length, 1, 'a new file with a raw color');
  assert.equal(compareToBaseline({ 'a.css': 4, 'b.tsx': 2 }, baseline).stale.length, 1, 'an improvement must lower the baseline');
  assert.equal(compareToBaseline({ 'b.tsx': 2 }, baseline).stale.length, 1, 'a migrated file must leave the baseline');
});

test('P2-13: the shells stay within the committed raw-color baseline', () => {
  const verdict = compareToBaseline(countRawColors(collect()), JSON.parse(readFileSync(BASELINE, 'utf8')));
  assert.deepEqual(verdict, { regressions: [], stale: [] });
});
