import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer, createMcpHandler, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { toNodeHandler, hostHeaderValidation } from '@modelcontextprotocol/node';
import { Ajv } from 'ajv';
import { requestSchema } from '../../../packages/protocol-core/src/request-validation.ts';
import { capabilities } from '../../service-catalog/src/capabilities.ts';
import { verifyKeycloakToken } from './auth.ts';

const ajv = new Ajv({ strict: true });
const empty = { type: 'object', properties: {}, additionalProperties: false };
function input(schema: Record<string, unknown>): StandardSchemaWithJSON<unknown, Record<string, unknown>> {
  const validate = ajv.compile(schema);
  return { '~standard': { version: 1 as const, vendor: 'cityside-json-schema',
    jsonSchema: { input: () => schema, output: () => schema },
    validate: (value: unknown) => validate(value) ? { value: value as Record<string, unknown> }
      : { issues: [{ message: 'Invalid tool arguments' }] },
  } };
}
const inputs = { empty: input(empty), intent: input(requestSchema('agent-core', 'POST', '/api/a2ui/intent')),
  action: input(requestSchema('agent-core', 'POST', '/api/a2ui/action')) };
type Execute = (method: string, path: string, query: Record<string, string>, body: any, headers: Record<string, string | undefined>) => Promise<{ status: number; data: any }>;
const hosts = () => (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1],agent-core').split(',').map(item => item.trim());

/** Official MCP 2026-07-28 transport; all effects reuse normal approval ingress. */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, execute: Execute) {
  if (!hostHeaderValidation(hosts())(req, res)) return;
  const authorization = req.headers.authorization;
  const identity = authorization ? await verifyKeycloakToken(authorization) : undefined;
  if (!identity?.authenticated || !identity.user?.roles.includes('superapp-user')) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'User access token required' } })); return;
  }
  const call = async (method: string, path: string, body: Record<string, unknown> = {}) => {
    const result = await execute(method, path, {}, body, { authorization });
    return { isError: result.status >= 400,
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }], structuredContent: result.data };
  };
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'cityside-concierge', version: '1.0.0' });
    server.registerTool('cityside_accounts', { description: 'List the signed-in demo citizen’s owned accounts.', inputSchema: inputs.empty,
      annotations: { readOnlyHint: true, openWorldHint: false } }, () => call('GET', '/api/accounts'));
    server.registerTool('cityside_capabilities', { description: 'Discover simulated capabilities and their risk/confirmation contracts.', inputSchema: inputs.empty,
      annotations: { readOnlyHint: true, openWorldHint: false } }, () => ({ content: [{ type: 'text', text: JSON.stringify({ capabilities }) }], structuredContent: { capabilities } }));
    server.registerTool('cityside_intent', { description: 'Prepare a service surface. This never confirms a payment or booking.', inputSchema: inputs.intent,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, body => call('POST', '/api/a2ui/intent', body));
    server.registerTool('cityside_confirm_action', { description: 'Execute only an action explicitly offered by the current, unexpired reviewed surface. Requires its revision and exact bound payload.', inputSchema: inputs.action,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } }, body => call('POST', '/api/a2ui/action', body));
    server.registerTool('cityside_conversations', { description: 'List the signed-in citizen’s saved conversations.', inputSchema: inputs.empty,
      annotations: { readOnlyHint: true, openWorldHint: false } }, () => call('GET', '/api/sessions'));
    return server;
  }, { maxRequestBodySize: 65536 });
  try { await toNodeHandler(handler, { maxRequestBodySize: 65536 })(req, res); }
  finally { await handler.close(); }
}
