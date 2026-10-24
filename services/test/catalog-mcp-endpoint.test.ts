import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MCP_ENDPOINT is read once at module load, so each case runs the catalog in a fresh child process.
const catalogModule = fileURLToPath(new URL('../service-catalog/src/index.ts', import.meta.url));
const DEFAULT_MCP_ENDPOINT = 'http://localhost:4000/mcp';
const OVERRIDE_MCP_ENDPOINT = 'https://mcp.example.test/superapp';

function readCatalogMcpEndpoints(mcpEndpointEnv: string | undefined): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.MCP_ENDPOINT;
  if (mcpEndpointEnv !== undefined) env.MCP_ENDPOINT = mcpEndpointEnv;

  const script = `
    const { executeCatalogRequest } = await import(${JSON.stringify(catalogModule)});
    const response = executeCatalogRequest('GET', '/miniapps');
    process.stdout.write(JSON.stringify(response.data.miniApps.map((app) => app.mcpEndpoint)));
  `;
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

test('catalog mcpEndpoint defaults to localhost:4000/mcp when MCP_ENDPOINT is unset', () => {
  const endpoints = readCatalogMcpEndpoints(undefined);
  assert.equal(endpoints.length, 5);
  assert.deepEqual(endpoints, Array(5).fill(DEFAULT_MCP_ENDPOINT));
});

test('catalog mcpEndpoint honours MCP_ENDPOINT when set', () => {
  const endpoints = readCatalogMcpEndpoints(OVERRIDE_MCP_ENDPOINT);
  assert.equal(endpoints.length, 5);
  assert.deepEqual(endpoints, Array(5).fill(OVERRIDE_MCP_ENDPOINT));
});
