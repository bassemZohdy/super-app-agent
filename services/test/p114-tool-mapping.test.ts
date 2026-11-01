import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRideRequest } from '../service-ride/src/index.ts';
import { executeFoodRequest } from '../service-food/src/index.ts';
import { executeWalletRequest } from '../service-wallet/src/index.ts';
import { executeProfileRequest } from '../service-profile/src/index.ts';
import { toolSchema } from '../../packages/protocol-core/src/request-validation.ts';

// P1-14: each application service advertises its tools at /mcp, and builds each tool's parameters as
// `toolSchema(service, name) || tool.parameters`. A tool whose name matches no validated route would therefore fall back to its own
// unvalidated parameters without anyone noticing. This pins the mapping: every advertised tool has a validated request schema, the
// parameters it advertises are exactly that schema, and the schema is a closed object so an unknown field is refused.
const services = [
  ['service-ride', executeRideRequest],
  ['service-food', executeFoodRequest],
  ['service-wallet', executeWalletRequest],
  ['service-profile', executeProfileRequest],
] as const;

for (const [service, run] of services) {
  test(`P1-14: every tool ${service} advertises maps to a validated request schema`, () => {
    const response = run('GET', '/mcp');
    assert.equal(response.status, 200, `${service} answers /mcp`);
    const tools = response.data.tools as { name: string; description?: string; parameters: Record<string, unknown> }[];
    assert.ok(tools.length >= 3, `${service} advertises its tools (${tools.length})`);
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length, 'tool names are unique');
    for (const tool of tools) {
      const schema = toolSchema(service, tool.name);
      assert.ok(schema, `${service}/${tool.name} has a validated request schema, not the unvalidated fallback`);
      assert.deepEqual(tool.parameters, schema, `${service}/${tool.name} advertises the validated schema`);
      assert.equal((schema as Record<string, unknown>).type, 'object', `${service}/${tool.name} takes an object`);
      assert.equal((schema as Record<string, unknown>).additionalProperties, false, `${service}/${tool.name} refuses fields it does not name`);
      assert.ok(typeof tool.description === 'string' && tool.description.trim().length > 0, `${service}/${tool.name} is described`);
    }
  });
}
