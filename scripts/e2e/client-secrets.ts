import { CLIENT_SECRET_VARIABLES } from '../realm-client-secrets.ts';

/** Match the selected realm's credential; isolated qualification must never fall back to a seeded secret. */
export function fixtureClientSecret(id: string, realm: { clients: Array<{ clientId: string; secret?: string }> }, env: NodeJS.ProcessEnv, offset: number): string {
  const variable = CLIENT_SECRET_VARIABLES[id]?.variable;
  if (!variable) throw new Error('No E2E client credential mapping exists.');
  const configured = env[variable];
  if (configured?.trim()) return configured;
  if (offset !== 0) throw new Error(`The selected qualification stack did not supply the ${variable} credential.`);
  const seeded = realm.clients.find(client => client.clientId === id)?.secret;
  if (!seeded?.trim()) throw new Error('The E2E realm has no client credential.');
  return seeded;
}
