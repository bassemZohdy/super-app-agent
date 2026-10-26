/** Bounds for the in-memory conversation store (P1-18): threads per owner, threads overall and idle expiry.
 *  The Redis store already expires idle sessions and keeps 100 replayable events per thread; this gives the process-local
 *  store the same shape so churn cannot grow it without bound. A session with a request in flight is never evicted, and
 *  only its owner's own activity keeps it alive, so another caller cannot hold someone else's thread open. */
export type SessionLimitOptions = { maxPerOwner?: number; maxTotal?: number; idleMs?: number; now?: () => number };

export class SessionLimits {
  private readonly seen = new Map<string, { owner: string; touched: number }>();
  private readonly maxPerOwner: number;
  private readonly maxTotal: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  constructor(options: SessionLimitOptions = {}) {
    this.maxPerOwner = options.maxPerOwner ?? 25;
    this.maxTotal = options.maxTotal ?? 1000;
    this.idleMs = options.idleMs ?? 3_600_000;
    this.now = options.now ?? (() => Date.now());
    if (![this.maxPerOwner, this.maxTotal, this.idleMs].every(n => Number.isInteger(n) && n >= 1)) throw new Error('Session limits must be positive integers.');
  }
  get size() { return this.seen.size; }
  countFor(owner: string) { let n = 0; for (const entry of this.seen.values()) if (entry.owner === owner) n++; return n; }

  /** Idle sessions that no request is using. The caller discards them. */
  sweep(busy: (sid: string) => boolean): string[] {
    const cutoff = this.now() - this.idleMs, expired: string[] = [];
    for (const [sid, entry] of this.seen) if (entry.touched <= cutoff && !busy(sid)) { this.seen.delete(sid); expired.push(sid); }
    return expired;
  }

  /** Admits a session for its owner. Returns the sessions to discard to make room, or undefined when every candidate is busy
   *  and there is no room, so the caller refuses the new thread instead of dropping work in flight. */
  admit(sid: string, owner: string, busy: (sid: string) => boolean): { evicted: string[] } | undefined {
    const known = this.seen.get(sid);
    if (known) { if (known.owner === owner) known.touched = this.now(); return { evicted: [] }; }
    const evicted = this.sweep(busy);
    const oldest = (match: (entry: { owner: string }) => boolean) => [...this.seen].filter(([id, entry]) => match(entry) && !busy(id)).sort((a, b) => a[1].touched - b[1].touched)[0]?.[0];
    while (this.countFor(owner) >= this.maxPerOwner) {
      const victim = oldest(entry => entry.owner === owner);
      if (!victim) return undefined;
      this.seen.delete(victim); evicted.push(victim);
    }
    while (this.seen.size >= this.maxTotal) {
      const victim = oldest(() => true);
      if (!victim) return undefined;
      this.seen.delete(victim); evicted.push(victim);
    }
    this.seen.set(sid, { owner, touched: this.now() });
    return { evicted };
  }

  forget(sid: string) { this.seen.delete(sid); }
}

export function sessionLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionLimits {
  const read = (name: string, fallback: number) => { const raw = env[name]; if (raw === undefined || raw === '') return fallback; const n = Number(raw); if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`); return n; };
  return new SessionLimits({ maxPerOwner: read('SESSION_MAX_PER_OWNER', 25), maxTotal: read('SESSION_MAX_TOTAL', 1000), idleMs: read('SESSION_IDLE_SECONDS', Number(env.SESSION_TTL_SECONDS || 3600)) * 1000 });
}
