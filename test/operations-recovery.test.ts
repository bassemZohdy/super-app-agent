import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes,generateKeyPairSync,sign,verify } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { backupDirectory,restoreDirectory,withoutBackupKey } from '../scripts/ops/archive.ts';
test('encrypted cold checkpoint restores SQLite state, idempotency, pending work and signing identity; rejects wrong keys, corruption and overwrite',async t=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'cityside-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);const db=new DatabaseSync(join(source,'financial.sqlite'));db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE journal(id TEXT PRIMARY KEY,amount INTEGER);INSERT INTO journal VALUES('original-payment',15000);CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT);INSERT INTO jobs VALUES('unknown-outcome','pending');CREATE TABLE idempotency(key TEXT PRIMARY KEY,body TEXT);INSERT INTO idempotency VALUES('original-request','confirmed-original');`);db.close();
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'});await writeFile(join(source,'issuer.pem'),privatePem,{mode:0o600});const secret=randomBytes(32).toString('hex'),archive=join(root,'checkpoint.enc');const saved=await backupDirectory(source,archive,secret,'test-fenced-writer');assert.equal(saved.files,2);// Windows does not enforce POSIX permission bits, so the owner-only mode is asserted where it is enforced.
if(process.platform!=='win32')assert.equal((await stat(archive)).mode&0o777,0o600);assert.doesNotMatch((await readFile(archive)).toString(),/PRIVATE KEY|original-payment|confirmed-original/);
 const restored=join(root,'restored');const manifest=await restoreDirectory(archive,restored,secret);assert.equal(manifest.checkpoint,'test-fenced-writer');const recovered=new DatabaseSync(join(restored,'financial.sqlite'));assert.equal(recovered.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(recovered.prepare('SELECT amount FROM journal').get()!.amount,15000);assert.equal(recovered.prepare('SELECT state FROM jobs').get()!.state,'pending');assert.throws(()=>recovered.exec("INSERT INTO idempotency VALUES('original-request','second-charge')"));recovered.close();
 const message=Buffer.from('recover-original-identity');assert.ok(verify('sha256',message,pair.publicKey,sign('sha256',message,await readFile(join(restored,'issuer.pem')))));
 await assert.rejects(restoreDirectory(archive,restored,secret),/EEXIST/);await assert.rejects(restoreDirectory(archive,join(root,'wrong'),randomBytes(32).toString('hex')));await assert.rejects(stat(join(root,'wrong')),/ENOENT/);
 const raw=await readFile(archive);raw[raw.length-1]^=1;const damaged=join(root,'damaged.enc');await writeFile(damaged,raw);await assert.rejects(restoreDirectory(damaged,join(root,'damaged'),secret));await assert.rejects(stat(join(root,'damaged')),/ENOENT/);await assert.rejects(backupDirectory(source,archive,secret,'again'),/EEXIST/);
});
test('backup and restore refuse symlinks and unsafe destinations',async t=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'cityside-recovery-safe-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);await writeFile(join(source,'state'),'safe');
 // Windows allows symlinks only with developer mode or elevation: probe once, and skip with that reason rather than fail.
 try{await symlink(source,join(root,'probe'),'dir');}catch(error){if((error as NodeJS.ErrnoException).code==='EPERM'){t.skip('this Windows account cannot create symlinks; enable developer mode to run this check');return;}throw error;}const secret=randomBytes(32).toString('hex'),archive=join(root,'state.enc');await assert.rejects(backupDirectory(source,join(source,'self.enc'),secret,'test'));await backupDirectory(source,archive,secret,'test');const linked=join(root,'linked');await symlink(source,linked);await assert.rejects(restoreDirectory(archive,join(linked,'restored'),secret),/linked/);await symlink(join(source,'state'),join(source,'key-link'));await assert.rejects(backupDirectory(source,join(root,'unsafe.enc'),secret,'test'),/links/);
});

test('private runtime configuration excludes quoted/exported encryption keys without modifying other values',()=>{
 for(const assignment of ['OPS_BACKUP_KEY=private',' export OPS_BACKUP_KEY = "private"','OPS_BACKUP_KEY = \'private\'']){const clean=withoutBackupKey(`OTHER="retained value"\n${assignment}\nLAST=ok\n`);assert.doesNotMatch(clean,/private|OPS_BACKUP_KEY/);assert.match(clean,/OTHER="retained value"/);assert.match(clean,/LAST=ok/);}
 assert.throws(()=>withoutBackupKey('OTHER="line one\nOPS_BACKUP_KEY=part-of-another-value\nline three"\nOPS_BACKUP_KEY=private'),/Cannot omit/);
});
