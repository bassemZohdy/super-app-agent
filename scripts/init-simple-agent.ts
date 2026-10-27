import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Local synthetic identity only; no real account or payment credentials.
const token = randomBytes(32).toString('hex');
const openRouter = process.argv.includes('--openrouter');
const renewalDemo = process.argv.includes('--renewal-demo');
const renewalIdentity = () => ({ token: randomBytes(32).toString('hex'), subject: 'demo-renewal-resident', permissions: ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'], expiresAt: Date.now() + 7 * 86400000 });
if (renewalDemo && existsSync('.env.agent')) {
  try {
    const contents = readFileSync('.env.agent', 'utf8'), current = parseEnv(contents);
    if (current.AGENT_AUTH !== 'test') throw new Error();
    const identities: unknown = JSON.parse(current.AGENT_TEST_IDENTITIES || '[]');
    if (!Array.isArray(identities) || identities.length < 1 || identities.length >= 20) throw new Error();
    if (identities.some(item => item?.subject === 'demo-renewal-resident')) console.log('Existing renewal demo persona preserved.');
    else {
      const value = JSON.stringify([...identities, renewalIdentity()]); if (value.includes("'")) throw new Error();
      const line = `AGENT_TEST_IDENTITIES='${value}'`;
      writeFileSync('.env.agent', contents.replace(/^AGENT_TEST_IDENTITIES=.*$/m, line), { mode: 0o600 });
      console.log('Added a separate local renewal demo persona. Existing identities, scopes, planner and keys were preserved. Its token remains in private .env.agent.');
    }
  } catch { console.error('Could not enroll the local renewal demo persona. Existing configuration was not replaced.'); process.exitCode = 1; }
} else {
const settings = {
  AGENT_AUTH: 'test', AGENT_PLANNER: 'fixture',
  ...(openRouter ? { AGENT_PLANNER: 'compatible', AGENT_LLM_BASE_URL: 'https://openrouter.ai/api/v1/', AGENT_LLM_MODEL: 'openrouter/free' } : {}),
  AGENT_HOST: '127.0.0.1', AGENT_PORT: '4300',
  AGENT_DB_PATH: '.data/agent.sqlite', AGENT_SIMULATOR_URL: 'http://127.0.0.1:4300/',
  AGENT_WORKLOAD_KEY: randomBytes(32).toString('hex'),
  AGENT_TEST_IDENTITIES: JSON.stringify([{ token, subject: 'demo-resident', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 7 * 86400000 }, ...(renewalDemo ? [renewalIdentity()] : [])]),
};
try {
  writeFileSync('.env.agent', Object.entries(settings).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Created private local demo configuration${openRouter ? ' with the free OpenRouter planner; export OPENROUTER_API_KEY before starting' : ' with the deterministic fixture planner'}. Run npm start, then npm run agent:client. Test identity expires in seven days.`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') console.log('Existing .env.agent preserved. Remove it explicitly to generate fresh local test credentials.');
  else { console.error('Could not create local demo configuration.'); process.exitCode = 1; }
}
}
