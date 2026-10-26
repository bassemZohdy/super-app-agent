import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { listen, parseRoutes } from '../../scripts/port-relay.ts';

const compose = readFileSync('docker-compose.demo.yml', 'utf8').replaceAll('\r\n', '\n');

test('P2-07: a relay route is a listen port to a plain service name and port, and anything else is refused at start', () => {
  assert.deepEqual(parseRoutes('4000=agent-core:4000, 8080=keycloak:8080'), [{ listen: 4000, host: 'agent-core', port: 4000 }, { listen: 8080, host: 'keycloak', port: 8080 }]);
  for (const bad of ['', '4000=example.com:443', '4000=1.2.3.4:80', '4000=agent-core:4000/path', '4000=agent-core', '0=a:1', '4000=a:70000', 'x=a:1', '4000=http://a:1', '4000=a:1,4000=b:2', '4000=UPPER:1', '4000=a_b:1'])
    assert.throws(() => parseRoutes(bad), /RELAY_ROUTES|Invalid|routed twice/, bad);
});

test('P2-07: the relay forwards bytes to its one fixed destination and nowhere else', async t => {
  const seen: string[] = [];
  const backend = net.createServer(socket => { socket.on('data', data => { seen.push(String(data)); socket.write(`echo:${data}`); }); });
  await new Promise<void>(done => backend.listen(0, '127.0.0.1', done));
  const backendPort = (backend.address() as net.AddressInfo).port;
  // The relay resolves its destination by name, so the fixed destination here is the loopback name of the test backend.
  const probe = net.createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const listenPort = (probe.address() as net.AddressInfo).port; await new Promise<void>(done => probe.close(() => done()));
  const relay = await listen({ listen: listenPort, host: 'localhost', port: backendPort }, 5000, '127.0.0.1');
  t.after(() => { relay.close(); backend.close(); });
  const answer = await new Promise<string>((resolve, reject) => { const client = net.connect(listenPort, '127.0.0.1', () => client.write('hello')); client.once('data', data => { client.destroy(); resolve(String(data)); }); client.once('error', reject); });
  assert.equal(answer, 'echo:hello');
  assert.deepEqual(seen, ['hello']);
});

test('P2-07: in the Compose file the backends are on an internal network and only the relay publishes ports', () => {
  assert.match(compose, /^networks:\n  # [^\n]*\n  default:\n    internal: true\n  edge: \{\}/m, 'the default network has no route out');
  const relay = compose.slice(compose.indexOf('\n  edge-relay:'), compose.indexOf('\nnetworks:'));
  assert.match(relay, /networks: \[default, edge\]/, 'the relay is on both networks');
  assert.ok(relay.includes('RELAY_ROUTES:'));
  const withoutRelay = compose.replace(relay, '');
  assert.doesNotMatch(withoutRelay, /^\s+ports:/m, 'no other service publishes a port');
  for (const service of withoutRelay.matchAll(/^  ([a-z-]+):\n(?:(?!^  [a-z-]+:\n)[\s\S])*?^    networks:/gm)) assert.fail(`${service[1]} must stay on the internal default network`);
});
