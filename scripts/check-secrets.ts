import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean));
const findings: string[] = [];
for (const file of files) {
  if (!existsSync(file) || !/\.(?:[cm]?[jt]sx?|json|md|ya?ml|html|css|example)$/.test(file) || !statSync(file).isFile() || statSync(file).size > 2000000) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/sk-or-v1-[a-z\d]{30,}/i.test(line) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) findings.push(`${file}:${index + 1}`);
  });
}
if (findings.length) { console.error(`Possible secret material at ${findings.join(', ')} (values redacted).`); process.exitCode = 1; }
else console.log('PASS: no OpenRouter key or private-key literals in repository source/docs.');
