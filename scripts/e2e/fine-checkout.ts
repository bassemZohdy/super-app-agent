import { keycloakIssuerUrl } from '../endpoints.ts';
/** Exact-set fine settlement through real owner JWTs, isolated providers/SQLite and asserted paced UI. */
import assert from 'node:assert/strict';
import { mkdir,copyFile,writeFile } from 'node:fs/promises';
import { setTimeout as hold } from 'node:timers/promises';
import { chromium,type Browser,type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
const record=process.argv.includes('--record'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=`.data/fine-checkout/${stamp}`;
let environment:Awaited<ReturnType<typeof startEnvironment>>|undefined,browser:Browser|undefined,page:Page|undefined;
try{
  environment=await startEnvironment();await mkdir(dir,{recursive:true});
  async function login(username:string){const r=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username,password:'demo123'}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return (await r.json() as any).access_token as string;}
  const [token,otherToken]=await Promise.all([login('demo-commuter'),login('bassem')]);
  browser=await chromium.launch({channel:process.env.E2E_BROWSER_CHANNEL||'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1050},...(record?{recordVideo:{dir,size:{width:1440,height:1050}}}:{})});page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(environment.appUrl);await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill('demo-commuter');await page.locator('#password').fill('demo123');await page.locator('#kc-login').click();
  const accounts=page.getByRole('combobox',{name:'Current account',exact:true});await accounts.waitFor();let accountId=await accounts.inputValue();
  async function api(path:string,body?:Record<string,unknown>,bearer=token){const r=await fetch(`${environment!.coreUrl}/api/payments/${path}${body?'':`?accountId=${accountId}`}`,{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify({accountId,...(path==='fine-selection-preview'?{}:{requestKey:crypto.randomUUID()}),...body})}:{})});return {status:r.status,data:await r.json() as any};}
  const responseFor=(path:string)=>page!.waitForResponse(r=>new URL(r.url()).pathname===`/api/payments/${path}`&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Payment accounts',exact:true}).click();const panel=page.getByRole('region',{name:'Payment accounts',exact:true});await panel.getByText('AED 1500.00',{exact:true}).waitFor();
  for(const funding of ['wallet','challenge']){
    if(funding==='challenge'){const id=await accounts.locator('option').filter({hasText:'Household account'}).getAttribute('value');assert.ok(id);accountId=id;await accounts.selectOption(id);await panel.getByText('AED 1500.00',{exact:true}).waitFor();}
    let methodId='wallet';if(funding==='challenge'){
      await panel.getByRole('textbox',{name:'Card nickname',exact:true}).fill('My fine payment card');await panel.getByRole('combobox',{name:'Demo card preset',exact:true}).selectOption('challenge');const response=responseFor('methods');await panel.getByRole('button',{name:'Add demo card',exact:true}).click();methodId=(await (await response).json()).method.id;
    }
    let response=responseFor('billing-accounts');await panel.getByRole('button',{name:/^Link Traffic fines/}).click();await response;
    const snapshot=(await api('overview')).data,fines=snapshot.payables.filter((p:any)=>p.kind==='FINE'&&p.status==='UNPAID');assert.equal(fines.length,2);
    const checks=panel.getByRole('group',{name:'Select traffic fines to pay together',exact:true});for(const p of fines)await checks.getByRole('checkbox',{name:new RegExp(p.obligationId)}).check();
    await panel.getByRole('combobox',{name:'Payment source',exact:true}).selectOption(methodId);
    response=responseFor('fine-selection-preview');await checks.getByRole('button',{name:'Review selected fines',exact:true}).click();const preview=(await (await response).json()).preview;assert.equal(preview.totalMinor,42000);assert.equal(preview.payable.items.length,2);
    await panel.getByRole('article',{name:'Payment quote preview',exact:true}).scrollIntoViewIfNeeded();if(record)await hold(6000);
    assert.equal((await api('fine-selection-preview',{items:[{payableId:fines[0].id,expectedRevision:fines[0].revision},{payableId:fines[0].id,expectedRevision:fines[0].revision}],methodId,expectedMethodVersion:1})).status,400);
    assert.equal((await api('fine-selection-preview',{items:[{payableId:fines[0].id,expectedRevision:'a'.repeat(64)}],methodId,expectedMethodVersion:1})).status,409);
    response=responseFor('orders');await panel.getByRole('button',{name:'Create authorization review',exact:true}).click();const createdResponse=await response,o=(await createdResponse.json()).order;const article=panel.getByRole('article',{name:`Authorization review ${o.id}`,exact:true});
    assert.equal((await api('orders',createdResponse.request().postDataJSON())).data.order.id,o.id);assert.equal((await api('orders',{...createdResponse.request().postDataJSON(),requestKey:crypto.randomUUID()})).status,409);
    assert.equal((await api('orders/approve',{orderId:o.id,expectedVersion:o.version,approvalDigest:o.approvalDigest},otherToken)).status,403);
    assert.equal((await api('orders/approve',{orderId:o.id,expectedVersion:o.version,approvalDigest:'a'.repeat(64)})).status,409);
    response=responseFor('orders/approve');await article.getByRole('button',{name:'Approve authorization for AED 420.00',exact:true}).click();await response;
    if(funding==='challenge'){await article.getByText('State: REQUIRES_ACTION',{exact:true}).waitFor();await article.scrollIntoViewIfNeeded();if(record)await hold(6000);response=responseFor('orders/challenge');await article.getByRole('button',{name:'Approve demo card challenge',exact:true}).click();await response;}
    await article.getByText('State: AUTHORIZED',{exact:true}).waitFor();await article.scrollIntoViewIfNeeded();assert.equal((await api('overview')).data.wallet.balanceMinor,150000);if(record)await hold(6000);
    response=responseFor('orders/execute');await article.getByRole('button',{name:'Pay AED 420.00',exact:true}).click();const executed=await response,paid=(await executed.json()).order;assert.equal(executed.status(),200);assert.equal(paid.state,'SETTLED');assert.equal(paid.receipt.amountMinor,42000);
    await article.getByRole('region',{name:'Confirmed fine receipt',exact:true}).getByText('Fines paid · AED 420.00',{exact:true}).waitFor();await article.scrollIntoViewIfNeeded();if(record)await hold(8000);
    const after=(await api('overview')).data;assert.equal(after.wallet.balanceMinor,funding==='wallet'?108000:150000);assert.equal(after.payables.filter((p:any)=>p.kind==='FINE'&&p.status==='PAID').length,2);if(funding!=='wallet')assert.equal(after.cardBalances.find((b:any)=>b.sourceId===methodId).spentMinor,42000);
    assert.equal((await api('orders/execute',executed.request().postDataJSON())).data.order.paymentId,paid.paymentId);assert.equal((await api('orders/recover',{orderId:paid.id})).data.order.paymentId,paid.paymentId);assert.equal((await api('overview')).data.wallet.balanceMinor,after.wallet.balanceMinor);
    await mkdir('docs/reports/assets',{recursive:true});await article.screenshot({path:`docs/reports/assets/fine-${funding}-receipt.png`});
    await page.reload();await page.getByRole('button',{name:'Payment accounts',exact:true}).click();if(await accounts.inputValue()!==accountId)await accounts.selectOption(accountId);await panel.getByRole('region',{name:'Confirmed fine receipt',exact:true}).waitFor();await panel.getByRole('region',{name:'Confirmed fine receipt',exact:true}).scrollIntoViewIfNeeded();if(record)await hold(8000);
    console.log(`PASS: exact two-fine ${funding} payment, source effects, scoped ownership, duplicate/stale approval denial, one receipt and reload`);
  }
  const raw=await fetch(`http://localhost:${environment.corePort+107}/v1/accounts/${accountId}/charges`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({amountMinor:42000,merchant:'police',reference:'fines:unsupported-bypass',source:'wallet'})});assert.equal(raw.status,409);
  const video=page.video();await context.close();if(record){const target=`docs/recordings/fine-checkout/runs/${stamp}`;await mkdir(target,{recursive:true});await copyFile(await video!.path(),`${target}/fine-checkout.webm`);await writeFile('docs/recordings/fine-checkout/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><title>Exact-set fine payments</title><body><h1>Wallet and saved-card fine payments</h1><p>Real Keycloak, isolated synthetic accounts and funds. Each exact selection and authorization waits six seconds; confirmed receipts wait eight seconds. Challenged card payment preserves wallet funds. Assertions precede presentation holds.</p><video controls style="width:100%;max-width:1440px" src="runs/${stamp}/fine-checkout.webm"></video></body></html>`);console.log('PASS: paced exact-set fine recording published after all assertions');}
}catch(error){await page?.screenshot({path:`${dir}/failure.png`,fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await environment?.cleanup();}
