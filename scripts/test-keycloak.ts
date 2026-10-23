/** Isolated real Keycloak check. Requires Docker; never imports the demo realm. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function run() {
  try { execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 15_000 }); }
  catch { throw new Error('Real Keycloak gate requires a running Docker daemon. No tests were executed.'); }
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), 'superapp-keycloak-'));
  await chmod(directory, 0o755); // readable by Keycloak's unprivileged container user
  const container = 'superapp-auth-test-' + randomUUID();
  const secretA = randomUUID(), secretB = randomUUID();
  const issuer = `http://127.0.0.1:${port}/realms/release-test`;
  const client = (clientId: string, secret: string) => ({
    clientId, secret, enabled: true, protocol: 'openid-connect', publicClient: false,
    standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true,
    protocolMappers: [{ name: 'agent-core-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
      config: { 'included.custom.audience': 'agent-core', 'access.token.claim': 'true' } }],
  });
  let started = false;
  try {
    await writeFile(join(directory, 'realm.json'), JSON.stringify({ realm: 'release-test', enabled: true,
      sslRequired: 'none', clients: [client('release-alice', secretA), client('release-bob', secretB)] }));
    execFileSync('docker', ['run', '--detach', '--rm', '--name', container,
      '--publish', `127.0.0.1:${port}:8080`, '--volume', `${directory}:/opt/keycloak/data/import:ro`,
      // Matches the repository's local demo version; not a production version recommendation.
      'quay.io/keycloak/keycloak:24.0.5', 'start-dev', '--import-realm'], { stdio: 'pipe', timeout: 180_000 });
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { ready = (await fetch(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(2000) })).ok; }
      catch { /* server is still starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('Keycloak did not become ready within the integration gate timeout');
    const result = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--test', 'test/integration/keycloak.test.ts'], {
        stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DEMO_AUTH: 'false', KEYCLOAK_ISSUER: issuer,
          KEYCLOAK_AUDIENCE: 'agent-core', KEYCLOAK_JWKS_URL: issuer + '/protocol/openid-connect/certs',
          KEYCLOAK_TEST_SECRET_A: secretA, KEYCLOAK_TEST_SECRET_B: secretB },
      });
      child.once('error', reject); child.once('exit', resolve);
    });
    if (result !== 0) throw new Error('Real Keycloak integration gate failed');
  } finally {
    try {
      if (started) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 20_000 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
