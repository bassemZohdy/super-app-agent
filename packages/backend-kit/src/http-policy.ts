import { operationalEvent } from './observability.ts';
import type { IncomingMessage } from 'node:http';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const setting = (key: string, fallback: number, max: number) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}`);
  return value;
};

/** Per-process demo bounds. No claim of distributed quotas. */
export class HttpPolicy {
  private active = 0;
  private buckets = new Map<string, { count: number; until: number }>();
  readonly concurrency: number;
  readonly rate: number;
  readonly maxKeys: number;
  constructor(concurrency = setting('HTTP_MAX_CONCURRENT', 64, 1000),
    rate = setting('HTTP_REQUESTS_PER_MINUTE', 300, 10000), maxKeys = 2000) {
    this.concurrency = concurrency; this.rate = rate; this.maxKeys = maxKeys;
  }
  admit(key: string) {
    const now = Date.now();
    if (this.active >= this.concurrency) {operationalEvent('capacity_rejection');throw new HttpError(429, 'Too many active requests');}
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (this.buckets.size >= this.maxKeys) {
        for (const [id, item] of this.buckets) if (item.until <= now) this.buckets.delete(id);
        if (this.buckets.size >= this.maxKeys) throw new HttpError(429, 'Request capacity reached');
      }
      bucket = { count: 0, until: now + 60000 }; this.buckets.set(key, bucket);
    }
    if (bucket.count >= this.rate) {operationalEvent('capacity_rejection');throw new HttpError(429, 'Request rate exceeded');}
    bucket.count++; this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}

/** Every retained JSON route reads an object; arrays and scalars are never valid request bodies. */
export const isPlainJsonObject = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const limit = setting('HTTP_BODY_LIMIT_BYTES', 65536, 1048576);
  const timeout = setting('HTTP_BODY_TIMEOUT_MS', 10000, 30000);
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') &&
      !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    return Promise.reject(new HttpError(415, 'Content-Type must be application/json'));
  }
  if (Number(req.headers['content-length'] || 0) > limit) return Promise.reject(new HttpError(413, 'Request body too large'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', error); };
    const fail = (reason: Error) => { cleanup(); req.once('error', () => {}); req.resume(); reject(reason); };
    const data = (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > limit) fail(new HttpError(413, 'Request body too large')); else chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'Invalid JSON body')); } };
    const aborted = () => fail(new HttpError(400, 'Request aborted'));
    const error = () => fail(new HttpError(400, 'Request could not be read'));
    const timer = setTimeout(() => fail(new HttpError(408, 'Request body timed out')), timeout);
    timer.unref(); req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', error);
  });
}
