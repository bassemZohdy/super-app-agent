/** Read-only scheduling view for the automation worker: approved rules, due invoices and the wallet
 *  balance of one isolated run. Nothing here reserves, prepares or changes anything. */
import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import type { RuleSource, ScheduledRule } from './scheduler.ts';

export class HttpRuleSource implements RuleSource {
  private readonly credentials: ClientCredentials; private readonly base: URL; private readonly runId: string;
  constructor(config: { runId: string; paymentsUrl: string; clientSecret: string; clientId?: string }) {
    if (!/^autorn_[a-f0-9-]{36}$/.test(config.runId)) throw new Error('Name the isolated automation run.');
    const url = new URL(config.paymentsUrl);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid automation endpoint');
    this.base = url; this.runId = config.runId;
    this.credentials = new ClientCredentials(config.clientId || 'automation-worker', config.clientSecret, 'automation.execute');
  }
  private async get(path: string): Promise<Record<string, any>> {
    const response = await fetch(new URL(`/internal/automation-runs/${this.runId}/rules${path}`, this.base), { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${await this.credentials.token()}` } });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || data.success === false) throw new Error(`Scheduling read failed (${response.status})`);
    return data;
  }
  async rules(): Promise<ScheduledRule[]> { return (await this.get('')).rules as ScheduledRule[]; }
  async dueInvoices(rule: ScheduledRule) { return (await this.get(`/${encodeURIComponent(rule.mandateId)}/invoices`)).invoices as { dueDate: string }[]; }
  async balanceMinor(rule: ScheduledRule) { return (await this.balance(rule)).balanceMinor; }
  async balance(rule: ScheduledRule) {
    const data = await this.get(`/${encodeURIComponent(rule.mandateId)}/balance`);
    return { balanceMinor: Number(data.balanceMinor), qualifyingDebits: Number(data.qualifyingDebits) };
  }
}
