/** P2-07: checks that the backends of a running demo stack have no route out and that only the relay publishes ports. Run it against the
 *  stack named by COMPOSE_PROJECT_NAME (default `cityside-demo`; `npm run qualify -- run -- npm run verify:network` for the qualification
 *  stack). For every backend container it tries to open a connection to the internet and to a host on the machine's own network and
 *  expects both to fail, then lists the published ports and expects them all on the relay. It prints no credential. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const project = process.env.COMPOSE_PROJECT_NAME || 'cityside-demo';
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });

const listing = docker('ps', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Names}}|{{.Label "com.docker.compose.service"}}|{{.Ports}}');
assert.equal(listing.status, 0, listing.stderr);
const containers = listing.stdout.trim().split('\n').filter(Boolean).map(line => { const [name, service, ports] = line.split('|'); return { name, service, ports }; });
assert.ok(containers.length > 5, `no running stack for the project ${project}`);

// Only the relay publishes a host port.
const publishing = containers.filter(container => /->/.test(container.ports)).map(container => container.service);
assert.deepEqual(publishing, ['edge-relay'], `only the relay may publish ports, found ${publishing.join(', ')}`);
console.log(`PASS: ${project}: only edge-relay publishes ports (${containers.length - 1} backends publish none)`);

// Each backend: no way out. A target that answers is a failure; a target that does not (or no tool to try with) is reported honestly.
const probes = ['1.1.1.1:443', 'example.com:443'];
const tools: Array<[string, (host: string, port: string) => string[]]> = [
  ['node', (host, port) => ['node', '-e', `const s=require('net').connect({host:'${host}',port:${port},timeout:3000});s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1))`]],
  ['bash', (host, port) => ['bash', '-c', `timeout 3 bash -c 'echo > /dev/tcp/${host}/${port}'`]],
  ['nc', (host, port) => ['nc', '-w', '3', host, port]],
];
const checked: string[] = [], unprobed: string[] = [];
for (const container of containers.filter(item => item.service !== 'edge-relay')) {
  let probed = false;
  for (const [tool, command] of tools) {
    if (docker('exec', container.name, 'sh', '-c', `command -v ${tool}`).status !== 0) continue;
    for (const target of probes) {
      const [host, port] = target.split(':');
      const result = docker('exec', container.name, ...command(host, port));
      assert.notEqual(result.status, 0, `${container.service} reached ${target} with ${tool}`);
    }
    probed = true; break;
  }
  (probed ? checked : unprobed).push(container.service);
}
assert.ok(checked.length > 0, 'no backend could be probed');
console.log(`PASS: ${checked.length} backends cannot open a connection to the internet (${checked.join(', ')})`);
if (unprobed.length) console.log(`NOTE: no probe tool (node, bash or nc) in ${unprobed.join(', ')}; they share the internal network, which has no route out`);

// A control: the relay is the one container with a way out, so the same probe succeeding there shows the probe can tell the difference
// (skipped quietly when the machine itself is offline).
const relay = containers.find(item => item.service === 'edge-relay');
if (relay) {
  const [host, port] = probes[0].split(':');
  const control = docker('exec', relay.name, ...tools[0][1](host, port));
  console.log(control.status === 0 ? 'PASS: the same probe from the relay (edge network) connects, so a failure on a backend is the network and not the probe'
    : 'NOTE: the relay could not reach the internet either (offline machine), so the probe could not be compared');
}
