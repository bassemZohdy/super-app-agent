import { mkdirSync, writeFileSync } from 'node:fs';
import { buildApplicationOpenApi } from '../packages/backend-kit/src/application-openapi.ts';

// Regenerates the checked-in OpenAPI 3.1 document for the integrated application APIs.
const file = new URL('../packages/backend-kit/openapi/application-apis.openapi.json', import.meta.url);
mkdirSync(new URL('.', file), { recursive: true });
writeFileSync(file, JSON.stringify(buildApplicationOpenApi(), null, 2) + '\n');
console.log('Generated application-apis.openapi.json');
