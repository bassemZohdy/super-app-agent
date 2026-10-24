import { gatewayUrl, keycloakIssuerUrl, walletServiceUrl } from './endpoints.ts';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const file = process.env.DEMO_RESTART_RECORD || '/tmp/cityside-demo-restart.json';
const response = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'bassem', password: 'demo123', scope: 'openid' }) });
assert.equal(response.status,200); const token=(await response.json() as any).access_token;
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const call=async(path:string,method='GET',body?:any)=>{const response=await fetch(`${gatewayUrl}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,`Request failed: ${path}`);return await response.json() as any;};
const { accounts }=await call('/api/accounts'); const accountId=accounts[0].id;
const wallet=async()=>{const response=await fetch(`${walletServiceUrl}/wallet/balance`,{headers:{...headers,'X-Account-Id':accountId}});assert.equal(response.status,200);return (await response.json() as any).balanceMinor;};
if(process.argv.includes('--prepare')){
  const sessionId=`restart_${randomUUID()}`;
  const data=await call('/api/a2ui/intent','POST',{sessionId,accountId,text:'Show my wallet balance'});
  const savedSession=await call(`/api/sessions/${sessionId}`); assert.equal(savedSession.runtime?.status,'awaiting-approval');
  writeFileSync(file,JSON.stringify({sessionId,accountId,revision:data.surface.revision,balanceMinor:await wallet(),threadId:savedSession.runtime.threadId}));
  console.log('Prepared owner-bound session and wallet restart assertions (no tokens saved).');
}else{
  const saved=JSON.parse(readFileSync(file,'utf8'));
  const data=await call(`/api/sessions/${saved.sessionId}`);assert.equal(data.accountId,saved.accountId);assert.equal(data.surface.revision,saved.revision);assert.ok(Array.isArray(data.messages));assert.equal(await wallet(),saved.balanceMinor);
  assert.equal(data.runtime?.threadId,saved.threadId); assert.equal(data.runtime?.status,'awaiting-approval');
  await call('/api/a2ui/action','POST',{sessionId:saved.sessionId,accountId:saved.accountId,surfaceRevision:saved.revision,action:'topup_wallet',payload:{amount:50}});
  assert.equal(await wallet(),saved.balanceMinor+5000);
  await call(`/api/sessions/${saved.sessionId}`,'DELETE');unlinkSync(file);
  console.log('PASS: conversation, owner/account, surface revision and SQLite wallet survived container restarts; LangGraph resumed its persisted approval and executed one top-up.');
}
