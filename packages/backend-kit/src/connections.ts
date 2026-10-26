/** Discovered provider operations and the calls actually made to them (P2-11). Each provider advertises an OpenAPI document; this module
 *  reads it from a fixed address, refuses anything that could move a call somewhere else, caches it for 30 seconds, and resolves a call
 *  by its operation ID instead of a hand-written path. It also keeps a small, bounded, secret-free record of calls and failures per
 *  signed-in owner for the Connections view. */
import { paymentsUrl } from './local-endpoints.ts';

export const PROVIDERS = ['rta', 'dewa', 'etisalat', 'du', 'police', 'dld', 'payments'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export type Operation = { operationId: string; method: string; path: string };
export class ManifestRefused extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const OPERATION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
export const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_OPERATIONS = 500;

/** The address a provider is read from: only a known provider, from its environment variable or the local default. */
export function providerBase(provider: string, env: Record<string, string | undefined> = process.env): URL {
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new ManifestRefused(`Unknown provider ${provider}.`);
  const port = 4101 + PROVIDERS.indexOf(provider as ProviderName);
  const value = provider === 'payments' ? paymentsUrl(env) : env[`PROVIDER_${provider.toUpperCase()}_URL`] || `http://localhost:${port}`;
  return new URL(value);
}

/** Checks a document and returns its operations, or refuses it with the reason. Nothing is trusted about where calls would go. */
export function readManifest(document: unknown, base: URL): Operation[] {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new ManifestRefused('The document is not an object.');
  const doc = document as { openapi?: unknown; paths?: unknown; servers?: unknown };
  if (typeof doc.openapi !== 'string' || !/^3\.1\.\d+$/.test(doc.openapi)) throw new ManifestRefused('The document is not OpenAPI 3.1.');
  if (!doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths)) throw new ManifestRefused('The document has no paths.');
  // Calls are never sent to an address from the document (see bindOperation), but a document that names another host is relocated or
  // tampered with, so only the provider's own host, a local address or a relative one is acceptable. A provider advertises its nominal
  // local address (for example localhost:4107) while a stack may publish it elsewhere, so the port is not compared.
  if (doc.servers !== undefined) {
    if (!Array.isArray(doc.servers)) throw new ManifestRefused('The servers entry is malformed.');
    for (const server of doc.servers) {
      const url = (server as { url?: unknown } | null)?.url;
      if (typeof url !== 'string') throw new ManifestRefused('A server has no address.');
      let resolved: URL;
      try { resolved = new URL(url, base); } catch { throw new ManifestRefused('A server address is malformed.'); }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(resolved.hostname);
      if (resolved.hostname !== base.hostname && !local) throw new ManifestRefused('A server points away from the provider.');
    }
  }
  const operations: Operation[] = [], seen = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths as Record<string, unknown>)) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\') || /[?#]/.test(path) || /:\/\//.test(path) || /%2e|%2f|%5c/i.test(path)) throw new ManifestRefused(`The path ${path.slice(0, 60)} is not a plain path.`);
    if (!item || typeof item !== 'object') throw new ManifestRefused(`The path ${path.slice(0, 60)} has no operations.`);
    for (const method of METHODS) {
      const operation = (item as Record<string, unknown>)[method] as { operationId?: unknown } | undefined;
      if (operation === undefined) continue;
      const id = operation?.operationId;
      if (typeof id !== 'string' || !OPERATION_ID.test(id)) throw new ManifestRefused(`An operation on ${path.slice(0, 60)} has no valid operationId.`);
      if (seen.has(id)) throw new ManifestRefused(`The operationId ${id} is used twice.`);
      seen.add(id);
      operations.push({ operationId: id, method: method.toUpperCase(), path });
      if (operations.length > MAX_OPERATIONS) throw new ManifestRefused('The document has too many operations.');
    }
  }
  if (operations.length === 0) throw new ManifestRefused('The document describes no operations.');
  return operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

