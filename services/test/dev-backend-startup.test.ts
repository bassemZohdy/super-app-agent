import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('the local backend rejects duplicate service ports before starting a listener', { timeout: 15000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const url = `http://127.0.0.1:${address.port}`;
  const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/dev-backend.ts'], {
    env: { ...process.env, DEMO_RIDE_SERVICE_URL: url, DEMO_GATEWAY_URL: url, DEMO_AUTH: 'true', PROVIDER_INTEGRATION: 'false', DOMAIN_TRANSPORT: 'local', SESSION_STORE: 'memory' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = ''; child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; }); child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  try {
    const [code] = await once(child, 'close');
    assert.notEqual(code, 0); assert.match(output, /duplicate.*port/i);
    assert.doesNotMatch(output, /listening on|operational and ready/i);
    const probe = createServer(); probe.listen(address.port, '127.0.0.1'); await once(probe, 'listening');
    await new Promise<void>(resolve => probe.close(() => resolve()));
  } finally { if (child.exitCode === null) child.kill(); }
});

test('the ready message follows all six live listeners and stopping releases their ports', { timeout: 25000 }, async () => {
  const reservations = Array.from({ length: 6 }, () => createServer());
  await Promise.all(reservations.map(async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }));
  const ports = reservations.map(server => { const address = server.address(); assert.ok(address && typeof address !== 'string'); return address.port; });
  await Promise.all(reservations.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  const urls = ports.map(port => `http://127.0.0.1:${port}`);
  const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/dev-backend.ts'], {
    env: { ...process.env, DEMO_RIDE_SERVICE_URL: urls[0], DEMO_FOOD_SERVICE_URL: urls[1], DEMO_WALLET_SERVICE_URL: urls[2], DEMO_CATALOG_SERVICE_URL: urls[3], DEMO_PROFILE_SERVICE_URL: urls[4], DEMO_GATEWAY_URL: urls[5], DEMO_AUTH: 'true', PROVIDER_INTEGRATION: 'false', DOMAIN_TRANSPORT: 'local', SESSION_STORE: 'memory', ENABLE_LOCAL_LLM: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = once(child, 'close'); let output = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend did not become ready')), 15000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited before readiness')); });
      child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; if (output.includes('All backend services operational and ready')) { clearTimeout(timer); resolve(); } });
    });
    const responses = await Promise.all(urls.map(url => fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })));
    assert.ok(responses.every(response => response.ok));
  } finally { child.kill(); await closed; }
  const probes = ports.map(() => createServer());
  try { await Promise.all(probes.map(async (server, index) => { server.listen(ports[index], '127.0.0.1'); await once(server, 'listening'); })); }
  finally { await Promise.all(probes.map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
});
