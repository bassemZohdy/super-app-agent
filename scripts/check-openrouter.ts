/** Reports reachability/authentication without printing keys or provider response bodies. */
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY is missing; set it privately in the environment or ignored .env.');
for (const [name, path, headers] of [
  ['public model catalog', '/models', {}],
  ['configured key authentication', '/key', { Authorization: `Bearer ${key}` }],
] as const) {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1${path}`, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    await response.body?.cancel();
    console.log(`${name}: HTTP ${response.status}`);
    if (!response.ok) process.exitCode = 1;
  } catch { console.log(`${name}: network request failed`); process.exitCode = 1; }
}
console.log('Authentication success alone does not prove a model completion. No secret values are printed.');
