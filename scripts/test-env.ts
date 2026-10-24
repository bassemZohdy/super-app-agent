import { keycloakIssuerUrl } from './endpoints.ts';
// Tests opt into a local simulated identity. This is NOT a security bypass in runtime.
process.env.DEMO_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.OPENROUTER_API_KEY = '';
process.env.ENABLE_LIVE_LLM = 'false';
process.env.ENABLE_LOCAL_LLM = 'false';
process.env.KEYCLOAK_ISSUER = keycloakIssuerUrl;

// The default suite is offline and must never inherit the integrated deployment mode.
process.env.PROVIDER_INTEGRATION = 'false';
process.env.ELIGIBILITY_ENFORCEMENT = 'false';
process.env.DOMAIN_TRANSPORT = 'local';
process.env.SESSION_STORE = 'memory';
