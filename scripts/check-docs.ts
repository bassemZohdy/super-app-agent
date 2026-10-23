import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.md') ? [join(dir, entry.name)] : []);
const files = ['README.md', 'TODO.md', 'SECURITY.md', ...walk('docs')];
const errors: string[] = [];
for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  const target = match[1].split('#')[0];
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
  if (!existsSync(resolve(dirname(file), target))) errors.push(`${file}: missing ${target}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`PASS: local Markdown links in ${files.length} documents.`);
