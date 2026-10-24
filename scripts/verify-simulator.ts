/** Exercises the operator CLI across process boundaries. Preview records only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SimulationSnapshot } from '../services/provider-simulator/src/simulation-run.ts';
function cli(args:string[]):SimulationSnapshot {
  const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/simulator.ts',...args],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
let run=cli(['create','--seed','verifier','--key','verify_preview_v1']);
if(run.businessAt!==run.initialAt||run.events.length)run=cli(['reset',run.id,'--revision',String(run.revision),'--key',randomUUID()]);
const before=structuredClone(run),key=randomUUID();
const args=['advance',run.id,'--revision',String(run.revision),'--seconds','180','--key',key];
const advanced=cli(args);assert.equal(advanced.events.length,3);assert.ok(advanced.events.every(e=>e.previewOnly));
assert.equal(cli(args).replayed,true);assert.equal(cli(['status',run.id]).revision,advanced.revision);
const bad=spawnSync(process.execPath,['--experimental-strip-types','scripts/simulator.ts','advance',run.id,'--revision',String(advanced.revision),'--seconds','-1'],{encoding:'utf8'});
assert.equal(bad.status,1);assert.match(bad.stderr,/INVALID_ADVANCE/);assert.equal(cli(['status',run.id]).businessAt,advanced.businessAt);
const reset=cli(['reset',run.id,'--revision',String(advanced.revision),'--key',randomUUID()]);
assert.deepEqual(reset.fixtures,before.fixtures);assert.equal(reset.businessAt,reset.initialAt);assert.equal(reset.events.length,0);
console.log('PASS: persisted CLI create/advance/status/replay/reset across separate processes; three due preview events, no payment/provider effects.');
console.log('PASS: invalid backward advance leaves the saved business clock unchanged; original seeded fixtures restore exactly.');
