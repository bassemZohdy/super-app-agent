import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// Local synthetic identity only; no real account or payment credentials.
const token = randomBytes(32).toString('hex');
const settings = {
  AGENT_AUTH: 'test', AGENT_PLANNER: 'fixture',
  AGENT_HOST: '127.0.0.1', AGENT_PORT: '4300',
  AGENT_DB_PATH: '.data/agent.sqlite', AGENT_SIMULATOR_URL: 'http://127.0.0.1:4300/',
  AGENT_WORKLOAD_KEY: randomBytes(32).toString('hex'),
  AGENT_TEST_IDENTITIES: JSON.stringify([{ token, subject: 'demo-resident', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 7 * 86400000 }]),
};
try {
  writeFileSync('.env.agent', Object.entries(settings).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Created private local demo configuration. Run npm start, then npm run agent:client. Test identity expires in seven days.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') console.log('Existing .env.agent preserved. Remove it explicitly to generate fresh local test credentials.');
  else { console.error('Could not create local demo configuration.'); process.exitCode = 1; }
}
