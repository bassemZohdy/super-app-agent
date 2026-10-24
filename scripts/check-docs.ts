import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.md') ? [join(dir, entry.name)] : []);
const files = ['README.md', 'TODO.md', 'SECURITY.md', 'services/voice/THIRD_PARTY.md', ...walk('docs')];
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
const errors: string[] = [];
const contents = new Map(files.map(file => [resolve(file), readFileSync(file, 'utf8')]));

/** Code examples can contain illustrative links/headings; those do not create Markdown anchors. */
function withoutFences(source: string): string {
  let fence: { mark: string; length: number } | undefined;
  return source.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence = { mark: marker[0], length: marker.length }; return ''; }
    if (marker && fence && marker[0] === fence.mark && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) { fence = undefined; return ''; }
    return fence ? '' : line;
  }).join('\n');
}
const anchors = new Map<string, Set<string>>();
function markdownAnchors(file: string): Set<string> {
  if (anchors.has(file)) return anchors.get(file)!;
  const source = withoutFences(contents.get(file) ?? readFileSync(file, 'utf8'));
  const found = new Set<string>(), counts = new Map<string, number>();
  for (const match of source.matchAll(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm)) {
    const slug = match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    found.add(count ? `${slug}-${count}` : slug); counts.set(slug, count + 1);
  }
  for (const match of source.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) found.add(match[1]);
  anchors.set(file, found); return found;
}

for (const file of files) {
  const source = contents.get(resolve(file))!;
  for (const match of withoutFences(source).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].trim();
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    const hash = href.indexOf('#'), rawPath = hash < 0 ? href : href.slice(0, hash);
    let target: string, fragment: string;
    try { target = rawPath ? resolve(dirname(file), decodeURIComponent(rawPath)) : resolve(file); fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1)); }
    catch { errors.push(`${file}: invalid local link ${href}`); continue; }
    if (!existsSync(target)) { errors.push(`${file}: missing ${rawPath}`); continue; }
    if (fragment && extname(target) === '.md' && statSync(target).isFile() && !markdownAnchors(target).has(fragment)) errors.push(`${file}: missing section ${href}`);
  }
  // Historical evidence/design baselines keep their original commands; current guides must run today.
  const historical = /^docs\/(?:reports|history|recordings)\//.test(file) || file === 'docs/CHANGELOG.md' || file === 'docs/architecture/secure-identity-delegation.md';
  if (!historical) for (const match of source.matchAll(/\bnpm run ([\w:-]+)/g)) if (!Object.hasOwn(scripts, match[1])) errors.push(`${file}: unknown npm script ${match[1]}`);
}

const todo = readFileSync('TODO.md', 'utf8'), ids = new Set<string>();
const groups = new Map<string, { total: number; checked: number }>();
for (const match of todo.matchAll(/^- \[([ x])\] \*\*(([A-Z][A-Z0-9]*)-\d+)\b/gm)) {
  if (ids.has(match[2])) errors.push(`TODO.md: duplicate task ${match[2]}`);
  ids.add(match[2]); const group = groups.get(match[3]) ?? { total: 0, checked: 0 };
  group.total++; if (match[1] === 'x') group.checked++; groups.set(match[3], group);
}
const status = readFileSync('docs/STATUS.md', 'utf8'), documented = new Set<string>();
for (const match of status.matchAll(/^\| (P0|P1|P2|OBO|PAY|AUTO|SIM|QA)\b[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm)) {
  const group = groups.get(match[1]); documented.add(match[1]);
  if (!group || group.total !== Number(match[2]) || group.checked !== Number(match[3]) || group.total - group.checked !== Number(match[4])) errors.push(`docs/STATUS.md: ${match[1]} counts disagree with TODO.md`);
}
for (const group of groups.keys()) if (!documented.has(group)) errors.push(`docs/STATUS.md: missing task group ${group}`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${files.length} Markdown documents; local paths/sections, current npm commands and ${ids.size} unique task IDs/status counts.`);
