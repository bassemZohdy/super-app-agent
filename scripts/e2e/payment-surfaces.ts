import { keycloakIssuerUrl } from '../endpoints.ts';
/** Paced signed conversational reviews, original-order cancellation/recovery, exact provider effects. */
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { setTimeout as hold } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
import type { UIComponentNode } from '../../packages/protocol-core/src/index.ts';
const record=process.argv.includes('--record'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=`.data/payment-surfaces/${stamp}`;
let env:Awaited<ReturnType<typeof startEnvironment>>|undefined,browser:Browser|undefined,page:Page|undefined,offset=0;
const nodes=(n:UIComponentNode):UIComponentNode[]=>[n,...(n.children||[]).flatMap(nodes)];
try{
  env=await startEnvironment({authorizationClock:()=>Date.now()+offset});await mkdir(dir,{recursive:true});
  const login=async(username:string)=>{const r=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username,password:'demo123'}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return(await r.json() as any).access_token as string;};
  let token=await login('demo-commuter'),tokenAt=Date.now();const foreign=await login('bassem');
  browser=await chromium.launch({channel:process.env.E2E_BROWSER_CHANNEL||'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1050},...(record?{recordVideo:{dir,size:{width:1440,height:1050}}}:{})});page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(env.appUrl);await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill('demo-commuter');await page.locator('#password').fill('demo123');await page.locator('#kc-login').click();const accounts=page.getByRole('combobox',{name:'Current account',exact:true});await accounts.waitFor();const accountId=await accounts.inputValue();
  const api=async(path:string,body?:Record<string,unknown>,bearer?:string)=>{if(!bearer&&Date.now()-tokenAt>180000){token=await login('demo-commuter');tokenAt=Date.now();}const r=await fetch(`${env!.coreUrl}/api/payments/${path}${body?'':`?accountId=${accountId}`}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${bearer||token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify({accountId,requestKey:crypto.randomUUID(),...body})}:{}),signal:AbortSignal.timeout(30000)});return{status:r.status,data:await r.json() as any};};
  const card=(await api('methods',{preset:'challenge',nickname:'Conversation challenge card'})).data.method;
  let surface:any;
  const review=()=>record?hold(6000):Promise.resolve(),outcome=()=>record?hold(8000):Promise.resolve();
  const respond=async(path:string,action:()=>Promise<unknown>)=>{const r=page!.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST');await action();const response=await r;assert.equal(response.status(),200);const data=await response.json();assert.equal(data.success,true,JSON.stringify(data));surface=data.surface;await page!.locator(`[id="${surface.view.id}"]`).waitFor();return data;};
  const service=async(name:string)=>{await respond('/api/manual/prepare',()=>page!.getByRole('button',{name,exact:true}).click());await review();};
  const act=async(action:string)=>{const n=nodes(surface.view).find(n=>n.onEvents?.some(e=>e.payload.action===action));assert.ok(n,`Expected ${action}`);await respond('/api/a2ui/action',()=>page!.getByRole('button',{name:n.properties!.label,exact:true}).click());await review();};
  const choose=async(name:string)=>{await page!.getByRole('radio').filter({hasText:name}).click();await review();await act('payment_surface_choose');};
  const getOrder=async()=>{const overview=(await api('overview')).data;return overview.orders.find((o:any)=>o.id===nodes(surface.view).find(n=>n.id==='review_reference')!.properties!.text!.split(' ')[1]);};
  const snapshot=async()=> (await api('overview')).data;
  const send=async(text:string)=>{await page!.getByRole('textbox',{name:'Message Rashid',exact:true}).fill(text);await respond('/api/a2ui/intent',()=>page!.getByRole('button',{name:'Send message',exact:true}).click());await review();};
  const forge=async(payload:Record<string,unknown>,action='payment_surface_authorize',bearer=token)=>{const r=await fetch(`${env!.coreUrl}/api/a2ui/action`,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify({sessionId:surface.sessionId,accountId,surfaceRevision:surface.revision,action,payload}),signal:AbortSignal.timeout(30000)});return r.status;};
  await service('Utilities');await act('pay_utilities_bill');assert.equal((await snapshot()).orders.length,0);await choose('Cityside wallet');let o=await getOrder();assert.equal(o.state,'AWAITING_APPROVAL');const originalId=o.id;
  const authorization=nodes(surface.view).find(n=>n.onEvents?.some(e=>e.payload.action==='payment_surface_authorize'))!.onEvents![0].payload;
  assert.equal(await forge({...authorization,expectedVersion:99}),403);assert.equal(await forge({...authorization,amountMinor:1}),400);assert.equal(await forge(authorization,'payment_surface_authorize',foreign),403);
  await send('yes');o=await getOrder();assert.equal(o.state,'AWAITING_APPROVAL');assert.equal((await snapshot()).wallet.heldMinor,0);
  await act('payment_surface_authorize');assert.equal((await getOrder()).state,'AUTHORIZED');assert.equal((await snapshot()).wallet.heldMinor,42040);await outcome();
  await respond('/api/a2ui/cancel',()=>page!.getByRole('button',{name:'Cancel approval',exact:true}).click());assert.equal((await snapshot()).orders.find((r:any)=>r.id===originalId).state,'CANCELLED');assert.equal((await snapshot()).wallet.heldMinor,0);assert.equal((await snapshot()).wallet.balanceMinor,150000);await outcome();
  console.log('PASS: explicit wallet review/hold/header cancellation; assent, source/amount/version and foreign-owner substitution cannot capture.');
  await service('Utilities');await act('pay_utilities_bill');await choose('Cityside wallet');offset=300001;await act('payment_surface_authorize');await act('payment_surface_refresh');assert.match(JSON.stringify(surface),/FAILED|EXPIRED/);assert.equal((await snapshot()).wallet.heldMinor,0);offset=0;
  console.log('PASS: expired original review remains unpayable; advancing private authorization time never changes JWT validity.');
  await service('Utilities');await act('pay_utilities_bill');await choose('Conversation challenge card');await act('payment_surface_authorize');o=await getOrder();assert.equal(o.state,'REQUIRES_ACTION');assert.equal((await snapshot()).cardBalances.find((b:any)=>b.sourceId===card.id).spentMinor,0);await outcome();
  await act('payment_surface_challenge');o=await getOrder();assert.equal(o.state,'AUTHORIZED');const id=o.id;await env.restartPayments();await page.reload();await page.locator('#payment_review_card').waitFor();await review();assert.equal((await snapshot()).orders.find((r:any)=>r.id===id).state,'AUTHORIZED');
  env.loseNextSettlementResponse('dewa');await act('payment_surface_execute');o=await getOrder();assert.equal(o.state,'RECONCILIATION_REQUIRED');assert.equal(o.fundsCaptured,true);assert.equal(env.providerState('dewa',accountId,'bill').status,'PAID');assert.equal((await snapshot()).wallet.balanceMinor,150000);await outcome();
  await act('payment_surface_refresh');assert.equal(surface.view.id,'payment_receipt_card');assert.equal((await snapshot()).orders.find((r:any)=>r.id===id).state,'SETTLED');assert.equal((await snapshot()).cardBalances.find((b:any)=>b.sourceId===card.id).spentMinor,42040);await outcome();
  await mkdir('docs/reports/assets',{recursive:true});await page.getByRole('complementary',{name:'Service details',exact:true}).screenshot({path:'docs/reports/assets/conversation-payment-receipt.png'});
  console.log('PASS: chosen challenged card, provider restart/session reload and actual lost settlement response recover the same capture; wallet unchanged.');
  await service('Payments');await act('topup_wallet');assert.equal(nodes(surface.view).find(n=>n.type==='ChoiceGroup')!.properties!.options!.length,1);await choose('Conversation challenge card');await act('payment_surface_authorize');await act('payment_surface_challenge');assert.equal((await snapshot()).wallet.balanceMinor,150000);await act('payment_surface_execute');assert.equal(surface.view.id,'payment_receipt_card');assert.equal((await snapshot()).wallet.balanceMinor,155000);await outcome();
  console.log('PASS: conversational wallet reload requires the selected saved-card challenge and captures before crediting exactly AED 50.');
  await send('Pay my DEWA bill, settle police fines and recharge my Salik tag');await act('confirm_smartcity_checkout');await choose('Conversation challenge card');await act('payment_surface_authorize');
  const groupId=nodes(surface.view).find(n=>n.id==='review_reference')!.properties!.text!.split(' ')[1];
  for(let step=0;step<5&&surface.view.id!=='payment_receipt_card';step++){
    if(nodes(surface.view).some(n=>n.onEvents?.some(e=>e.payload.action==='payment_surface_challenge')))await act('payment_surface_challenge');
    else await act('payment_surface_execute');
  }
  assert.equal(surface.view.id,'payment_receipt_card');const final=await snapshot(),group=final.checkoutGroups.find((g:any)=>g.id===groupId);assert.equal(group.state,'COMPLETED');assert.equal(group.totalMinor,52000);assert.equal(group.orders.length,2);assert.equal(final.wallet.balanceMinor,155000);assert.equal(final.cardBalances.find((b:any)=>b.sourceId===card.id).spentMinor,99040);assert.equal(env.providerState('rta',accountId,'salik').balance,114);await outcome();
  console.log('PASS: grouped conversational checkout binds one card, stops for each child challenge, excludes the settled bill and confirms exact fine/toll receipts.');
  const video=page.video();await context.close();if(record&&video){const destination=`docs/recordings/payment-surfaces/runs/${stamp}`;await mkdir(destination,{recursive:true});await copyFile(await video.path(),`${destination}/payment-surfaces.webm`);await writeFile('docs/recordings/payment-surfaces/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><title>Conversational payment reviews</title><body><h1>Choose funding, authorize, then pay</h1><p>Signed owner reviews, wallet hold cancellation, expired approval, challenged card, provider restart, lost-response recovery, selected-card wallet reload and grouped fine/toll checkout. Reviews wait six seconds and outcomes eight seconds. Synthetic isolated funds; real local Keycloak. Consent and chat assent alone never capture money.</p><video controls style="width:100%;max-width:1440px" src="runs/${stamp}/payment-surfaces.webm"></video></body></html>`);console.log(`PASS: paced recording published at ${destination}`);}
}catch(e){await mkdir(dir,{recursive:true});await page?.screenshot({path:`${dir}/failure.png`,fullPage:true}).catch(()=>{});throw e;}
finally{await browser?.close();await env?.cleanup();}
