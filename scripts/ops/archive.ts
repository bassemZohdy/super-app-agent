/** Private, authenticated local-demo recovery bundles. Call only after ALL writers are fenced. */
import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
import { lstat,mkdir,readdir,readFile,writeFile,rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { dirname,join,resolve,relative,isAbsolute } from 'node:path';
const magic=Buffer.from('CITYSIDE-BACKUP-1\n');
const maxBytes=256*1024*1024;
type Entry={path:string;content:string;sha256:string};
type Bundle={version:1;createdAt:string;checkpoint:string;entries:Entry[]};
function key(value:string){if(!/^[a-f0-9]{64}$/i.test(value))throw Error('OPS_BACKUP_KEY must contain 64 hexadecimal characters');return Buffer.from(value,'hex');}
function safePath(path:string){if(!path||path.length>500||path.includes('\\')||path.includes('\0')||isAbsolute(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid backup path');return path;}
export async function backupDirectory(source:string,destination:string,secret:string,checkpoint:string){
  const root=resolve(source),target=resolve(destination),distance=relative(root,target);
  if(!distance.startsWith('..')&&!isAbsolute(distance))throw Error('Backup destination must be outside the source tree');
  const encryptionKey=key(secret),entries:Entry[]=[];let total=0;
  async function walk(dir:string){for(const name of (await readdir(dir)).sort()){const file=join(dir,name),stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw Error('Backup refuses links and special files');if(stat.isDirectory())await walk(file);else{if(entries.length>=10000||(total+=stat.size)>maxBytes)throw Error('Demo backup exceeds bounded size');const content=await readFile(file);entries.push({path:safePath(relative(root,file).split('\\').join('/')),content:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')});}}}
  if((await lstat(root)).isSymbolicLink())throw Error('Backup refuses linked source');await walk(root);
  const bundle:Bundle={version:1,createdAt:new Date().toISOString(),checkpoint,entries};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);cipher.setAAD(magic);
  const encrypted=Buffer.concat([cipher.update(gzipSync(JSON.stringify(bundle))),cipher.final()]);
  await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,Buffer.concat([magic,iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});
  return {createdAt:bundle.createdAt,files:entries.length,bytes:total};
}
export async function restoreDirectory(source:string,destination:string,secret:string){
  const encryptionKey=key(secret),stat=await lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes*2)throw Error('Invalid backup file');
  const raw=await readFile(source);if(!raw.subarray(0,magic.length).equals(magic))throw Error('Invalid backup format');
  const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(offset,offset+12));decipher.setAAD(magic);decipher.setAuthTag(raw.subarray(offset+12,offset+28));
  // Authenticate and validate the entire manifest BEFORE creating the restore destination.
  const bundle=JSON.parse(gunzipSync(Buffer.concat([decipher.update(raw.subarray(offset+28)),decipher.final()]),{maxOutputLength:maxBytes*2}).toString()) as Bundle;
  if(bundle.version!==1||!Array.isArray(bundle.entries)||bundle.entries.length>10000||typeof bundle.createdAt!=='string'||typeof bundle.checkpoint!=='string')throw Error('Invalid backup manifest');
  const seen=new Set<string>();let total=0;
  const files=bundle.entries.map(e=>{safePath(e.path);if(seen.has(e.path)||typeof e.content!=='string')throw Error('Invalid backup entry');seen.add(e.path);const bytes=Buffer.from(e.content,'base64');if((total+=bytes.length)>maxBytes||createHash('sha256').update(bytes).digest('hex')!==e.sha256)throw Error('Backup integrity failure');return {path:e.path,bytes};});
  for(const path of seen)for(let parent=dirname(path);parent!=='.';parent=dirname(parent))if(seen.has(parent))throw Error('Conflicting backup paths');
  // Parent directories must already exist and must not traverse a symlink.
  const root=resolve(destination);let ancestor=dirname(root);
  while(true){if((await lstat(ancestor)).isSymbolicLink())throw Error('Restore refuses linked ancestor');const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;}
  await mkdir(root,{mode:0o700}); // EEXIST is intentional: never merge/overwrite any existing state.
  try{for(const file of files){const target=join(root,file.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,file.bytes,{flag:'wx',mode:0o600});}}catch(e){await rm(root,{recursive:true,force:true});throw e;}
  return {createdAt:bundle.createdAt,checkpoint:bundle.checkpoint,files:files.length,bytes:total};
}

/** Preserve runtime configuration byte-for-byte except the encryption-key assignment; reject ambiguous edits. */
export function withoutBackupKey(source:string){
 const before=parseEnv(source),clean=source.replace(/^[\t ]*(?:export[\t ]+)?OPS_BACKUP_KEY[\t ]*=.*(?:\r?\n|$)/gm,'');delete before.OPS_BACKUP_KEY;
 const after=parseEnv(clean),canonical=(values:Record<string,string|undefined>)=>JSON.stringify(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
 if(after.OPS_BACKUP_KEY!==undefined||canonical(before)!==canonical(after))throw Error('Cannot omit encryption key without altering runtime configuration');return clean;
}
