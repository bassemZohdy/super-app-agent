/** A qualification stack that runs beside the interactive demo stack (P2-09). It is the same Compose file with its own project name
 *  (so its containers, networks and named volumes are separate), every published port shifted by one offset, and generated private
 *  credentials kept in an ignored file. Scripts run against it with every endpoint set explicitly, and nothing here ever stops or
 *  deletes the interactive project. Commands: up | down | status | env | run -- <command…>. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_SECRET_VARIABLES } from './realm-client-secrets.ts';

export const INTERACTIVE_PROJECT = 'cityside-demo';
export const PROJECT = 'cityside-qualify';
export const OFFSET = 30000;
export const STATE_DIR = '.data/qualification';
export const ENV_FILE = `${STATE_DIR}/stack.env`;

/** Host port variable of the Compose file and the port the interactive stack publishes it at. */
export const PORTS: Readonly<Record<string, number>> = {
  PORT_GATEWAY: 4000, PORT_SERVICE_RIDE: 4001, PORT_SERVICE_FOOD: 4002, PORT_SERVICE_WALLET: 4003, PORT_SERVICE_CATALOG: 4004, PORT_SERVICE_PROFILE: 4005, PORT_SERVICE_TELECOM: 4006,
  PORT_BROKER: 4010, PORT_PROVIDER_RTA: 4101, PORT_PROVIDER_DEWA: 4102, PORT_PROVIDER_ETISALAT: 4103, PORT_PROVIDER_DU: 4104, PORT_PROVIDER_POLICE: 4105, PORT_PROVIDER_DLD: 4106,
  PORT_PROVIDER_PAYMENTS: 4107, PORT_REDIS: 6379, PORT_KEYCLOAK: 8085,
};
const PRODUCERS = ['RTA', 'DEWA', 'ETISALAT', 'DU', 'POLICE', 'PAYMENTS'];
/** Credentials the Compose file takes from the environment on both sides of a call, so they can be random per stack: every realm
 *  client secret (the reconcile sets it from the same variable), the operator key, the Keycloak admin password and the payment
 *  event signing keys. */
export const SECRET_VARIABLES = [...new Set(['OPS_API_KEY', 'KEYCLOAK_ADMIN_PASSWORD',
  ...Object.values(CLIENT_SECRET_VARIABLES).map(entry => entry.variable), ...PRODUCERS.map(name => `PAYMENT_EVENT_${name}_KEY`)])];

export const portVariables = (offset = OFFSET) => Object.fromEntries(Object.entries(PORTS).map(([name, port]) => [name, String(port + offset)]));

/** The explicit endpoint environment scripts get. Every variable endpoints.ts reads is set, so nothing falls back to the interactive stack. */
export function endpointEnvironment(offset = OFFSET): Record<string, string> {
  const local = (port: number, host = 'localhost') => `http://${host}:${port + offset}`;
  return {
    DEMO_PORT_OFFSET: String(offset), DEMO_GATEWAY_URL: local(4000), DEMO_KEYCLOAK_ROOT: local(8085), DEMO_KEYCLOAK_URL: `${local(8085)}/realms/superapp`,
    PROVIDER_PAYMENTS_URL: local(4107), DEMO_PROVIDER_DEWA_URL: local(4102), DEMO_TELECOM_SERVICE_URL: local(4006), DELEGATION_AUTHORITY_URL: local(4010, '127.0.0.1'),
    DELEGATION_APP_URL: local(3000), DEMO_REDIS_URL: `redis://127.0.0.1:${6379 + offset}`, DEMO_RIDE_SERVICE_URL: local(4001), DEMO_FOOD_SERVICE_URL: local(4002),
    DEMO_WALLET_SERVICE_URL: local(4003), DEMO_CATALOG_SERVICE_URL: local(4004), DEMO_PROFILE_SERVICE_URL: local(4005),
  };
}

/** Existing values are preserved; only missing ones are generated. Nothing is printed. */
export function ensureEnvironment(path = ENV_FILE, offset = OFFSET, random: (bytes: number) => string = bytes => randomBytes(bytes).toString('hex')): Record<string, string> {
  const values: Record<string, string> = {};
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) { const at = line.indexOf('='); if (at > 0) values[line.slice(0, at)] = line.slice(at + 1); }
  const wanted: Record<string, string> = { COMPOSE_PROJECT_NAME: PROJECT, ...portVariables(offset) };
  for (const name of SECRET_VARIABLES) wanted[name] = values[name] || random(24);
  const merged = { ...values, ...wanted };
  if (JSON.stringify(merged) !== JSON.stringify(values)) {
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path, `${Object.entries(merged).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
  }
  return merged;
}

/** Refuses anything that could touch the interactive stack. */
export function assertIsolated(values: Record<string, string>) {
  if (values.COMPOSE_PROJECT_NAME !== PROJECT) throw new Error(`The qualification stack must use the project ${PROJECT}.`);
  for (const [name, port] of Object.entries(PORTS)) if (Number(values[name]) === port || Number(values[name]) !== port + OFFSET) throw new Error(`${name} must be ${port + OFFSET}, never the interactive port ${port}.`);
}

/** The environment a child process gets: nothing inherited that could point at the interactive stack, every endpoint explicit. */
export function childEnvironment(values: Record<string, string>, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(parent).filter(([name]) => !/^(DEMO_|PROVIDER_|KEYCLOAK_|DELEGATION_|AUTOMATION_|PAYMENT_EVENT_|OPS_|ELIGIBILITY_|COMPOSE_|PORT_)/.test(name)));
  const secrets = Object.fromEntries(SECRET_VARIABLES.map(name => [name, values[name]]));
  return { ...kept, ...secrets, ...endpointEnvironment(), COMPOSE_PROJECT_NAME: PROJECT };
}

const compose = (values: Record<string, string>, ...args: string[]) => spawnSync('docker', ['compose', '--env-file', ENV_FILE, '-p', PROJECT, '-f', 'docker-compose.demo.yml', ...args], { stdio: 'inherit', env: { ...process.env, ...values } });
const npm = (script: string, values: Record<string, string>, extra: Record<string, string> = {}) => spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...childEnvironment(values), ...extra } });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const values = ensureEnvironment();
  assertIsolated(values);
  const done = (status: number | null) => process.exit(status ?? 1);
  if (command === 'up') {
    if (compose(values, 'up', '-d').status !== 0) done(1);
    if (npm('demo:wait', values).status !== 0) done(1);
    // The same step as `npm run demo:delegation:realm`, with the flag in the environment so it also runs where `VAR=x cmd` is not shell syntax.
    done(npm('demo:realm', values, { DELEGATION_ENABLED: 'true' }).status);
  } else if (command === 'down') {
    // Its own project only: the interactive stack and its volumes are never named here.
    done(compose(values, 'down', '-v', '--remove-orphans').status);
  } else if (command === 'status') {
    done(compose(values, 'ps').status);
  } else if (command === 'env') {
    console.log(JSON.stringify({ project: PROJECT, offset: OFFSET, envFile: ENV_FILE, endpoints: endpointEnvironment() }, null, 2));
  } else if (command === 'run') {
    const separator = rest[0] === '--' ? rest.slice(1) : rest;
    if (separator.length === 0) throw new Error('Usage: npm run qualify -- run -- <command…>');
    done(spawnSync(separator[0], separator.slice(1), { stdio: 'inherit', shell: process.platform === 'win32', env: childEnvironment(values) }).status);
  } else {
    console.error('Usage: npm run qualify -- up | down | status | env | run -- <command…>');
    done(2);
  }
}
