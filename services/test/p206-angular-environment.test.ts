import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_GATEWAY_URL, gatewayOrigin, renderEnvironment } from '../../scripts/angular-environment.ts';

test('P2-06: the Angular gateway comes from SHELL_GATEWAY_URL, defaults to the committed value and accepts only an origin', () => {
  assert.equal(gatewayOrigin(undefined), DEFAULT_GATEWAY_URL);
  assert.equal(gatewayOrigin('  '), DEFAULT_GATEWAY_URL);
  assert.equal(gatewayOrigin('https://gateway.example.test:8443'), 'https://gateway.example.test:8443');
  assert.equal(gatewayOrigin('http://localhost:4010/'), 'http://localhost:4010');
  for (const bad of ['gateway', 'ftp://gateway.test', 'https://user:secret@gateway.test', 'https://gateway.test/api', 'https://gateway.test/?x=1', 'https://gateway.test/#frag', 'javascript:alert(1)']) {
    assert.throws(() => gatewayOrigin(bad), /SHELL_GATEWAY_URL/, bad);
  }
});

test('P2-06: with the variable unset the generated file is exactly the committed one, so a plain build changes nothing', () => {
  const committed = readFileSync('apps/shell-angular/src/environments/environment.ts', 'utf8').replaceAll('\r\n', '\n');
  assert.equal(renderEnvironment(gatewayOrigin(undefined)), committed);
  assert.match(renderEnvironment('https://gw.test'), /gatewayUrl: 'https:\/\/gw\.test',/);
});

test('P2-06: the Angular build runs the generator first', () => {
  const manifest = JSON.parse(readFileSync('apps/shell-angular/package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.match(manifest.scripts.build, /angular-environment\.ts.*&&.*ng build/);
});
