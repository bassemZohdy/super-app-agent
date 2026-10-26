import { z } from 'zod/v4';
import { AgentError } from './contracts.ts';
import { TestIdentity } from './auth.ts';

const Endpoint = z.string().url().transform(raw => {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AgentError('INVALID_ENDPOINT');
  return url;
});
export function config(env: NodeJS.ProcessEnv = process.env) {
  const parsed = z.object({
    AGENT_DB_PATH: z.string().min(1).default('.data/agent.sqlite'),
    AGENT_PORT: z.coerce.number().int().min(0).max(65535).default(4300),
    AGENT_HOST: z.string().default('127.0.0.1'),
    AGENT_WORKLOAD_ID: z.string().min(1).max(80).default('super-app-agent'),
    AGENT_WORKLOAD_KEY: z.string().min(32).max(200),
    AGENT_AUTH: z.enum(['keycloak', 'test']).default('keycloak'),
    AGENT_PLANNER: z.enum(['compatible', 'fixture']).default('compatible'),
    AGENT_SIMULATOR_URL: Endpoint.prefault('http://127.0.0.1:4300/'),
    AGENT_LLM_BASE_URL: Endpoint.optional(),
    AGENT_LLM_MODEL: z.string().min(1).optional(),
    AGENT_LLM_KEY: z.string().optional(),
  }).parse(env);
  if (parsed.AGENT_PLANNER === 'compatible' && (!parsed.AGENT_LLM_BASE_URL || !parsed.AGENT_LLM_MODEL || !parsed.AGENT_LLM_BASE_URL.pathname.endsWith('/'))) throw new AgentError('LLM_CONFIG_REQUIRED');
  if (env.NODE_ENV === 'production' && (parsed.AGENT_AUTH === 'test' || parsed.AGENT_PLANNER === 'fixture')) throw new AgentError('TEST_ADAPTERS_FORBIDDEN');
  const identities = parsed.AGENT_AUTH === 'test' ? z.array(TestIdentity).min(1).max(20).parse(JSON.parse(env.AGENT_TEST_IDENTITIES || '[]')) : [];
  return { ...parsed, identities };
}
