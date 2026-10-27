import { validateAGUISurface, type AGUISurfacePayload } from './ag-ui.ts';
import { readEventStream } from './sse-client.ts';

export class AgentClientError extends Error {}

export type AgentAction = 'messages' | 'resume' | 'cancel' | 'recover';
export interface AgentResult {
  threadId: string;
  status: string;
  reply: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  approval: { id: string; quote: { amountMinor: number; fineIds: string[]; currency: 'AED' }; expiresAt: number } | null;
  receipt: { id: string; simulated: true; quote: { amountMinor: number; currency: 'AED' } } | null;
  /** The renewal step of a fines-then-renewal request; both are null for a plain fines conversation. */
  renewalApproval: { id: string; quote: { amountMinor: number; vehicleId: string; currency: 'AED' }; expiresAt: number } | null;
  renewal: { id: string; simulated: true; quote: { amountMinor: number; currency: 'AED' } } | null;
  next: string[];
  surface: AGUISurfacePayload;
}
const threadId = /^[a-f0-9-]{36}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate the compatibility envelope before allowing its actions into the renderer. */
function result(value: unknown, expected: string): AgentResult {
  if (!record(value) || value.threadId !== expected || value.uiContract !== 'cityside-compat-v1' || typeof value.status !== 'string' || typeof value.reply !== 'string' || !Array.isArray(value.next) || !value.next.every(n => typeof n === 'string')) throw new AgentClientError('The fines service returned an invalid response. Inspect the conversation again.');
  const validated = validateAGUISurface(value.surface);
  if (!validated.success || validated.data?.sessionId !== expected) throw new AgentClientError('The fines service returned an invalid service panel.');
  if (!Array.isArray(value.messages) || !value.messages.every(m => record(m) && ['user', 'assistant'].includes(String(m.role)) && typeof m.content === 'string')) throw new AgentClientError('The fines service returned an invalid conversation.');
  const renewalApproval = value.renewalApproval ?? null, renewal = value.renewal ?? null;
  for (const item of [value.approval, value.receipt, renewalApproval, renewal]) {
    if (item === null) continue;
    if (!record(item) || typeof item.id !== 'string' || !record(item.quote) || !Number.isSafeInteger(item.quote.amountMinor) || Number(item.quote.amountMinor) <= 0 || item.quote.currency !== 'AED') throw new AgentClientError('The fines service returned an invalid payment review.');
  }
  if (value.approval !== null && (!record(value.approval) || !Array.isArray(value.approval.quote && (value.approval.quote as Record<string, unknown>).fineIds) || !Number.isFinite(value.approval.expiresAt))) throw new AgentClientError('The fines service returned an invalid approval.');
  if (value.receipt !== null && (!record(value.receipt) || value.receipt.simulated !== true)) throw new AgentClientError('The fines service returned an invalid receipt.');
  if (renewalApproval !== null && (!record(renewalApproval) || !record(renewalApproval.quote) || typeof renewalApproval.quote.vehicleId !== 'string' || !Number.isFinite(renewalApproval.expiresAt))) throw new AgentClientError('The fines service returned an invalid renewal approval.');
  if (renewal !== null && (!record(renewal) || renewal.simulated !== true)) throw new AgentClientError('The fines service returned an invalid renewal receipt.');
  return { ...value, renewalApproval, renewal, surface: validated.data } as unknown as AgentResult;
}

export class FocusedAgentClient {
  private readonly token: string;
  constructor(token: string) { this.token = token; }
  private async request(path: string, signal: AbortSignal, body?: Record<string, unknown>, id?: string) {
    return fetch(`/api/agent${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, Accept: body === undefined ? 'application/json' : 'text/event-stream', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': id || crypto.randomUUID() }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  private async requireSuccess(response: Response) {
    if (!response.ok) {
      await response.body?.cancel();
      throw new AgentClientError([401, 403, 404].includes(response.status) ? 'This conversation or access token is unavailable for this account. Sign in with its owner’s token, or start a new conversation.' : 'The request was not confirmed. Inspect or recover this conversation before continuing.');
    }
  }
  async create(signal: AbortSignal): Promise<string> {
    const response = await this.request('/threads', signal, {});
    await this.requireSuccess(response);
    const data: unknown = await response.json();
    if (!record(data) || typeof data.threadId !== 'string' || !threadId.test(data.threadId)) throw new AgentClientError('The fines service returned an invalid conversation ID.');
    return data.threadId;
  }
  async inspect(id: string, signal: AbortSignal): Promise<AgentResult> {
    if (!threadId.test(id)) throw new AgentClientError('The saved conversation ID is invalid.');
    const response = await this.request(`/threads/${id}`, signal);
    await this.requireSuccess(response);
    return result(await response.json(), id);
  }
  async transition(id: string, action: AgentAction, body: Record<string, unknown>, signal: AbortSignal, progress: (node: string) => void): Promise<AgentResult> {
    if (!threadId.test(id)) throw new AgentClientError('The saved conversation ID is invalid.');
    const response = await this.request(`/threads/${id}/${action}`, signal, body);
    await this.requireSuccess(response);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new AgentClientError('The request stream was interrupted. Inspect this conversation.');
    let complete: AgentResult | undefined;
    for await (const frame of readEventStream(response)) {
      const data: unknown = JSON.parse(frame.data);
      if (frame.event === 'error') throw new AgentClientError('The request was not confirmed. Inspect or recover this conversation before continuing.');
      if (frame.event === 'progress' && record(data) && typeof data.node === 'string') progress(data.node);
      if (frame.event === 'result') complete = result(data, id);
    }
    if (!complete) throw new AgentClientError('The connection ended before confirmation. Inspect or recover this conversation.');
    return complete;
  }
}
