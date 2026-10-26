import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFSET, PORTS, PROJECT, INTERACTIVE_PROJECT, SECRET_VARIABLES, assertIsolated, childEnvironment, endpointEnvironment, ensureEnvironment, portVariables } from '../../scripts/qualification-stack.ts';
import { portOffset } from '../../scripts/endpoints.ts';
import { removeTemp } from '../../test/support/temp-cleanup.ts';

const compose = readFileSync('docker-compose.demo.yml', 'utf8');

test('P2-09: every published port in the Compose file is a variable whose default is the interactive port', () => {
  const published = [...compose.matchAll(/^\s+- '127\.0\.0\.1:\$\{(PORT_[A-Z_]+):-(\d+)\}:\d+'$/gm)].map(match => [match[1], Number(match[2])] as const);
  assert.deepEqual(Object.fromEntries(published), PORTS, 'the launcher knows exactly the ports the Compose file publishes');
  assert.doesNotMatch(compose, /^\s+- '(127\.0\.0\.1:)?\d+:\d+'$/m, 'no port is published at a fixed host number');
  assert.match(compose, /^name: \$\{COMPOSE_PROJECT_NAME:-cityside-demo\}/m);
  assert.equal(compose.match(/localhost:8085/g)?.length ?? 0, 0, 'the Keycloak public address follows its port variable');
});

test('P2-09: the qualification project, ports and credentials never equal the interactive ones', () => {
  assert.notEqual(PROJECT, INTERACTIVE_PROJECT);
  const shifted = portVariables();
  for (const [name, port] of Object.entries(PORTS)) assert.equal(Number(shifted[name]), port + OFFSET);
  const scratch = mkdtempSync(join(tmpdir(), 'p209-'));
  try {
    const path = join(scratch, 'q', 'stack.env');
    let counter = 0;
    const first = ensureEnvironment(path, OFFSET, () => `secret${++counter}`.padEnd(48, 'x'));
    assertIsolated(first);
    for (const name of SECRET_VARIABLES) assert.ok(first[name].length >= 32, `${name} is long enough`);
    assert.equal(new Set(SECRET_VARIABLES.map(name => first[name])).size, SECRET_VARIABLES.length, 'every credential is different');
    const second = ensureEnvironment(path, OFFSET, () => { throw new Error('a preserved credential must not be regenerated'); });
    assert.deepEqual(second, first, 'credentials are generated once and preserved');
    assert.throws(() => assertIsolated({ ...first, COMPOSE_PROJECT_NAME: INTERACTIVE_PROJECT }), /project/);
    assert.throws(() => assertIsolated({ ...first, PORT_GATEWAY: '4000' }), /PORT_GATEWAY/);
    assert.throws(() => assertIsolated({ ...first, PORT_KEYCLOAK: '8085' }), /PORT_KEYCLOAK/);
  } finally { removeTemp(scratch); }
});

test('P2-09: a script run against the qualification stack inherits no interactive endpoint or credential', () => {
  const values = Object.fromEntries([['COMPOSE_PROJECT_NAME', PROJECT], ...SECRET_VARIABLES.map(name => [name, `${name}-value`])]);
  const child = childEnvironment(values, { PATH: '/bin', DEMO_GATEWAY_URL: 'http://localhost:4000', PROVIDER_PAYMENTS_URL: 'http://localhost:4107', KEYCLOAK_ISSUER: 'http://localhost:8085/realms/superapp',
    OPS_API_KEY: 'interactive-key', COMPOSE_PROJECT_NAME: INTERACTIVE_PROJECT, PORT_GATEWAY: '4000', HOME: '/home/x' });
  assert.equal(child.PATH, '/bin');
  assert.equal(child.HOME, '/home/x');
  assert.equal(child.COMPOSE_PROJECT_NAME, PROJECT);
  assert.equal(child.OPS_API_KEY, 'OPS_API_KEY-value', 'the stack\'s own credential replaces the inherited one');
  assert.equal(child.PORT_GATEWAY, undefined);
  assert.equal(child.KEYCLOAK_ISSUER, undefined);
  for (const [name, value] of Object.entries(endpointEnvironment())) assert.equal(child[name], value, `${name} is explicit`);
  assert.equal(child.DEMO_GATEWAY_URL, 'http://localhost:34000');
  assert.equal(child.DEMO_KEYCLOAK_URL, 'http://localhost:38085/realms/superapp');
  assert.equal(child.DEMO_REDIS_URL, 'redis://127.0.0.1:36379');
});

test('P2-09: DEMO_PORT_OFFSET is a whole number in range, and 0 or unset is the interactive stack', () => {
  assert.equal(portOffset(undefined), 0);
  assert.equal(portOffset(''), 0);
  assert.equal(portOffset('10000'), 10000);
  for (const bad of ['-1', '1.5', 'abc', '60000']) assert.throws(() => portOffset(bad), /DEMO_PORT_OFFSET/, bad);
});

test('P2-09: the qualification ports stay clear of the in-process browser journeys and of ephemeral ports', () => {
  const lowest = Math.min(...Object.values(portVariables()).map(Number)), highest = Math.max(...Object.values(portVariables()).map(Number));
  assert.ok(lowest > 14000 + 200, 'above the E2E_CORE_PORT range (14000 plus its provider offsets)');
  assert.ok(highest < 49152, 'below the dynamic port range');
});
