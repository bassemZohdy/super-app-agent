import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod/v4';
import { Decision } from '../services/agent-core/src/orchestrator/contracts.ts';

const base = new URL(process.env.AGENT_CLIENT_URL || 'http://127.0.0.1:4300');
const identity = JSON.parse(process.env.AGENT_TEST_IDENTITIES || '[]')[0] as { token?: string } | undefined;
// For Keycloak mode, supply a current user token via the environment only.
const token = process.env.AGENT_CLIENT_TOKEN || identity?.token;
if (!token) throw new Error('Configure a local test identity or a current user access token');
async function request(path: string, body?: unknown) {
  const response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Agent request failed (${response.status})`);
  return z.object({ threadId: z.string(), reply: z.string().optional(), status: z.string().optional(), approval: z.object({ id: z.string(), quote: z.object({ amountMinor: z.number() }) }).nullable().optional() }).passthrough().parse(data);
}
const ui = createInterface({ input: stdin, output: stdout });
try {
  const existing = process.argv[2];
  const threadId = existing || (await request('/api/agent/threads', {})).threadId;
  const root = `/api/agent/threads/${threadId}`;
  console.log(`Interaction: ${threadId}. Keep this ID to resume after a restart.`);
  let result = existing ? await request(root) : await request(`${root}/messages`, { message: await ui.question('Request: ') });
  console.log(result.reply || result.status);
  if (result.approval) {
    const answer = await ui.question(`Simulated total AED ${(result.approval.quote.amountMinor / 100).toFixed(2)}. Type approve, reject or cancel: `);
    const decision = Decision.parse({ approvalId: result.approval.id, decision: answer.trim() });
    result = await request(`${root}/resume`, decision);
    console.log(result.reply || result.status);
  }
} finally { ui.close(); }
