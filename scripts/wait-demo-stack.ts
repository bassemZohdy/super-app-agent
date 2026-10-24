/** Wait for local demo endpoints; never print credentials or response bodies. */
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.DEMO_HOST || 'localhost';
const issuer = process.env.DEMO_KEYCLOAK_URL || `http://${host}:8085/realms/superapp`;
const checks = new Map<string, { url: string; accept: (data: any) => boolean }>([
  ['Delegation broker', { url: `http://${host}:4010/health`, accept: data => data.status === 'ok' && data.service === 'delegation-broker' }],
  ['Keycloak realm', { url: `${issuer}/.well-known/openid-configuration`,
    accept: data => data.issuer === issuer && typeof data.token_endpoint === 'string' }],
  ['Concierge', { url: `${process.env.DEMO_GATEWAY_URL || `http://${host}:4000`}/health`,
    accept: data => data.status === 'ok' && data.integration === 'rest-providers' && data.sessions?.store === 'redis' }],
]);
for (const [index, service] of ['ride', 'food', 'wallet', 'catalog', 'profile', 'telecom'].entries()) {
  checks.set(`Application ${service}`, { url: `http://${host}:${4001 + index}/health`,
    accept: data => data.status === 'ok' && data.service === `service-${service}` && data.integration === 'rest-providers' });
}
for (const [index, provider] of ['rta', 'dewa', 'etisalat', 'du', 'police', 'dld', 'payments'].entries()) {
  checks.set(`Provider ${provider}`, { url: `http://${host}:${4101 + index}/health`,
    accept: data => data.status === 'ok' && data.provider === provider && data.storage === 'sqlite' });
}

const timeout = Number(process.env.DEMO_READY_TIMEOUT_MS || 180000);
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) {
  throw new Error('DEMO_READY_TIMEOUT_MS must be between 1000 and 600000.');
}
const deadline = Date.now() + timeout;
console.log('Waiting for the Keycloak realm and integrated demo APIs…');
while (checks.size && Date.now() < deadline) {
  await Promise.all([...checks].map(async ([name, check]) => {
    try {
      const response = await fetch(check.url, { signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))) });
      if (response.ok && check.accept(await response.json())) {
        checks.delete(name);
        console.log(`Ready: ${name}`);
      }
    } catch { /* A starting container may reset connections before it listens. */ }
  }));
  if (checks.size) await delay(Math.min(1000, Math.max(0, deadline - Date.now())));
}
if (checks.size) {
  console.error(`Demo startup timed out waiting for: ${[...checks.keys()].join(', ')}. Inspect npm run demo:logs.`);
  process.exitCode = 1;
} else {
  console.log('Demo endpoints are ready. Run npm run demo:verify to check authenticated flows and Redis.');
}
