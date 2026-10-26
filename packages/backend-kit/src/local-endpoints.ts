/** The local demo addresses services fall back to when their environment variable is unset (P2-06). They live here, once, so a
 *  default is changed in one place and a test can pin them; every function reads the environment at call time. Production
 *  configuration sets the variables, and `checkedEndpoint`-style callers still validate what they get. */
type Env = Record<string, string | undefined>;

export const LOCAL_DEFAULTS = {
  PROVIDER_PAYMENTS_URL: 'http://localhost:4107',
  DELEGATION_AUTHORITY_URL: 'http://localhost:4010',
  DELEGATION_ISSUER: 'http://localhost:4000/api/delegation',
  MCP_ENDPOINT: 'http://localhost:4000/mcp',
  CONVERSATION_SERVICE_URL: 'http://127.0.0.1:4201',
  VOICE_SERVICE_URL: 'http://127.0.0.1:4200',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001,http://localhost:3002',
} as const;

/** Ports of the bundled application services and of the provider simulators, in one table. */
export const SERVICE_PORTS = { ride: 4001, food: 4002, wallet: 4003, catalog: 4004, profile: 4005, telecom: 4006 } as const;
export const PROVIDER_PORTS = { rta: 4101, dewa: 4102, etisalat: 4103, du: 4104, police: 4105, dld: 4106, payments: 4107 } as const;

const read = (name: keyof typeof LOCAL_DEFAULTS, env: Env) => env[name] || LOCAL_DEFAULTS[name];

/** The payments provider every settlement, event and eligibility call goes to. */
export const paymentsUrl = (env: Env = process.env) => read('PROVIDER_PAYMENTS_URL', env);
/** The delegation broker. */
export const delegationAuthorityUrl = (env: Env = process.env) => read('DELEGATION_AUTHORITY_URL', env);
/** The issuer name the delegation tokens carry. */
export const delegationIssuer = (env: Env = process.env) => read('DELEGATION_ISSUER', env);
/** The gateway's MCP endpoint the catalog service registers with. */
export const mcpEndpoint = (env: Env = process.env) => read('MCP_ENDPOINT', env);
/** The local conversation model's address. */
export const conversationServiceUrl = (env: Env = process.env) => read('CONVERSATION_SERVICE_URL', env);
/** The local voice service's address. */
export const voiceServiceUrl = (env: Env = process.env) => read('VOICE_SERVICE_URL', env);
/** The browser origins the gateway answers, as a list. */
export const corsOrigins = (env: Env = process.env) => read('CORS_ORIGINS', env).split(',').map(value => value.trim());
