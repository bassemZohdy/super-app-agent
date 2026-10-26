/** Host-side half of the run reset (SIM-05). The server cannot swap its own store and sealed journals block an in-place
 *  restore, so the host closes the server, calls this to remove the run's own database files, and reopens a fresh,
 *  reseeded store on the same run context. Only the three fixed file names under the run root are touched, and the
 *  record of each reset is kept outside the database it erases. */
import { appendFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const RUN_DATABASE_FILES = ['payments.sqlite', 'payments.sqlite-wal', 'payments.sqlite-shm'] as const;
export const RUN_RESET_LOG = 'run-resets.jsonl';

export function resetRunDatabase(root: string, runId: string, operatorSub: string, now = new Date()): string[] {
  if (!isAbsolute(root)) throw new Error('A run reset needs the absolute run root.');
  if (!/^simrun_[a-f0-9-]{36}$/.test(runId) || !operatorSub) throw new Error('A run reset needs the run ID and operator.');
  const base = resolve(root), removed: string[] = [];
  // Same dedicated-directory rule the issuer run enforces, so a normal demo database can never be reset by mistake.
  if (!/(^|[/\\])cityside-(?:e2e|issuer)-[A-Za-z0-9_-]+$/.test(base)) throw new Error('Run reset only applies to a dedicated isolated run directory.');
  for (const name of RUN_DATABASE_FILES) {
    const path = resolve(join(base, name));
    if (!path.startsWith(base + sep)) throw new Error('Run reset stays inside the run root.');
    rmSync(path, { force: true });
    removed.push(name);
  }
  appendFileSync(join(base, RUN_RESET_LOG), JSON.stringify({ at: now.toISOString(), runId, operatorSub }) + '\n');
  return removed;
}
