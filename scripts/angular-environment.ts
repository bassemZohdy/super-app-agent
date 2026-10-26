/** Writes the Angular shell's build-time gateway setting from `SHELL_GATEWAY_URL` (P2-06), so pointing the shell at another gateway
 *  is an environment variable and a build, not an edit of a tracked file. With the variable unset it writes the committed default,
 *  so a plain build changes nothing. The value must be a bare http(s) origin: no path, query, fragment or credentials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GATEWAY_URL = 'http://localhost:4000';

export function gatewayOrigin(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return DEFAULT_GATEWAY_URL;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('SHELL_GATEWAY_URL must be an absolute http(s) URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('SHELL_GATEWAY_URL must use http or https.');
  if (url.username || url.password) throw new Error('SHELL_GATEWAY_URL must not carry credentials.');
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error('SHELL_GATEWAY_URL must be an origin only, without a path, query or fragment.');
  return url.origin;
}

export function renderEnvironment(origin: string): string {
  return `/**
 * Build-time settings for the Angular shell.
 *
 * \`gatewayUrl\` is the origin of the integrated gateway (\`npm run demo:up\`).
 * It is written by \`scripts/angular-environment.ts\` from SHELL_GATEWAY_URL
 * (default ${DEFAULT_GATEWAY_URL}) before each build; set the variable and
 * rebuild to point the shell at another gateway.
 */
export const environment = {
  gatewayUrl: ${JSON.stringify(origin).replaceAll('"', "'")},
} as const;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Relative to this file, so it works from the repository root and from the workspace folder npm builds in.
  const target = fileURLToPath(new URL('../apps/shell-angular/src/environments/environment.ts', import.meta.url));
  const next = renderEnvironment(gatewayOrigin(process.env.SHELL_GATEWAY_URL));
  const current = readFileSync(target, 'utf8').replaceAll('\r\n', '\n');
  if (current !== next) writeFileSync(target, next);
  console.log(`Angular shell gateway: ${gatewayOrigin(process.env.SHELL_GATEWAY_URL)}`);
}
