import { operationalEvent } from '../../../packages/backend-kit/src/observability.ts';
import type { ServerResponse } from 'node:http';
import type { A2UIMessageEnvelope } from '../../../packages/protocol-core/src/index.ts';

/** Bounded process-local replay. Durable replay belongs to P0-05. */
export class EventJournal {
  private logs = new Map<string, { touched: number; events: A2UIMessageEnvelope[]; sizes: number[] }>();
  private bytes = 0;
  private limit: number;
  private ttlMs: number;
  private maxSessions: number;
  private maxBytes: number;
  constructor(limit = 100, ttlMs = 300_000, maxSessions = 1000, maxBytes = 8_388_608) {
    this.limit = limit; this.ttlMs = ttlMs; this.maxSessions = maxSessions; this.maxBytes = maxBytes;
  }
  private remove(sid: string) {
    const log = this.logs.get(sid);
    if (log) this.bytes -= log.sizes.reduce((sum, size) => sum + size, 0);
    this.logs.delete(sid);
  }
  private prune() {
    for (const [sid, log] of this.logs) if (Date.now() - log.touched >= this.ttlMs) this.remove(sid);
  }
  append(sid: string, event: A2UIMessageEnvelope) {
    this.prune();
    const size = Buffer.byteLength(JSON.stringify(event));
    // An oversized event invalidates the old replay window; fresh clients get a snapshot.
    if (size > this.maxBytes) { this.remove(sid); return; }
    let log = this.logs.get(sid);
    if (!log) {
      if (this.logs.size >= this.maxSessions) this.remove(this.logs.keys().next().value!);
      log = { touched: Date.now(), events: [], sizes: [] };
      this.logs.set(sid, log);
    }
    log.touched = Date.now();
    log.events.push(event); log.sizes.push(size); this.bytes += size;
    if (log.events.length > this.limit) { log.events.shift(); this.bytes -= log.sizes.shift()!; }
    while (this.bytes > this.maxBytes) this.remove(this.logs.keys().next().value!);
  }
  /** undefined means the cursor is stale, unknown, or belongs to another session. */
  after(sid: string, cursor: string): A2UIMessageEnvelope[] | undefined {
    this.prune();
    const events = this.logs.get(sid)?.events;
    const index = events?.findIndex(event => event.id === cursor) ?? -1;
    return index < 0 ? undefined : events!.slice(index + 1);
  }
}

export function eventFrame(event: A2UIMessageEnvelope): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Respect write(false); disconnect a slow consumer before its queue grows unbounded. */
export class StreamWriter {
  private blocked = false;
  private closed = false;
  private queue: string[] = [];
  private queuedBytes = 0;
  private res: ServerResponse;
  private maxBytes: number;
  constructor(res: ServerResponse, maxBytes = 262_144) {
    this.res = res; this.maxBytes = maxBytes;
    res.on('drain', this.drain);
    res.once('close', this.close);
  }
  send(frame: string) {
    if (this.closed) return;
    const bytes = Buffer.byteLength(frame);
    if (bytes + this.queuedBytes + this.res.writableLength > this.maxBytes) {
      operationalEvent('sse_backpressure');
      this.close();
      this.res.destroy();
      return;
    }
    if (this.blocked) {
      this.queue.push(frame);
      this.queuedBytes += bytes;
    } else this.blocked = !this.res.write(frame);
  }
  private drain = () => {
    this.blocked = false;
    while (!this.closed && !this.blocked && this.queue.length) {
      const frame = this.queue.shift()!;
      this.queuedBytes -= Buffer.byteLength(frame);
      this.blocked = !this.res.write(frame);
    }
  };
  close = () => {
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
    this.res.off('drain', this.drain);
  };
}
