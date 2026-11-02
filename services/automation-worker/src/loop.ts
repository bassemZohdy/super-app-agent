import { setTimeout as delay } from 'node:timers/promises';

/** Finish the current read or step on shutdown, but never claim another job after a stop. */
export async function runWorkerLoop(
  worker: { runOnce(signal?: AbortSignal): Promise<unknown> },
  scheduler: { tick(now: number): Promise<unknown> } | undefined,
  signal: AbortSignal,
  options: { idleMs?: number; clock?: () => number } = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 2000, clock = options.clock ?? Date.now;
  while (!signal.aborted) {
    // A failed read skips this tick; the next one recomputes from recorded occurrences.
    try { await scheduler?.tick(clock()); } catch { /* retry on the next pass */ }
    if (signal.aborted) break;
    const worked = await worker.runOnce(signal);
    if (!worked && !signal.aborted) {
      try { await delay(idleMs, undefined, { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
  }
}
