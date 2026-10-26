/**
 * Build-time settings for the Angular shell.
 *
 * `gatewayUrl` is the origin of the integrated gateway (`npm run demo:up`).
 * It is written by `scripts/angular-environment.ts` from SHELL_GATEWAY_URL
 * (default http://localhost:4000) before each build; set the variable and
 * rebuild to point the shell at another gateway.
 */
export const environment = {
  gatewayUrl: 'http://localhost:4000',
} as const;
