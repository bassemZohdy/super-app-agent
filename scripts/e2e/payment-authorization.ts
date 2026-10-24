/** Signed-owner card/wallet authorization, isolated SQLite and a private test clock; no capture or provider settlement. */
import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { chromium,type Browser,type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
let environment:Awaited<ReturnType<typeof startEnvironment>>|undefined,browser:Browser|undefined,page:Page|undefined;
let time=Date.now();
try{
  environment=await startEnvironment({authorizationClock:()=>time});
  async function login(username:string){const response=await fetch('http://localhost:8085/realms/superapp/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username,password:'demo123'})});assert.equal(response.status,200);return (await response.json() as any).access_token as string;}
  const [token,otherToken]=await Promise.all([login('demo-commuter'),login('bassem')]);
  browser=await chromium.launch({channel:process.env.E2E_BROWSER_CHANNEL||'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);
  await page.goto(environment.appUrl);await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();await page.locator('#username').fill('demo-commuter');await page.locator('#password').fill('demo123');await page.locator('#kc-login').click();
  const account=page.getByRole('combobox',{name:'Current account',exact:true});await account.waitFor();const accountId=await account.inputValue();
  async function api(path:string,input?:Record<string,unknown>,bearer=token){const response=await fetch(`${environment!.coreUrl}/api/payments/${path}${input?'':`?accountId=${accountId}`}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},...(input?{body:JSON.stringify({accountId,requestKey:crypto.randomUUID(),...input})}:{})});return {status:response.status,data:await response.json() as any};}
  await page.getByRole('button',{name:'Payment accounts',exact:true}).click();const panel=page.getByRole('region',{name:'Payment accounts',exact:true});await panel.getByText('AED 1500.00',{exact:true}).waitFor();
  await panel.getByRole('textbox',{name:'Card nickname',exact:true}).fill('Challenge source');await panel.getByRole('combobox',{name:'Demo card preset',exact:true}).selectOption('challenge');
  const responseFor=(path:string)=>page!.waitForResponse(r=>new URL(r.url()).pathname===`/api/payments/${path}`&&r.request().method()==='POST');
  let response=responseFor('methods');await panel.getByRole('button',{name:'Add demo card',exact:true}).click();const method=(await (await response).json()).method;
  response=responseFor('billing-accounts');await panel.getByRole('button',{name:/^Link DEWA/}).click();await response;
  await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).locator('option').nth(1).waitFor({state:'attached'});const payableId=await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).locator('option').nth(1).getAttribute('value');assert.ok(payableId);
  await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).selectOption(payableId);await panel.getByRole('combobox',{name:'Payment source',exact:true}).selectOption(method.id);
  response=responseFor('preview');await panel.getByRole('button',{name:'Review payment quote',exact:true}).click();await response;
  response=responseFor('orders');await panel.getByRole('button',{name:'Create authorization review',exact:true}).click();const createdResponse=await response,order=(await createdResponse.json()).order;
  const article=panel.getByRole('article',{name:`Authorization review ${order.id}`,exact:true});await article.getByText('State: AWAITING_APPROVAL',{exact:true}).waitFor();
  assert.equal((await api('orders',createdResponse.request().postDataJSON())).data.order.id,order.id);
  assert.equal((await api('orders',{...createdResponse.request().postDataJSON(),requestKey:crypto.randomUUID()})).status,409);
  const input={orderId:order.id,expectedVersion:order.version,approvalDigest:order.approvalDigest};
  assert.equal((await api('orders/approve',{...input,totalMinor:1})).status,400);assert.equal((await api('orders/approve',{...input,approvalDigest:'0'.repeat(64)})).status,409);
  assert.equal((await api('orders/approve',input,otherToken)).status,403);
  const realm=JSON.parse(await readFile('services/keycloak/realm-export.json','utf8')),secret=realm.clients.find((c:any)=>c.clientId==='service-wallet').secret;
  const machineResponse=await fetch('http://localhost:8085/realms/superapp/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:'service-wallet',client_secret:secret})});assert.equal(machineResponse.status,200);const machine=(await machineResponse.json() as any).access_token;
  const machineApproval=await fetch(`http://localhost:${environment.corePort+107}/v1/accounts/${accountId}/payment-orders/${order.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${machine}`,'X-User-Subject':order.ownerSub,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:1,approvalDigest:order.approvalDigest})});assert.equal(machineApproval.status,403);
  let snapshot=(await api('overview')).data;assert.equal(snapshot.cardBalances.find((b:any)=>b.sourceId===method.id).heldMinor,0);assert.equal(snapshot.wallet.balanceMinor,150000);
  response=responseFor('orders/approve');await article.getByRole('button',{name:'Approve authorization for AED 420.40',exact:true}).click();const pending=(await (await response).json()).order;assert.equal(pending.state,'REQUIRES_ACTION');
  const challenge={orderId:pending.id,expectedVersion:pending.version,approvalDigest:pending.approvalDigest,challengeId:pending.authorization.challengeId,decision:'APPROVE'};
  assert.equal((await api('orders/challenge',{...challenge,challengeId:'other-challenge'})).status,409);
  await article.getByRole('button',{name:'Approve demo card challenge',exact:true}).waitFor();await mkdir('docs/reports/assets',{recursive:true});await article.scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-card-challenge.png'});
  response=responseFor('orders/challenge');await article.getByRole('button',{name:'Approve demo card challenge',exact:true}).click();const authorized=(await (await response).json()).order;assert.equal(authorized.state,'AUTHORIZED');
  assert.equal((await api('orders/challenge',challenge)).status,409);snapshot=(await api('overview')).data;assert.equal(snapshot.cardBalances.find((b:any)=>b.sourceId===method.id).heldMinor,42040);assert.equal(snapshot.wallet.balanceMinor,150000);assert.equal(snapshot.payables.find((p:any)=>p.id===payableId).status,'UNPAID');
  await page.reload();await page.getByRole('button',{name:'Payment accounts',exact:true}).click();const restored=page.getByRole('article',{name:`Authorization review ${order.id}`,exact:true});await restored.getByText('State: AUTHORIZED',{exact:true}).waitFor();await restored.scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-authorization.png'});
  response=responseFor('orders/cancel');await restored.getByRole('button',{name:'Cancel authorization review',exact:true}).click();await response;
  snapshot=(await api('overview')).data;assert.equal(snapshot.cardBalances.find((b:any)=>b.sourceId===method.id).heldMinor,0);assert.equal(snapshot.dependencies.length,0);
  console.log('PASS: real PKCE stored quote, explicit challenge/approval, finite card hold, reload and cancellation; wrong owner/machine/modified/replayed decisions denied');
  async function create(sourceId:string){const current=(await api('overview')).data.payables.find((p:any)=>p.id===payableId);const result=await api('orders',{provider:'dewa',payableId,expectedPayableRevision:current.revision,methodId:sourceId,expectedMethodVersion:1});assert.equal(result.status,200);return result.data.order;}
  async function approve(o:any){const result=await api('orders/approve',{orderId:o.id,expectedVersion:o.version,approvalDigest:o.approvalDigest});assert.equal(result.status,200);return result.data.order;}
  for(const [preset,code] of [['limited','CARD_LIMIT_EXCEEDED'],['declined','CARD_DECLINED']]){
    const card=await api('methods',{preset,nickname:preset});assert.equal(card.status,200);const failed=await approve(await create(card.data.method.id));assert.equal(failed.state,'FAILED');assert.equal(failed.failureCode,code);
  }
  const expired=await api('methods',{preset:'expired',nickname:'Expired source'}),current=(await api('overview')).data.payables.find((p:any)=>p.id===payableId);
  assert.equal((await api('orders',{provider:'dewa',payableId,expectedPayableRevision:current.revision,methodId:expired.data.method.id,expectedMethodVersion:1})).status,409);
  const waiting=await approve(await create(method.id));time+=120001;snapshot=(await api('overview')).data;assert.equal(snapshot.orders.find((o:any)=>o.id===waiting.id).failureCode,'AUTHORIZATION_EXPIRED');assert.equal(snapshot.cardBalances.find((b:any)=>b.sourceId===method.id).heldMinor,0);
  const unapproved=await create(method.id);time+=300001;snapshot=(await api('overview')).data;assert.equal(snapshot.orders.find((o:any)=>o.id===unapproved.id).failureCode,'APPROVAL_EXPIRED');
  const walletOrder=await approve(await create('wallet'));snapshot=(await api('overview')).data;assert.equal(snapshot.wallet.heldMinor,42040);assert.equal(snapshot.wallet.balanceMinor,150000);assert.equal((await api('orders/cancel',{orderId:walletOrder.id,expectedVersion:walletOrder.version})).status,200);
  snapshot=(await api('overview')).data;assert.equal(snapshot.wallet.availableMinor,150000);assert.equal(snapshot.wallet.heldMinor,0);assert.equal(snapshot.dependencies.length,0);assert.equal(environment.providerState('payments',accountId,'wallet').balanceMinor,150000);
  const capture=await fetch(`http://localhost:${environment.corePort+107}/v1/accounts/${accountId}/payment-orders/${walletOrder.id}/capture`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(capture.status,404);
  const stale=await create(method.id),book=environment.payableBook('dewa'),before=book.get(accountId,payableId),changed=book.amend(accountId,payableId,before.revision,{amountMinor:42041});
  const staleDecision=await api('orders/approve',{orderId:stale.id,expectedVersion:stale.version,approvalDigest:stale.approvalDigest});assert.equal(staleDecision.status,409);assert.equal(staleDecision.data.code,'PAYABLE_CHANGED');
  assert.equal((await api('orders/cancel',{orderId:stale.id,expectedVersion:stale.version})).status,200);book.amend(accountId,payableId,changed.revision,{amountMinor:42040});
  const missing=await api('orders',{provider:'dewa',payableId:'dewa:bill:foreign-obligation',expectedPayableRevision:'a'.repeat(64),methodId:method.id,expectedMethodVersion:1});assert.equal(missing.status,404);
  console.log('PASS: persisted decline/limit/expired source, private-clock authorization/approval expiry and wallet hold/void; real-time identity remains valid; unsupported capture alias denies');
  time=Date.now();const household=await account.locator('option').filter({hasText:'Household account'}).getAttribute('value');assert.ok(household);await account.selectOption(household);
  await panel.getByText('No stored authorization reviews yet.',{exact:true}).waitFor();
  await panel.getByRole('textbox',{name:'Card nickname',exact:true}).fill('Household challenge');await panel.getByRole('combobox',{name:'Demo card preset',exact:true}).selectOption('challenge');
  response=responseFor('methods');await panel.getByRole('button',{name:'Add demo card',exact:true}).click();const householdCard=(await (await response).json()).method;
  response=responseFor('billing-accounts');await panel.getByRole('button',{name:/^Link DEWA/}).click();await response;
  const billSelect=panel.getByRole('combobox',{name:'Unpaid obligation',exact:true});await billSelect.locator('option').nth(1).waitFor({state:'attached'});await billSelect.selectOption((await billSelect.locator('option').nth(1).getAttribute('value'))!);
  await panel.getByRole('combobox',{name:'Payment source',exact:true}).selectOption(householdCard.id);
  response=responseFor('preview');await panel.getByRole('button',{name:'Review payment quote',exact:true}).click();await response;
  response=responseFor('orders');await panel.getByRole('button',{name:'Create authorization review',exact:true}).click();const householdOrder=(await (await response).json()).order;
  const householdArticle=panel.getByRole('article',{name:`Authorization review ${householdOrder.id}`,exact:true});
  response=responseFor('orders/approve');await householdArticle.getByRole('button',{name:'Approve authorization for AED 420.40',exact:true}).click();await response;
  response=responseFor('orders/challenge');await householdArticle.getByRole('button',{name:'Approve demo card challenge',exact:true}).click();await response;
  response=responseFor('orders/execute');await householdArticle.getByRole('button',{name:'Pay AED 420.40',exact:true}).click();const executed=await response;assert.equal(executed.status(),200);const paid=(await executed.json()).order;assert.equal(paid.state,'SETTLED');assert.equal(paid.fundsCaptured,true);assert.equal(paid.receipt.amountMinor,42040);
  await householdArticle.getByRole('region',{name:'Confirmed bill receipt',exact:true}).getByText('Bill paid · AED 420.40',{exact:true}).waitFor();
  const householdSnapshot=await fetch(`${environment.coreUrl}/api/payments/overview?accountId=${household}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()) as any;
  assert.equal(householdSnapshot.wallet.balanceMinor,150000);assert.equal(householdSnapshot.cardBalances.find((b:any)=>b.sourceId===householdCard.id).spentMinor,42040);assert.equal(householdSnapshot.cardBalances.find((b:any)=>b.sourceId===householdCard.id).heldMinor,0);assert.equal(householdSnapshot.dependencies.length,0);assert.equal(householdSnapshot.payables.find((p:any)=>p.id===paid.quote.payable.id).status,'PAID');
  await householdArticle.scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-card-receipt.png'});
  await page.reload();await page.getByRole('button',{name:'Payment accounts',exact:true}).click();if(await account.inputValue()!==household)await account.selectOption(household);await panel.getByRole('region',{name:'Confirmed bill receipt',exact:true}).getByText('Bill paid · AED 420.40',{exact:true}).waitFor();
  console.log('PASS: explicit challenged card payment captures once, settles the admitted bill, preserves wallet funds and restores its confirmed receipt after reload');
}catch(error){await mkdir('.data/payment-authorization',{recursive:true});await page?.screenshot({path:'.data/payment-authorization/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await environment?.cleanup();}
