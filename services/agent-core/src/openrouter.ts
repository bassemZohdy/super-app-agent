export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function getOpenRouterConfig(): OpenRouterConfig {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  };
}

export async function invokeOpenRouterChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = getOpenRouterConfig();
  if (!config.apiKey) {
    // Graceful fallback for local development without active API key
    return JSON.stringify({
      status: 'demo_fallback',
      message: 'Running in simulated mock agent mode. Configure OPENROUTER_API_KEY for live LLM reasoning.',
    });
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://superapp-agent.internal',
      'X-Title': 'SuperApp Agent Platform',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
