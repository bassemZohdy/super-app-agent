import { litellmBase, litellmSettings } from '../litellm-config.ts';
import { z } from 'zod/v4';
import { AgentError } from './contracts.ts';
import { TestIdentity } from './auth.ts';
import { isOpenRouter, requireFreeModel } from './planner.ts';

const Endpoint = z.string().url().transform(raw => {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AgentError('INVALID_ENDPOINT');
  return url;
});
export function config(env: NodeJS.ProcessEnv = process.env) {
  let liteBase: URL | undefined;
  if (env.AGENT_LLM_PROVIDER === 'litellm') {
    try { liteBase = litellmBase(env); } catch { throw new AgentError('LITELLM_ENDPOINT_REQUIRED'); }
    if (env.AGENT_PLANNER !== 'fixture') {
      try { litellmSettings({ ...env, LITELLM_MODEL: env.AGENT_LLM_MODEL || env.LITELLM_MODEL, LITELLM_MAX_TOKENS: env.AGENT_LLM_MAX_TOKENS || env.LITELLM_MAX_TOKENS }); }
      catch (error) { throw new AgentError(error instanceof Error ? error.message : 'LITELLM_CONFIG_REQUIRED'); }
    }
  }
  const input = liteBase ? { ...env, AGENT_LLM_BASE_URL: env.AGENT_LLM_BASE_URL || liteBase.href, AGENT_LLM_MODEL: env.AGENT_LLM_MODEL || env.LITELLM_MODEL || 'glm-5.3', AGENT_LLM_MAX_TOKENS: env.AGENT_LLM_MAX_TOKENS || env.LITELLM_MAX_TOKENS || '512', AGENT_LLM_TIMEOUT_MS: env.AGENT_LLM_TIMEOUT_MS || '45000', AGENT_LLM_RESPONSE_FORMAT: env.AGENT_LLM_RESPONSE_FORMAT || 'prompt' } : env;
  const parsed = z.object({
    AGENT_DB_PATH: z.string().min(1).default('.data/agent.sqlite'),
    AGENT_PORT: z.coerce.number().int().min(0).max(65535).default(4300),
    AGENT_HOST: z.string().default('127.0.0.1'),
    AGENT_WORKLOAD_ID: z.string().min(1).max(80).default('super-app-agent'),
    AGENT_WORKLOAD_KEY: z.string().min(32).max(200),
    AGENT_AUTH: z.enum(['keycloak', 'test']).default('keycloak'),
    AGENT_PLANNER: z.enum(['compatible', 'fixture']).default('compatible'),
    AGENT_SIMULATOR_URL: Endpoint.optional(),
    AGENT_LLM_PROVIDER: z.enum(['compatible', 'openrouter', 'litellm']).optional(),
    AGENT_LLM_BASE_URL: Endpoint.optional(),
    AGENT_LLM_MODEL: z.string().min(1).max(160).optional(),
    AGENT_LLM_KEY: z.string().optional(),
    AGENT_LLM_MAX_TOKENS: z.coerce.number().int().min(64).max(1024).default(200),
    AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(15000),
    AGENT_LLM_RESPONSE_FORMAT: z.enum(['json_object', 'prompt']).default('json_object'),
  }).parse(input);
  // The simulator shares this process: follow the real listening address, never a fixed port that may differ.
  if (!parsed.AGENT_SIMULATOR_URL) {
    if (!parsed.AGENT_PORT) throw new AgentError('SIMULATOR_URL_REQUIRED');
    const host = ['0.0.0.0', '::', '[::]', ''].includes(parsed.AGENT_HOST) ? '127.0.0.1' : parsed.AGENT_HOST;
    parsed.AGENT_SIMULATOR_URL = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${parsed.AGENT_PORT}/`);
  }
  if (parsed.AGENT_PLANNER === 'compatible' && (!parsed.AGENT_LLM_BASE_URL || !parsed.AGENT_LLM_MODEL || !parsed.AGENT_LLM_BASE_URL.pathname.endsWith('/'))) throw new AgentError('LLM_CONFIG_REQUIRED');
  if (parsed.AGENT_PLANNER === 'compatible' && liteBase) {
    if (parsed.AGENT_LLM_BASE_URL?.href !== liteBase.href) throw new AgentError('LITELLM_ENDPOINT_REQUIRED');
    parsed.AGENT_LLM_KEY = env.LITELLM_API_KEY?.trim();
    if (!parsed.AGENT_LLM_KEY) throw new AgentError('LITELLM_KEY_REQUIRED');
  } else if (parsed.AGENT_PLANNER === 'compatible' && parsed.AGENT_LLM_BASE_URL && isOpenRouter(parsed.AGENT_LLM_BASE_URL)) {
    requireFreeModel(parsed.AGENT_LLM_MODEL!);
    parsed.AGENT_LLM_KEY = parsed.AGENT_LLM_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
    if (!parsed.AGENT_LLM_KEY) throw new AgentError('OPENROUTER_KEY_REQUIRED');
  }
  if (env.NODE_ENV === 'production' && (parsed.AGENT_AUTH === 'test' || parsed.AGENT_PLANNER === 'fixture')) throw new AgentError('TEST_ADAPTERS_FORBIDDEN');
  const identities = parsed.AGENT_AUTH === 'test' ? z.array(TestIdentity).min(1).max(20).parse(JSON.parse(env.AGENT_TEST_IDENTITIES || '[]')) : [];
  return { ...parsed, AGENT_SIMULATOR_URL: parsed.AGENT_SIMULATOR_URL, identities };
}
