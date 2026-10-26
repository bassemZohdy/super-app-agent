/** Free-only, local-only policy gate (P2-08). The demo adds no hosted SDK, deploy command, cloud key or remote asset.
 *  `findViolations` is pure so the fixture tests can show each rule fails; the CLI feeds it the tracked manifests,
 *  env files and lockfiles plus any built bundles that exist. Findings name the rule, file and line, never the value. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SourceFile = { path: string; text: string };
export type Finding = { file: string; line: number; rule: 'HOSTED_SDK' | 'DEPLOY_COMMAND' | 'LINKAGE_FILE' | 'CLOUD_KEY' | 'LOCKFILE_SOURCE' | 'REMOTE_ASSET'; detail: string };

const HOSTED_SDK = /^(?:firebase(?:-admin|-tools)?|@firebase\/.+|aws-sdk|aws-amplify|@aws-sdk\/.+|@aws-amplify\/.+|@azure\/.+|@google-cloud\/.+|@supabase\/.+|@vercel\/.+|@netlify\/.+|@sentry\/.+|stripe|@stripe\/.+|twilio|@clerk\/.+|auth0|@auth0\/.+|@okta\/.+|posthog-(?:js|node)|mixpanel(?:-browser)?|@segment\/.+|openai|@anthropic-ai\/sdk|@google\/(?:generative-ai|genai)|cohere-ai|@mistralai\/mistralai|replicate|@pinecone-database\/.+|@langchain\/(?:openai|anthropic|google-.+|aws|cohere|mistralai|azure-openai))$/;
const DEPLOY_COMMAND = /\b(?:vercel|netlify|firebase\s+deploy|wrangler\s+(?:deploy|publish)|gcloud|aws\s+[a-z][a-z0-9-]*|az\s+(?:webapp|login|acr|containerapp)|flyctl|fly\s+deploy|heroku|serverless\s+deploy|sls\s+deploy|terraform\s+apply|pulumi\s+up|cdk\s+deploy|kubectl\s+apply|docker\s+push|npm\s+publish|gh-pages)\b/;
const LINKAGE_FILE = /(?:^|\/)(?:vercel\.json|netlify\.toml|firebase\.json|\.firebaserc|wrangler\.toml|fly\.toml|serverless\.ya?ml|amplify\.yml|Procfile)$|(?:^|\/)\.(?:vercel|netlify)\//;
const CLOUD_KEYS: readonly [string, RegExp][] = [
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/], ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/], ['Stripe live key', /\b[sr]k_live_[0-9A-Za-z]{10,}/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/], ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/], ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{10,}/],
  ['OpenRouter key', /\bsk-or-v1-[a-z\d]{30,}/i], ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
];
const REMOTE_ASSET = /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|code\.jquery\.com|use\.typekit\.net|kit\.fontawesome\.com|(?:stackpath|maxcdn)\.bootstrapcdn\.com)\b/;
const isEnv = (p: string) => /(?:^|\/)\.env(?:\.[^/]*)?$/.test(p);
const isLockfile = (p: string) => /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(p);
const isBundle = (p: string) => /(?:^|\/)(?:dist|build)\/.*\.(?:[cm]?js|css|html)$/.test(p);

export function findViolations(files: readonly SourceFile[]): Finding[] {
  const out: Finding[] = [];
  const add = (file: string, line: number, rule: Finding['rule'], detail: string) => out.push({ file, line, rule, detail });
  for (const { path: raw, text } of files) {
    const path = raw.replaceAll('\\', '/'), lines = text.replaceAll('\r\n', '\n').split('\n');
    if (LINKAGE_FILE.test(path)) add(path, 1, 'LINKAGE_FILE', 'hosting or deployment linkage file');
    if (/(?:^|\/)package\.json$/.test(path)) {
      let manifest: { scripts?: Record<string, string>; [k: string]: unknown } | undefined;
      try { manifest = JSON.parse(text); } catch { /* a malformed manifest is another gate's finding */ }
      const lineOf = (needle: string) => Math.max(1, lines.findIndex(l => l.includes(`"${needle}"`)) + 1);
      for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
        for (const name of Object.keys((manifest?.[group] as Record<string, string>) || {})) if (HOSTED_SDK.test(name)) add(path, lineOf(name), 'HOSTED_SDK', `hosted SDK dependency ${name}`);
      for (const [name, command] of Object.entries(manifest?.scripts || {})) if (DEPLOY_COMMAND.test(command)) add(path, lineOf(name), 'DEPLOY_COMMAND', `script ${name} runs a deploy or publish command`);
    }
    if (isEnv(path) || isLockfile(path)) lines.forEach((text, i) => { for (const [label, pattern] of CLOUD_KEYS) if (pattern.test(text)) add(path, i + 1, 'CLOUD_KEY', `${label} literal`); });
    if (isLockfile(path)) lines.forEach((text, i) => { if (/"resolved":\s*"https?:\/\/[^"/@]+@|_authToken|[?&](?:token|auth)=/.test(text)) add(path, i + 1, 'LOCKFILE_SOURCE', 'lockfile source carries credentials'); });
    if (isBundle(path)) lines.forEach((text, i) => { if (REMOTE_ASSET.test(text)) add(path, i + 1, 'REMOTE_ASSET', 'built bundle loads a CDN or remote font'); });
  }
  return out;
}

const BUNDLE_ROOTS = ['apps', 'mini-apps', 'packages', 'services'];
function bundleFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, inBundle: boolean) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(dir, name), info = statSync(full);
      if (info.isDirectory()) walk(full, inBundle || name === 'dist' || name === 'build');
      else if (inBundle && /\.(?:[cm]?js|css|html)$/.test(name) && info.size <= 5_000_000) found.push(full);
    }
  };
  if (existsSync(root)) walk(root, false);
  return found;
}

export function collectSources(): SourceFile[] {
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const wanted = tracked.filter(p => existsSync(p) && (/(?:^|\/)package\.json$/.test(p) || isEnv(p) || isLockfile(p) || LINKAGE_FILE.test(p)));
  const bundles = BUNDLE_ROOTS.flatMap(bundleFiles);
  return [...new Set([...wanted, ...bundles])].map(path => ({ path, text: LINKAGE_FILE.test(path.replaceAll('\\', '/')) ? '' : readFileSync(path, 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = findViolations(collectSources());
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line} ${f.rule}: ${f.detail}`);
    console.error(`Local-only policy: ${findings.length} violation(s) (values redacted).`);
    process.exitCode = 1;
  } else console.log('PASS: no hosted SDK, deploy command, linkage file, cloud key or remote bundle asset.');
}
