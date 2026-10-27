/** Deployment-only configuration shared by chat, planning and the fixed TLS relay. */
export function litellmBase(env: NodeJS.ProcessEnv = process.env): URL {
  try {
    const raw = env.LITELLM_BASE_URL?.trim() || env.LITELLM_URL?.trim();
    if (!raw) throw new Error();
    const base = new URL(raw.endsWith('/') ? raw : `${raw}/`);
    const local = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'litellm'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) || base.username || base.password || base.search || base.hash || base.port === '0') throw new Error();
    return base;
  } catch { throw new Error('LITELLM_ENDPOINT_REQUIRED'); }
}
export function litellmSettings(env: NodeJS.ProcessEnv = process.env) {
  const base = litellmBase(env), key = env.LITELLM_API_KEY?.trim();
  if (!key) throw new Error('LITELLM_KEY_REQUIRED');
  const model = env.LITELLM_MODEL?.trim() || 'glm-5.3';
  const maxTokens = Number(env.LITELLM_MAX_TOKENS || 512);
  if (model.length > 160 || !Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 1024) throw new Error('LITELLM_MODEL_CONFIG');
  return { base, key, model, maxTokens };
}
