/**
 * Local endpoints used by the scripts under scripts/.
 *
 * Each constant reads an environment variable and falls back to the exact
 * local default, so behaviour is unchanged when the variable is unset.
 *
 * Environment variables (default):
 *   DEMO_GATEWAY_URL          agent-core gateway (http://localhost:4000)
 *   DEMO_KEYCLOAK_ROOT        Keycloak base URL (http://localhost:8085)
 *   DEMO_KEYCLOAK_URL         Keycloak realm issuer (http://localhost:8085/realms/superapp)
 *   PROVIDER_PAYMENTS_URL     payments provider (http://localhost:4107)
 *   DEMO_PROVIDER_DEWA_URL    DEWA provider (http://localhost:4102)
 *   DEMO_TELECOM_SERVICE_URL  telecom service (http://localhost:4006)
 *   DELEGATION_AUTHORITY_URL  delegation broker (http://127.0.0.1:4010)
 *   DELEGATION_APP_URL        delegation web app (http://localhost:3000)
 *   LOCAL_AI_APP_URL          local AI web app (http://localhost:3000)
 *   DEMO_REDIS_URL            Redis (redis://127.0.0.1:6379)
 *   DEMO_RIDE_SERVICE_URL     ride service (http://localhost:4001)
 *   DEMO_FOOD_SERVICE_URL     food service (http://localhost:4002)
 *   DEMO_WALLET_SERVICE_URL   wallet service (http://localhost:4003)
 *   DEMO_CATALOG_SERVICE_URL  catalog service (http://localhost:4004)
 *   DEMO_PROFILE_SERVICE_URL  profile service (http://localhost:4005)
 */

export const gatewayUrl = process.env.DEMO_GATEWAY_URL || 'http://localhost:4000';
export const keycloakRootUrl = process.env.DEMO_KEYCLOAK_ROOT || 'http://localhost:8085';
export const keycloakIssuerUrl = process.env.DEMO_KEYCLOAK_URL || 'http://localhost:8085/realms/superapp';
export const providerPaymentsUrl = process.env.PROVIDER_PAYMENTS_URL || 'http://localhost:4107';
export const providerDewaUrl = process.env.DEMO_PROVIDER_DEWA_URL || 'http://localhost:4102';
export const telecomServiceUrl = process.env.DEMO_TELECOM_SERVICE_URL || 'http://localhost:4006';
export const delegationAuthorityUrl = process.env.DELEGATION_AUTHORITY_URL || 'http://127.0.0.1:4010';
export const delegationAppUrl = process.env.DELEGATION_APP_URL || 'http://localhost:3000';
export const localAiAppUrl = process.env.LOCAL_AI_APP_URL || 'http://localhost:3000';
export const redisUrl = process.env.DEMO_REDIS_URL || 'redis://127.0.0.1:6379';
export const rideServiceUrl = process.env.DEMO_RIDE_SERVICE_URL || 'http://localhost:4001';
export const foodServiceUrl = process.env.DEMO_FOOD_SERVICE_URL || 'http://localhost:4002';
export const walletServiceUrl = process.env.DEMO_WALLET_SERVICE_URL || 'http://localhost:4003';
export const catalogServiceUrl = process.env.DEMO_CATALOG_SERVICE_URL || 'http://localhost:4004';
export const profileServiceUrl = process.env.DEMO_PROFILE_SERVICE_URL || 'http://localhost:4005';
