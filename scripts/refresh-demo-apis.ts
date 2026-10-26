/** Reload source-mounted compatibility APIs without deleting data or starting workers. */
import { spawnSync } from 'node:child_process';

const services = [
  'delegation-broker',
  'provider-rta', 'provider-dewa', 'provider-etisalat', 'provider-du', 'provider-police', 'provider-dld', 'provider-payments',
  'service-ride', 'service-food', 'service-wallet', 'service-catalog', 'service-profile', 'service-telecom',
  'agent-core',
];
const result = spawnSync('docker', ['compose', '-f', 'docker-compose.demo.yml', 'up', '-d', '--no-deps', '--force-recreate', ...services], { stdio: 'inherit' });
if (result.error) { console.error('Could not start Docker Compose. Check that Docker is running.'); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
