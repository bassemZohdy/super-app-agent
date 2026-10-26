/** The local demo addresses services fall back to when their environment variable is unset (P2-06). They live here, once, so a
 *  default is changed in one place and a test can pin them; every function reads the environment at call time. Production
 *  configuration sets the variables, and `checkedEndpoint`-style callers still validate what they get. */
type Env = Record<string, string | undefined>;

export const LOCAL_DEFAULTS = {
  PROVIDER_PAYMENTS_URL: 'http://localhost:4107',
  DELEGATION_AUTHORITY_URL: 'http://localhost:4010',
  DELEGATION_ISSUER: 'http://localhost:4000/api/delegation',
  MCP_ENDPOINT: 'http://localhost:4000/mcp',
} as const;

const read = (name: keyof typeof LOCAL_DEFAULTS, env: Env) => env[name] || LOCAL_DEFAULTS[name];

/** The payments provider every settlement, event and eligibility call goes to. */
export const paymentsUrl = (env: Env = process.env) => read('PROVIDER_PAYMENTS_URL', env);
/** The delegation broker. */
export const delegationAuthorityUrl = (env: Env = process.env) => read('DELEGATION_AUTHORITY_URL', env);
/** The issuer name the delegation tokens carry. */
export const delegationIssuer = (env: Env = process.env) => read('DELEGATION_ISSUER', env);
/** The gateway's MCP endpoint the catalog service registers with. */
export const mcpEndpoint = (env: Env = process.env) => read('MCP_ENDPOINT', env);
