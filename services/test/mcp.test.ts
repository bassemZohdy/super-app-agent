import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { server } from '../agent-core/src/index.ts';

test('official MCP client discovers tools and confirms only the offered authenticated action', async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  assert.equal((await fetch(base, { method: 'POST' })).status, 401);
  assert.equal((await fetch(base, { method: 'POST', headers: { authorization: 'Bearer demo-local', origin: 'https://hostile.example' } })).status, 403);
  for (const mode of ['legacy', 'auto'] as const) {
    const client = new Client({ name: 'cityside-conformance', version: '1.0.0' }, { mode });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: 'Bearer demo-local' } } }));
      const listing = await client.listTools();
      assert.ok(listing.tools.some(tool => tool.name === 'cityside_confirm_action'));
      const sessionId = `mcp_${randomUUID()}`;
      const proposal = await client.callTool({ name: 'cityside_intent', arguments: { sessionId, text: 'Show my wallet balance' } });
      const data = proposal.structuredContent as { surface: { revision: string } };
      assert.ok(data.surface.revision);
      const changed = await client.callTool({ name: 'cityside_confirm_action', arguments: {
        sessionId, surfaceRevision: data.surface.revision, action: 'topup_wallet', payload: { amount: 51 },
      } });
      assert.equal(changed.isError, true);
      const confirmed = await client.callTool({ name: 'cityside_confirm_action', arguments: {
        sessionId, surfaceRevision: data.surface.revision, action: 'topup_wallet', payload: { amount: 50 },
      } });
      assert.notEqual(confirmed.isError, true);
      const replayed = await client.callTool({ name: 'cityside_confirm_action', arguments: {
        sessionId, surfaceRevision: data.surface.revision, action: 'topup_wallet', payload: { amount: 50 },
      } });
      assert.equal(replayed.isError, true);
    } finally { await client.close(); }
  }
});
