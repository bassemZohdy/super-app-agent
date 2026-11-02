/** Read-only scheduling view for the automation worker: approved rules, due invoices and the wallet
 *  balance of one isolated run. Nothing here reserves, prepares or changes anything. */
import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import { boundedJsonResponse } from '../../../packages/backend-kit/src/bounded-json.ts';
import { MAX_PAYMENT_MINOR } from '../../../packages/protocol-core/src/payments.ts';
import type { RuleSource, ScheduledRule } from './scheduler.ts';

const item = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
};
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const trigger = (value: unknown): boolean => {
  if (!item(value)) return false;
  switch (value.type) {
    case 'INVOICE_DUE': return integer(value.daysBefore, 0, 14);
    case 'CALENDAR': return integer(value.dayOfMonth, 1, 31) && integer(value.hour, 0, 23) && integer(value.minute, 0, 59) && (value.monthEnd === 'LAST_DAY' || value.monthEnd === 'SKIP');
    case 'LOW_BALANCE': return integer(value.belowMinor, 1, MAX_PAYMENT_MINOR) && integer(value.reloadMinor, 1, MAX_PAYMENT_MINOR) && integer(value.targetBalanceMinor, 1, MAX_PAYMENT_MINOR);
    case 'NEW_FINE': return true;
    case 'PARKING_ENDING': return integer(value.minutesBefore, 1, 60);
    default: return false;
  }
};
const scheduledRule = (value: unknown): value is ScheduledRule => {
  if (!item(value) || !id(value.mandateId, 101) || !integer(value.policyVersion, 1, Number.MAX_SAFE_INTEGER) ||
      typeof value.state !== 'string' || !['AWAITING_APPROVAL', 'APPROVED', 'PAUSED', 'REVOKED', 'EXPIRED'].includes(value.state) || !id(value.target, 101) ||
      typeof value.timezone !== 'string' || value.timezone.length < 1 || value.timezone.length > 64 ||
      !instant(value.startsAt) || !instant(value.expiresAt) || Date.parse(value.startsAt) >= Date.parse(value.expiresAt) || !trigger(value.trigger)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { return false; }
  return true;
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
  async rules(): Promise<ScheduledRule[]> {
    const rules = (await this.get('')).rules;
    if (!Array.isArray(rules) || !rules.every(scheduledRule) || new Set(rules.map(rule => rule.mandateId)).size !== rules.length) throw new Error('Scheduling rules could not be confirmed.');
    return rules;
  }
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
