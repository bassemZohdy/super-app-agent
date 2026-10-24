/**
 * Build-time settings for the Angular shell.
 *
 * `gatewayUrl` is the origin of the integrated gateway (`npm run demo:up`).
 * Angular does not substitute `import.meta.env`, so change this value and
 * rebuild to point the shell at another gateway.
 */
export const environment = {
  gatewayUrl: 'http://localhost:4000',
} as const;
