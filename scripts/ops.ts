/** Explicit local operations commands. Never prints credentials, tokens or database rows. */
import { randomBytes } from 'node:crypto';
import { readFile,writeFile,mkdtemp,rm,mkdir,chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupDirectory,restoreDirectory,withoutBackupKey } from './ops/archive.ts';
import { gatewayUrl,delegationAuthorityUrl,rideServiceUrl,foodServiceUrl,walletServiceUrl,catalogServiceUrl,profileServiceUrl,telecomServiceUrl,demoPortOffset } from './endpoints.ts';
const compose=['compose','-f','docker-compose.demo.yml'];
const stateSources=[['delegation-broker','/data/delegation'],['redis','/data'],['keycloak','/opt/keycloak/data'],...['rta','dewa','etisalat','du','police','dld','payments'].map(n=>[`provider-${n}`,'/data']),...['ride','food','wallet','catalog','profile','telecom'].map(n=>[`service-${n}`,'/data'])];
function docker(args:string[]){const result=spawnSync('docker',args,{encoding:'utf8',maxBuffer:1024*1024,timeout:120000});if(result.status!==0)throw Error(`Docker operation failed: ${args.slice(0,3).join(' ')}`);return result.stdout.trim();}
const action=process.argv[2];
if(action==='init'){
  let env='';try{env=await readFile('.env','utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const name of ['OPS_API_KEY','OPS_BACKUP_KEY']){if(!new RegExp(`^${name}=.+$`,'m').test(env)){env=env.replace(new RegExp(`^${name}=.*\\n?`,'gm'),'');env+=`\n${name}=${randomBytes(32).toString('hex')}\n`;}}
  await writeFile('.env',env,{mode:0o600});await chmod('.env',0o600);console.log('Operations keys configured in ignored .env. Recreate Node services to load OPS_API_KEY. Store OPS_BACKUP_KEY separately from backups.');
}else if(action==='inspect'){
  const secret=process.env.OPS_API_KEY;if(!secret||secret.length<32)throw Error('Run npm run ops:init first');
  const trace=process.argv[3];if(trace&&!/^[a-f0-9]{32}$/.test(trace))throw Error('Expected a 32-character trace ID');
  const urls=[gatewayUrl,delegationAuthorityUrl,rideServiceUrl,foodServiceUrl,walletServiceUrl,catalogServiceUrl,profileServiceUrl,telecomServiceUrl,...['rta','dewa','etisalat','du','police','dld','payments'].map((n,i)=>process.env[`PROVIDER_${n.toUpperCase()}_URL`]||`http://localhost:${4101+i+demoPortOffset}`)];
  const results=await Promise.all(urls.map(async base=>{try{const r=await fetch(`${base}/ops/state${trace?`?traceId=${trace}`:''}`,{headers:{'X-Ops-Key':secret},signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error();return await r.json();}catch{return {endpoint:new URL(base).port,alerts:['UNAVAILABLE_OR_DENIED']};}}));
  console.log(JSON.stringify(results,null,2));if(results.some(r=>r.alerts.length))process.exitCode=1;
}else if(action==='backup'){
  const secret=process.env.OPS_BACKUP_KEY;if(!secret||! /^[a-f0-9]{64}$/i.test(secret))throw Error('OPS_BACKUP_KEY must contain 64 hexadecimal characters');
  const destination=resolve(process.argv[3]||`.data/backups/${new Date().toISOString().replaceAll(':','-')}.enc`);
  const ids=docker([...compose,'ps','-q']).split('\n').filter(Boolean);if(!ids.length)throw Error('No running demo stack');
  const running=docker(['inspect','--format','{{index .Config.Labels "com.docker.compose.service"}}',...ids]).split('\n');
  const available=docker([...compose,'ps','-a','--services']).split('\n');for(const [service] of stateSources)if(!available.includes(service))throw Error(`Missing state service: ${service}`);
  const stage=await mkdtemp(join(tmpdir(),'cityside-backup-'));
  try{
    // Fence ingress first, then every writer; a clean Redis stop flushes persistence and H2 closes.
    docker([...compose,'stop','-t','90',...running.filter(s=>!['redis','keycloak'].includes(s))]);docker([...compose,'stop','-t','90','redis','keycloak']);
    for(const [service] of stateSources){const container=docker([...compose,'ps','-a','-q',service]);const state=JSON.parse(docker(['inspect','--format','{{json .State}}',container]));if(state.Running||state.Restarting||state.OOMKilled||![0,143].includes(state.ExitCode))throw Error(`Unclean shutdown; no checkpoint created: ${service}`);}
    for(const [service,path] of stateSources){const container=docker([...compose,'ps','-a','-q',service]);const target=join(stage,service);await mkdir(target);docker(['cp',`${container}:${path}/.`,target]);}
    await mkdir(join(stage,'config'));for(const file of ['docker-compose.demo.yml','package-lock.json','services/keycloak/realm-export.json'])await writeFile(join(stage,'config',file.replaceAll('/','_')),await readFile(file));
    const env=withoutBackupKey(await readFile('.env','utf8'));await writeFile(join(stage,'config','runtime.env'),env,{mode:0o600});
    const revision=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();console.log(JSON.stringify(await backupDirectory(stage,destination,secret,revision)));console.log(`Encrypted backup: ${destination}`);
  }finally{try{docker([...compose,'start',...running]);}finally{await rm(stage,{recursive:true,force:true});}}
}else if(action==='restore'){
  if(!process.argv[3]||!process.argv[4]||!process.env.OPS_BACKUP_KEY)throw Error('Usage: npm run ops:restore -- backup.enc /existing-parent/NEW-directory');
  console.log(JSON.stringify(await restoreDirectory(process.argv[3],process.argv[4],process.env.OPS_BACKUP_KEY)));
  console.log('Restored into a NEW private directory. Fence the old writers before attaching these paths; follow docs/development/operations.md.');
}else throw Error('Use init, inspect, backup or restore');
