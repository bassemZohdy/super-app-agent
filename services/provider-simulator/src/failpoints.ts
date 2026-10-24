/**
 * Named, scriptable failpoints for the demo payment simulator (SIM-04).
 *
 * A failpoint models a response lost at a durable boundary: the local transition
 * or the provider effect has already committed, and the caller only sees an
 * unknown outcome. Failpoints are inert unless armed. Arming is process-local and
 * is reserved for the simulator controls and tests; it is never reachable from
 * citizen requests.
 */
import { SettlementError } from './payment-claims.ts';

/** Every named boundary. Keep this list in step with `hitFailpoint` call sites. */
export const FAILPOINTS = [
  'checkout.after-admission',
  'checkout.after-capture-commit',
  'checkout.after-settlement-request',
] as const;
export type FailpointName = (typeof FAILPOINTS)[number];

const armed = new Map<FailpointName, { remaining: number; fired: number }>();

/** Arm a failpoint so the next `times` hits lose their response. */
export function armFailpoint(name: FailpointName, times = 1) {
  if (!FAILPOINTS.includes(name)) throw new Error(`Unknown failpoint ${name}`);
  if (!Number.isInteger(times) || times < 1 || times > 100) throw new Error('Failpoint count must be 1 to 100');
  armed.set(name, { remaining: times, fired: armed.get(name)?.fired ?? 0 });
}

/** Clear every armed failpoint and fired counter. */
export function clearFailpoints() {
  armed.clear();
}

/** Number of times a failpoint has fired since the last clear. */
export function failpointFirings(name: FailpointName) {
  return armed.get(name)?.fired ?? 0;
}

/** Called at each boundary. Throws an unknown-outcome error only when armed. */
export function hitFailpoint(name: FailpointName) {
  const entry = armed.get(name);
  if (!entry || entry.remaining <= 0) return;
  entry.remaining--;
  entry.fired++;
  throw new SettlementError(503, 'PROVIDER_OUTCOME_UNKNOWN', `Simulated lost response at ${name}.`);
}
