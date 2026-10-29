/** The environment variable that carries each realm client's secret, shared by the Keycloak reconcile, the Compose file and the
 *  qualification stack, so a client authenticates with one value per stack and no seeded credential is shared between them. The
 *  seeded realm value stays the interactive default: Compose reads the variable with that default, and the reconcile only overrides
 *  a client when its variable is set. `compose` marks the clients whose consumer runs inside the Compose file; the others
 *  authenticate from scripts, which read the same variable with the seeded fallback. */
export const CLIENT_SECRET_VARIABLES: Readonly<Record<string, { variable: string; compose: boolean }>> = {
  'service-ride': { variable: 'SERVICE_RIDE_CLIENT_SECRET', compose: true },
  'service-food': { variable: 'SERVICE_FOOD_CLIENT_SECRET', compose: true },
  'service-wallet': { variable: 'SERVICE_WALLET_CLIENT_SECRET', compose: true },
  'service-catalog': { variable: 'SERVICE_CATALOG_CLIENT_SECRET', compose: true },
  'service-profile': { variable: 'SERVICE_PROFILE_CLIENT_SECRET', compose: true },
  'service-telecom': { variable: 'SERVICE_TELECOM_CLIENT_SECRET', compose: true },
  'provider-settlements': { variable: 'PROVIDER_SETTLEMENT_SECRET', compose: true },
  'cityside-verifier': { variable: 'KEYCLOAK_VERIFIER_SECRET', compose: true },
  'provider-rta-settlement': { variable: 'PROVIDER_RTA_CLAIM_SECRET', compose: true },
  'provider-dewa-settlement': { variable: 'PROVIDER_DEWA_CLAIM_SECRET', compose: true },
  'provider-etisalat-settlement': { variable: 'PROVIDER_ETISALAT_CLAIM_SECRET', compose: true },
  'provider-du-settlement': { variable: 'PROVIDER_DU_CLAIM_SECRET', compose: true },
  'provider-police-settlement': { variable: 'PROVIDER_POLICE_CLAIM_SECRET', compose: true },
  'provider-eligibility': { variable: 'ELIGIBILITY_READER_SECRET', compose: true },
  'eligibility-operator': { variable: 'ELIGIBILITY_OPERATOR_SECRET', compose: false },
};
