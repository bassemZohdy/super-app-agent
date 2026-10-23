/**
 * Low-cost development inference. No API key: deterministic demo mode.
 * A paid model must be explicitly allowed; free model outages never cause
 * an implicit paid fallback.
 */
export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}
export function getOpenRouterConfig(): OpenRouterConfig {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  };
}
export async function invokeOpenRouterChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = getOpenRouterConfig();
  if (!config.apiKey) {
    return JSON.stringify({ status: 'demo_fallback', message: 'No OpenRouter key configured; using deterministic simulated journey.' });
  }
  if (config.model !== 'openrouter/free' && !config.model.endsWith(':free') &&
      process.env.OPENROUTER_ALLOW_PAID_MODELS !== 'true') {
    throw new Error('Paid model blocked. Choose openrouter/free or a :free model, or explicitly allow paid models.');
  }
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('Production OpenRouter endpoint must use HTTPS');
  }
  const url = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions');
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://superapp-agent.internal',
      'X-Title': 'SuperApp Agent Platform',
    },
    body: JSON.stringify({
      model: config.model, messages,
      temperature: 0.1, max_tokens: 300,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter request failed: HTTP ${response.status}`);
  const data: any = await response.json();
  return typeof data?.choices?.[0]?.message?.content === 'string'
    ? data.choices[0].message.content : '';
}
