// Tests opt into a local simulated identity. This is NOT a security bypass in runtime.
process.env.DEMO_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.OPENROUTER_API_KEY = '';
process.env.ENABLE_LIVE_LLM = 'false';
process.env.KEYCLOAK_ISSUER = 'http://localhost:8085/realms/superapp';
