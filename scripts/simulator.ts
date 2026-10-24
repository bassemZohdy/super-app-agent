/** Local operator CLI; preview data only. No provider endpoints or caller-selected database paths. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SimulationRuns, SimulationError } from '../services/provider-simulator/src/simulation-run.ts';
const [command, ...rest]=process.argv.slice(2);
const root=fileURLToPath(new URL('../',import.meta.url));
let store:SimulationRuns|undefined;
try {
  const known=command==='create'?new Set(['seed','at','key']):command==='advance'?new Set(['revision','seconds','key']):command==='reset'?new Set(['revision','key']):command==='status'?new Set<string>():undefined;
  if(!known)throw new Error('Use create, status RUN_ID, advance RUN_ID or reset RUN_ID.');
  const id=command==='create'?undefined:rest.shift();const options:Record<string,string>={};
  while(rest.length){const key=rest.shift()!;const value=rest.shift();if(!key.startsWith('--')||!known.has(key.slice(2))||!value||value.startsWith('--')||Object.hasOwn(options,key.slice(2)))throw new Error('Invalid, duplicate or missing CLI option.');options[key.slice(2)]=value;}
  if(command!=='create'&&(!id||!/^simrun_[a-f0-9-]{36}$/.test(id)))throw new Error('A valid preview run ID is required.');
  store=new SimulationRuns(resolve(root,'.data/simulator/preview.sqlite'));
  const owner=`local:${userInfo().username}`;const key=options.key||randomUUID();
  const snapshot=command==='create'?store.create(owner,options.seed||'cityside',Date.parse(options.at||'2026-10-24T00:00:00.000Z'),key)
    :command==='status'?store.snapshot(owner,id!)
    :command==='advance'?store.advance(owner,id!,Number(options.revision),Number(options.seconds),key)
    :store.reset(owner,id!,Number(options.revision),key);
  console.log(JSON.stringify(snapshot,null,2));
} catch(e){console.error(e instanceof SimulationError?`${e.code}: ${e.message}`:e instanceof Error?e.message:'Preview simulator failed.');process.exitCode=1;}finally{store?.close();}
