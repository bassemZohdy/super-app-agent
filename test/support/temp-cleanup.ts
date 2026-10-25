import { rmSync } from 'node:fs';

/** Removes a temporary test directory. On Windows a SQLite file can stay locked briefly after its connection closes,
 *  so a refused removal is retried a few times and then left for the OS to clear. Cleanup never fails a test. */
export function removeTemp(path: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { rmSync(path, { recursive: true, force: true }); return; } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}
