import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

const ROOT = '.claude/skills', SKILLS = ['design-system', 'ui-ux-pro-max'];
const walk = (dir: string, out: string[] = []): string[] => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full, out); else out.push(full.split('\\').join('/')); } return out; };
const files = () => walk(ROOT).filter(path => !path.includes('__pycache__') && !path.includes('.pytest_cache'));
const relative = (path: string) => path.slice(ROOT.length + 1);
// Line endings are read as LF, so a checkout that converts them (git on Windows) hashes the same as one that does not.
const sha = (path: string) => createHash('sha256').update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n')).digest('hex');
const manifest = () => [...readFileSync(`${ROOT}/VENDORED.md`, 'utf8').matchAll(/^\| `([^`]+)` \| (copied|edited) \| `([0-9a-f]{64})` \|$/gm)].map(m => ({ file: m[1], status: m[2], sha: m[3] }));

test('P2-12: the manifest names every vendored file with its exact hash, so a hand edit or a stray file fails', () => {
  const recorded = manifest(), actual = files().map(relative).filter(path => path !== 'VENDORED.md').sort();
  assert.deepEqual(recorded.map(r => r.file).sort(), actual, 'the listed files are exactly the files present');
  for (const entry of recorded) assert.equal(sha(`${ROOT}/${entry.file}`), entry.sha, `${entry.file} differs from its recorded hash; change it together with VENDORED.md`);
  assert.deepEqual(recorded.filter(r => r.status === 'edited').map(r => r.file).sort(), ['design-system/SKILL.md', 'ui-ux-pro-max/SKILL.md', 'ui-ux-pro-max/scripts/core.py'], 'only the documented edits');
});

test('P2-12: each skill loads: front matter names the folder and describes it', () => {
  for (const skill of SKILLS) {
    const text = readFileSync(`${ROOT}/${skill}/SKILL.md`, 'utf8').replaceAll('\r\n', '\n'), block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
    assert.equal(/^name:\s*(.+)$/m.exec(block)?.[1].trim(), skill, `${skill} front matter name`);
    assert.ok((/^description:\s*(.+)$/m.exec(block)?.[1] ?? '').replaceAll('"', '').trim().length > 40, `${skill} has a description`);
  }
});

test('P2-12: the parts the task leaves out are not vendored', () => {
  const present = files().map(relative);
  for (const banned of [/slide/i, /tailwind/i, /shadcn/i, /fetch-background/, /embed-tokens/, /html-token-validator/, /validate_data/, /phosphor-icons-upstream/, /catalog-summary/])
    assert.deepEqual(present.filter(path => path !== 'VENDORED.md' && banned.test(path)), [], String(banned));
  assert.deepEqual(readdirSync(`${ROOT}/ui-ux-pro-max/data/stacks`).sort(), ['angular.csv', 'flutter.csv', 'react.csv']);
});

test('P2-12: every file a SKILL.md points to exists and none points at an omitted script', () => {
  for (const skill of SKILLS) {
    const text = readFileSync(`${ROOT}/${skill}/SKILL.md`, 'utf8');
    const paths = [...text.matchAll(/`(?:\.claude\/skills\/[a-z-]+\/)?((?:references|scripts|templates|data)\/[A-Za-z0-9_.\-/]+\.[a-z]+)`/g)].map(m => m[1]);
    for (const path of paths) assert.ok(existsSync(`${ROOT}/${skill}/${path}`), `${skill}/SKILL.md mentions ${path}, which is not vendored`);
    for (const omitted of ['search-slides', 'slide-token-validator', 'fetch-background', 'tailwind-integration', 'generate-slide', 'embed-tokens', 'html-token-validator', 'validate_data']) assert.equal(text.includes(omitted), false, `${skill}/SKILL.md still mentions ${omitted}`);
  }
});

test('P2-12: no vendored script can reach the network', () => {
  const code = files().filter(path => /\.(py|cjs|js|mjs)$/.test(path));
  assert.ok(code.length >= 6, 'the scripts are scanned');
  const python = /^\s*(?:import|from)\s+(?:urllib|requests|httpx|aiohttp|socket|ssl|http|ftplib|smtplib|telnetlib|xmlrpc|websocket|websockets|paramiko|pycurl)\b|\burlopen\s*\(|\bcurl\b|\bwget\b/m;
  const node = /require\(\s*['"](?:node:)?(?:https?|net|tls|dgram|dns|http2|child_process)['"]\s*\)|\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|from\s+['"](?:node:)?(?:https?|net|tls|dgram|dns|child_process)['"]/;
  for (const path of code) {
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.py')) {
      // The upstream regression test runs the local validator through a subprocess; that is the only process use allowed.
      const subprocessOk = path.includes('/scripts/tests/');
      assert.equal(python.test(text), false, `${path} imports a network module or calls out`);
      if (!subprocessOk) assert.equal(/^\s*(?:import|from)\s+subprocess\b/m.test(text), false, `${path} starts a process`);
    } else assert.equal(node.test(text), false, `${path} uses a network or process module`);
  }
});

test('P2-12: the agent rule is in AGENTS.md and points at the offline skills', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');
  for (const needle of ['.claude/skills/design-system', '.claude/skills/ui-ux-pro-max', '.claude/skills/VENDORED.md', 'npm run check:tokens']) assert.ok(agents.includes(needle), `AGENTS.md mentions ${needle}`);
});

const run = (command: string, args: string[], options: { cwd?: string } = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options,
  // A proxy that goes nowhere makes any attempted request fail fast, so success cannot depend on the network.
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' } });
const pythonAvailable = spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0;

test('P2-12: the search runs offline for each kept stack and domain and refuses an omitted stack', { skip: pythonAvailable ? false : 'Python is not installed here' }, () => {
  const search = (...args: string[]) => run('python', [`${ROOT}/ui-ux-pro-max/scripts/search.py`, ...args]);
  for (const stack of ['react', 'angular', 'flutter']) {
    const result = search('performance', '--stack', stack);
    assert.equal(result.status, 0, `${stack}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`\\*\\*Stack:\\*\\* ${stack} `));
    assert.match(result.stdout, new RegExp(`\\*\\*Source:\\*\\* stacks/${stack}\\.csv`));
    assert.match(result.stdout, /Found:\*\* [1-9]\d* results?/, `${stack} data answers a query`);
  }
  const domain = search('form validation', '--domain', 'ux');
  assert.equal(domain.status, 0);
  assert.match(domain.stdout, /Found:\*\* [1-9]\d* results/);
  const omitted = search('list', '--stack', 'vue');
  assert.notEqual(omitted.status, 0);
  // Python 3.14 omits quotes around argparse choices; both formats enforce the same allowed stacks.
  assert.match(omitted.stderr, /invalid choice: 'vue' \(choose from '?react'?, '?angular'?, '?flutter'?\)/);
  const design = search('civic services wallet payments', '--design-system', '-p', 'Cityside');
  assert.equal(design.status, 0, design.stderr);
  assert.match(design.stdout, /Cityside - RECOMMENDED DESIGN SYSTEM/);
});

test('P2-12: the token scripts run offline: the generator writes variables and the validator flags a hardcoded color', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-skill-'));
  try {
    const out = join(dir, 'tokens.css'), generated = run('node', [`${ROOT}/design-system/scripts/generate-tokens.cjs`, '--config', `${ROOT}/design-system/templates/design-tokens-starter.json`, '-o', out]);
    assert.equal(generated.status, 0, generated.stderr);
    assert.match(readFileSync(out, 'utf8'), /--[a-z0-9-]+:\s*[^;]+;/);
    writeFileSync(join(dir, 'a.css'), '.a { color: #FF6B6B; }\n');
    const validated = run('node', [`${ROOT}/design-system/scripts/validate-tokens.cjs`, '--dir', dir]);
    assert.match(validated.stdout + validated.stderr, /#FF6B6B/i, 'the hardcoded value is reported');
  } finally { removeTemp(dir); }
});

test('P2-12: the vendored validator regression tests pass', { skip: pythonAvailable && spawnSync('python', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0 ? false : 'Python with pytest is not installed here' }, () => {
  const result = run('python', ['-m', 'pytest', `${ROOT}/design-system/scripts/tests`, '-q', '-p', 'no:cacheprovider']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
