/** `npm run simulator:console` starts an isolated payment run and the local scenario console for it (SIM-05).
 *  The operator (the local demo operator, `bassem`) is authenticated here, in this process, exactly as `simulator:issuer` does; the
 *  console page never receives that token. Residents sign in to the printed app address and have no route to the console.
 *  Needs the Compose stack (`npm run demo:up`) for Keycloak. Press Ctrl+C to stop; the run's data is removed with it. */
import { keycloakIssuerUrl } from './endpoints.ts';
import { startEnvironment } from './e2e/environment.ts';
import { verifyJwt } from '../packages/backend-kit/src/jwt.ts';
import { startOperatorConsole } from './operator-console/console.ts';
import { describedFailpoints } from './operator-console/failpoints.ts';
import { providerRunControls, refreshingToken } from './operator-console/provider-controls.ts';

const operator = process.env.SCENARIO_OPERATOR || 'bassem', password = process.env.SCENARIO_OPERATOR_PASSWORD || 'demo123';
process.env.KEYCLOAK_ISSUER = keycloakIssuerUrl;
process.env.KEYCLOAK_JWKS_URL = `${keycloakIssuerUrl}/protocol/openid-connect/certs`;

const token = refreshingToken(async () => {
  const response = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: operator, password }) });
  if (!response.ok) throw new Error(`The operator could not sign in (${response.status}). Is the Compose stack up?`);
  return (await response.json() as { access_token: string }).access_token;
});

const claims = await verifyJwt(`Bearer ${await token()}`, 'provider-api');
const environment = await startEnvironment({ issuerOperatorSub: claims.sub });
if (!environment.issuerRunId) throw new Error('The isolated run did not start.');
const controls = providerRunControls({ base: `http://localhost:${environment.corePort + 107}`, runId: environment.issuerRunId, operator, token });
const console_ = await startOperatorConsole({ controls, failpoints: describedFailpoints() });

console.log(`\nIsolated run ${environment.issuerRunId}\n  Residents (sign in as demo-commuter): ${environment.appUrl}\n  Operator console (open this link once): ${console_.launchUrl}\n\nCtrl+C stops the run and removes its data.`);
const stop = async () => { await console_.close(); await environment.cleanup(); process.exit(0); };
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
