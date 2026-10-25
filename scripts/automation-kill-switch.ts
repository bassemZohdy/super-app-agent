/** Operator control for the automation worker's global kill switch (AUTO-15).
 *
 *  Local demo authority: whoever can write the worker's job store is the operator. Engaging the switch stops the worker
 *  from claiming new work and from starting any new step; a job already holding an unpresented credential is held, never
 *  replayed. The state is persisted, so a restart keeps it engaged until it is released.
 *
 *    node --experimental-strip-types scripts/automation-kill-switch.ts status
 *    node --experimental-strip-types scripts/automation-kill-switch.ts engage --reason "suspected bad source"
 *    node --experimental-strip-types scripts/automation-kill-switch.ts release
 */
import { existsSync } from 'node:fs';
import { JobStore } from '../services/automation-worker/src/jobs.ts';

const path = process.env.AUTOMATION_JOBS_DB || '.data/automation-worker/jobs.sqlite';
const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] ?? '') : ''; };

function main() {
  if (!['status', 'engage', 'release'].includes(command ?? '')) throw new Error('Use status, engage --reason "<why>" or release.');
  // Never create a store as a side effect of an operator command: a wrong path must fail loudly.
  if (!existsSync(path)) throw new Error(`No automation job store at ${path}; set AUTOMATION_JOBS_DB to the worker's store.`);
  const store = new JobStore(path);
  try {
    if (command === 'engage') {
      const reason = flag('--reason').trim();
      if (!reason) throw new Error('Engaging the kill switch needs --reason "<why>".');
      store.setKillSwitch(true, reason);
    }
    if (command === 'release') store.setKillSwitch(false);
    const state = store.killSwitch();
    console.log(state.engaged ? `Kill switch ENGAGED since ${new Date(state.at!).toISOString()}: ${state.reason}` : 'Kill switch released; the worker may start new steps.');
  } finally { store.close(); }
}
try { main(); } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
