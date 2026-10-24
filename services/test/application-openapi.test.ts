import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApplicationOpenApi, APPLICATION_OPERATIONS, APPLICATION_SERVICES } from '../../packages/backend-kit/src/application-openapi.ts';
import { requestSchema } from '../../packages/protocol-core/src/request-validation.ts';

const checkedIn = new URL('../../packages/backend-kit/openapi/application-apis.openapi.json', import.meta.url);
const handlerSources = ['../../packages/backend-kit/src/application.ts', '../../packages/protocol-core/src/request-validation.ts']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

test('checked-in application OpenAPI document equals generator output and is valid OpenAPI 3.1', async () => {
  const text = readFileSync(checkedIn, 'utf8');
  assert.equal(text, JSON.stringify(buildApplicationOpenApi(), null, 2) + '\n');
  const document = JSON.parse(text);
  assert.equal(document.openapi, '3.1.0');
  await SwaggerParser.validate(structuredClone(document));
});

test('every documented application path exists in the handler and route sources it was built from', () => {
  for (const operation of APPLICATION_OPERATIONS) {
    assert.ok(operation.service in APPLICATION_SERVICES, `${operation.operationId} has an unknown service`);
    if (!operation.manualSchema) {
      // Validated routes must exist in the protocol-core route table (throws when missing).
      requestSchema(operation.service, operation.method, operation.contract ?? operation.path);
    }
    const staticSegments = operation.path.split('/').filter(segment => segment && !segment.startsWith('{'));
    for (const segment of staticSegments) {
      assert.ok(handlerSources.includes(segment), `${operation.method} ${operation.path}: "${segment}" not found in handler sources`);
    }
  }
});

test('application OpenAPI document documents bearer auth and no duplicate operations', () => {
  const document = buildApplicationOpenApi();
  assert.deepEqual(document.components.securitySchemes.bearerAuth, {
    type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
    description: document.components.securitySchemes.bearerAuth.description,
  });
  const seen = new Set<string>();
  for (const operation of APPLICATION_OPERATIONS) {
    const key = `${operation.method} ${operation.path}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
});
