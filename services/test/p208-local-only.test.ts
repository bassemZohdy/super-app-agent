import test from 'node:test';
import assert from 'node:assert/strict';
import { findViolations, type SourceFile } from '../../scripts/check-local-only.ts';

const manifest = (body: Record<string, unknown>): SourceFile => ({ path: 'services/demo/package.json', text: JSON.stringify(body, null, 2) });
const rules = (files: SourceFile[]) => findViolations(files).map(f => f.rule);

test('P2-08: a clean tree passes', () => {
  const clean: SourceFile[] = [
    manifest({ dependencies: { ajv: '^8.0.0', react: '^18.0.0', '@langchain/core': '^0.3.0' }, scripts: { build: 'tsc', test: 'node --test', 'docker:up': 'docker compose up' } }),
    { path: '.env.example', text: 'KEYCLOAK_URL=http://localhost:8080\nDEMO_SECRET=demo123\n' },
    { path: 'package-lock.json', text: '{"packages":{"node_modules/ajv":{"resolved":"https://registry.npmjs.org/ajv/-/ajv-8.0.0.tgz"}}}' },
    { path: 'apps/shell-react/dist/assets/index.js', text: 'fetch("http://localhost:3000/api"); /* local only */' },
  ];
  assert.deepEqual(findViolations(clean), []);
});

test('P2-08: hosted-SDK dependencies fail in every dependency group', () => {
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of ['firebase', '@aws-sdk/client-s3', '@sentry/node', 'stripe', 'openai', '@anthropic-ai/sdk', '@langchain/openai', '@vercel/analytics']) {
      const found = findViolations([manifest({ [group]: { [name]: '1.0.0' } })]);
      assert.deepEqual(found.map(f => f.rule), ['HOSTED_SDK'], `${group}:${name}`);
      assert.match(found[0].detail, new RegExp(name.replace(/[/@]/g, '.')));
    }
  }
});

test('P2-08: deploy and publish commands in scripts fail, local commands do not', () => {
  for (const command of ['vercel --prod', 'netlify deploy', 'firebase deploy --only hosting', 'wrangler deploy', 'aws s3 sync dist s3://b', 'gcloud run deploy', 'docker push img', 'npm publish', 'terraform apply'])
    assert.deepEqual(rules([manifest({ scripts: { ship: command } })]), ['DEPLOY_COMMAND'], command);
  for (const command of ['docker compose up -d', 'node scripts/x.ts', 'tsc -b', 'vite build', 'playwright test'])
    assert.deepEqual(rules([manifest({ scripts: { ok: command } })]), [], command);
});

test('P2-08: hosting linkage files fail', () => {
  for (const path of ['vercel.json', 'netlify.toml', 'firebase.json', '.firebaserc', 'wrangler.toml', 'fly.toml', 'apps/web/.vercel/project.json', 'apps/web/.netlify/state.json', 'serverless.yml', 'Procfile'])
    assert.deepEqual(rules([{ path, text: '' }]), ['LINKAGE_FILE'], path);
});

test('P2-08: cloud keys in env files and lockfiles fail and the value never appears in the finding', () => {
  const secrets = ['AKIA' + 'ABCDEFGHIJKLMNOP', 'AIza' + 'SyA-abcdefghijklmnopqrstuvwxyz01234', 'sk_live_' + 'abcdefghijklmnop', 'ghp_' + 'a'.repeat(36), 'sk-ant-' + 'abcdefghij1234567890'];
  for (const path of ['.env', '.env.local', 'apps/web/.env.production', 'package-lock.json', 'yarn.lock']) {
    for (const secret of secrets) {
      const found = findViolations([{ path, text: `A=1\nCLOUD=${secret}\n` }]);
      assert.deepEqual(found.map(f => [f.rule, f.line]), [['CLOUD_KEY', 2]], `${path}`);
      assert.equal(JSON.stringify(found).includes(secret), false, 'findings never echo the value');
    }
  }
  assert.deepEqual(rules([{ path: 'docs/notes.md', text: 'AKIA' + 'ABCDEFGHIJKLMNOP' }]), [], 'only env files and lockfiles are in this rule');
});

test('P2-08: lockfile sources that carry credentials fail', () => {
  assert.deepEqual(rules([{ path: 'package-lock.json', text: '"resolved": "https://user:pw@registry.example.com/x.tgz"' }]), ['LOCKFILE_SOURCE']);
  assert.deepEqual(rules([{ path: 'package-lock.json', text: '"resolved": "https://registry.example.com/x.tgz?token=abc"' }]), ['LOCKFILE_SOURCE']);
});

test('P2-08: built bundles that load a CDN or remote font fail, source files that only mention one do not', () => {
  for (const host of ['fonts.googleapis.com/css2', 'fonts.gstatic.com/s/x', 'cdn.jsdelivr.net/npm/x', 'unpkg.com/x', 'cdnjs.cloudflare.com/ajax', 'use.typekit.net/abc.css'])
    assert.deepEqual(rules([{ path: 'apps/shell-react/dist/index.html', text: `<link href="https://${host}">` }]), ['REMOTE_ASSET'], host);
  assert.deepEqual(rules([{ path: 'apps/shell-angular/dist/browser/main.js', text: 'a\nb\nimport("https://unpkg.com/x")' }]).length, 1);
  assert.deepEqual(rules([{ path: 'docs/guide.md', text: 'see https://fonts.googleapis.com' }]), []);
  assert.deepEqual(rules([{ path: 'apps/shell-react/src/main.ts', text: 'https://cdn.jsdelivr.net' }]), []);
});

test('P2-08: Windows paths and CRLF text are handled and report the right line', () => {
  const found = findViolations([{ path: 'apps\\shell-react\\dist\\index.html', text: 'ok\r\n<link href="https://fonts.googleapis.com/x">\r\n' }]);
  assert.deepEqual(found.map(f => [f.file, f.line, f.rule]), [['apps/shell-react/dist/index.html', 2, 'REMOTE_ASSET']]);
});
