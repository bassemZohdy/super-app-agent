import { writeFileSync } from 'node:fs';
import { openApi, providerIds } from '../services/provider-simulator/src/contracts.ts';
for (const provider of providerIds) {
  const file = new URL(`../services/provider-simulator/openapi/${provider}.openapi.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(openApi(provider), null, 2) + '\n');
  console.log(`Generated ${provider}.openapi.json`);
}