/** Turns an operation and its path parameters into a URL on the provider's own origin, refusing anything that would leave it. */
export function bindOperation(operations: readonly Operation[], operationId: string, params: Record<string, string>, base: URL): { method: string; url: URL } {
  const operation = operations.find(item => item.operationId === operationId);
  if (!operation) throw new ManifestRefused(`The provider does not advertise ${operationId}.`);
  const filled = operation.path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === '' || value === '.' || value === '..' || /[\\]/.test(value)) throw new ManifestRefused(`The parameter ${name} is missing or not a plain value.`);
    return encodeURIComponent(value);
  });
  if (/\{|\}/.test(filled)) throw new ManifestRefused('The path has an unfilled parameter.');
  const url = new URL(filled, base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/')) throw new ManifestRefused('The call would leave the provider.');
  return { method: operation.method, url };
}

export type ConnectionState = { provider: string; ok: boolean; checkedAt: number; operations: Operation[]; problem?: string };
type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;

export class ConnectionRegistry {
  private readonly cache = new Map<string, ConnectionState>();
  private readonly options: { ttlMs?: number; now?: () => number; fetcher?: Fetcher; env?: Record<string, string | undefined> };
  constructor(options: { ttlMs?: number; now?: () => number; fetcher?: Fetcher; env?: Record<string, string | undefined> } = {}) { this.options = options; }
  private get ttl() { return this.options.ttlMs ?? 30_000; }
  private now() { return (this.options.now ?? Date.now)(); }

  /** One provider's discovered operations; cached for the TTL unless `refresh` asks for a new read. A refusal is a state, not a crash. */
  async check(provider: string, refresh = false): Promise<ConnectionState> {
    const cached = this.cache.get(provider);
    if (!refresh && cached && this.now() - cached.checkedAt < this.ttl) return cached;
    let state: ConnectionState;
    try {
      const base = providerBase(provider, this.options.env);
      const response = await (this.options.fetcher ?? fetch)(new URL('/openapi.json', base), { redirect: 'error', signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new ManifestRefused(`The provider answered ${response.status}.`);
      const text = await response.text();
      if (text.length > MAX_DOCUMENT_BYTES) throw new ManifestRefused('The document is too large.');
      let document: unknown;
      try { document = JSON.parse(text); } catch { throw new ManifestRefused('The document is not valid JSON.'); }
      state = { provider, ok: true, checkedAt: this.now(), operations: readManifest(document, base) };
    } catch (error) {
      const reason = error instanceof ManifestRefused ? error.reason : error instanceof TypeError && /redirect/i.test(String(error.cause ?? error.message)) ? 'The provider redirected, which is refused.' : 'The provider could not be reached.';
      state = { provider, ok: false, checkedAt: this.now(), operations: [], problem: reason };
    }
    this.cache.set(provider, state);
    return state;
  }
  async checkAll(refresh = false) { return Promise.all(PROVIDERS.map(provider => this.check(provider, refresh))); }
}

export type CallRecord = { at: number; provider: string; method: string; path: string; status: number; code?: string; ms: number };
const LIMIT_PER_OWNER = 50, MAX_OWNERS = 500;
const calls = new Map<string, CallRecord[]>();
/** Records one provider call for its owner. The path keeps its shape but not the account: ids are replaced, so the view shows what was called, not whose. */
export function recordCall(owner: string, record: Omit<CallRecord, 'path'> & { path: string }) {
  const path = record.path.replace(/\/v1\/accounts\/[^/]+/, '/v1/accounts/{account}').replace(/\/[A-Za-z]+_[A-Za-z0-9-]{8,}/g, '/{id}').slice(0, 200);
  const list = calls.get(owner) ?? [];
  list.push({ ...record, path });
  while (list.length > LIMIT_PER_OWNER) list.shift();
  calls.delete(owner); calls.set(owner, list);
  while (calls.size > MAX_OWNERS) calls.delete(calls.keys().next().value as string);
}
export const callsFor = (owner: string): CallRecord[] => [...(calls.get(owner) ?? [])].reverse();
export const clearCalls = () => calls.clear();
