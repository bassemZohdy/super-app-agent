/** Read-only scheduling view for the automation worker: approved rules, due invoices and the wallet
 *  balance of one isolated run. Nothing here reserves, prepares or changes anything. */
import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import { boundedJsonResponse } from '../../../packages/backend-kit/src/bounded-json.ts';
import type { RuleSource, ScheduledRule } from './scheduler.ts';

const item = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
};

export class HttpRuleSource implements RuleSource {
  private readonly credentials: ClientCredentials; private readonly base: URL; private readonly runId: string;
  constructor(config: { runId: string; paymentsUrl: string; clientSecret: string; clientId?: string }) {
    if (!/^autorn_[a-f0-9-]{36}$/.test(config.runId)) throw new Error('Name the isolated automation run.');
    const url = new URL(config.paymentsUrl);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid automation endpoint');
    this.base = url; this.runId = config.runId;
    this.credentials = new ClientCredentials(config.clientId || 'automation-worker', config.clientSecret, 'automation.execute');
  }
  private async get(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(`/internal/automation-runs/${this.runId}/rules${path}`, this.base), { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${await this.credentials.token()}` } });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Scheduling read could not be confirmed.'); }
    let body: unknown;
    try { body = await boundedJsonResponse(response, 65536); } catch { throw new Error('Scheduling read could not be confirmed.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Scheduling read could not be confirmed.');
    const data = body as Record<string, unknown>;
    if (data.success !== true || Object.hasOwn(data, 'error')) throw new Error('Scheduling read could not be confirmed.');
    return data;
  }
  async rules(): Promise<ScheduledRule[]> { return (await this.get('')).rules as ScheduledRule[]; }
  async dueInvoices(rule: ScheduledRule): Promise<{ dueDate: string }[]> {
    const invoices = (await this.get(`/${encodeURIComponent(rule.mandateId)}/invoices`)).invoices;
    if (!Array.isArray(invoices) || !invoices.every(value => item(value) && date(value.dueDate))) throw new Error('Scheduling invoices could not be confirmed.');
    return invoices.map(value => ({ dueDate: value.dueDate as string }));
  }
  async parkingSession(rule: ScheduledRule): Promise<{ ticketId: string; status: string; expiresAt: number } | null> {
    const session = (await this.get(`/${encodeURIComponent(rule.mandateId)}/session`)).session;
    if (session === null) return null;
    if (!item(session) || !id(session.ticketId, 72) || !id(session.status, 30) || typeof session.expiresAt !== 'number' || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= 0) throw new Error('Scheduling session could not be confirmed.');
    return { ticketId: session.ticketId, status: session.status, expiresAt: session.expiresAt };
  }
  async newFines(rule: ScheduledRule): Promise<{ fineId: string }[]> {
    const fines = (await this.get(`/${encodeURIComponent(rule.mandateId)}/fines`)).fines;
    if (!Array.isArray(fines) || !fines.every(value => item(value) && id(value.fineId, 96))) throw new Error('Scheduling fines could not be confirmed.');
    const ids = fines.map(value => value.fineId as string);
    if (new Set(ids).size !== ids.length) throw new Error('Scheduling fines could not be confirmed.');
    return ids.map(fineId => ({ fineId }));
  }
  async balanceMinor(rule: ScheduledRule) { return (await this.balance(rule)).balanceMinor; }
  async balance(rule: ScheduledRule) {
    const data = await this.get(`/${encodeURIComponent(rule.mandateId)}/balance`);
    if (typeof data.balanceMinor !== 'number' || !Number.isSafeInteger(data.balanceMinor) || data.balanceMinor < 0 ||
        typeof data.qualifyingDebits !== 'number' || !Number.isSafeInteger(data.qualifyingDebits) || data.qualifyingDebits < 0)
      throw new Error('Scheduling balance could not be confirmed.');
    return { balanceMinor: data.balanceMinor, qualifyingDebits: data.qualifyingDebits };
  }
}
