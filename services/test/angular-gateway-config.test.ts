import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const readShell = (file: string) => readFileSync(join(root, 'apps', 'shell-angular', file), 'utf8');

test('the Angular shell defines its gateway URL in one environment file', () => {
  const environment = readShell('src/environments/environment.ts');
  assert.match(environment, /gatewayUrl:\s*'http:\/\/localhost:4000'/);
});

test('the Angular shell component reads the gateway URL from the environment file', () => {
  const component = readShell('src/app/app.component.ts');
  assert.match(component, /from '\.\.\/environments\/environment\.ts'/);
  assert.match(component, /const GATEWAY_URL = environment\.gatewayUrl;/);
});

test('the Angular shell no longer relies on an unwired NG_APP_ lookup', () => {
  const component = readShell('src/app/app.component.ts');
  assert.doesNotMatch(component, /NG_APP_GATEWAY_URL/);
  assert.doesNotMatch(component, /import\.meta/);
});
