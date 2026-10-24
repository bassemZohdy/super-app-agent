/** Real PKCE + provider/SQLite payment setup and revisioned settlement. Isolated synthetic funds only. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { startEnvironment } from './environment.ts';
let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;
let browser: Browser | undefined; let page: Page | undefined;
try {
  environment = await startEnvironment();
  const base = environment.coreUrl;
  async function login(username: string) {
    const result = await fetch('http://localhost:8085/realms/superapp/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password',client_id:'superapp-shell',username,password:'demo123' }) });
    assert.equal(result.status,200);return (await result.json() as {access_token:string}).access_token;
  }
  const [token, otherToken] = await Promise.all([login('demo-commuter'),login('bassem')]);
  async function api(path: string, input?: unknown, bearer=token) {
    const response=await fetch(`${base}/api/payments/${path}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
    return {status:response.status,data:await response.json() as any};
  }
  browser=await chromium.launch({channel:process.env.E2E_BROWSER_CHANNEL || 'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(45000);
  await page.goto(environment.appUrl);await page.getByRole('button',{name:'Sign in with Keycloak',exact:true}).click();
  await page.locator('#username').fill('demo-commuter');await page.locator('#password').fill('demo123');await page.locator('#kc-login').click();
  const accounts=page.getByRole('combobox',{name:'Current account',exact:true});await accounts.waitFor();
  const accountId=await accounts.inputValue();
  const responseFor = (path:string) => page!.waitForResponse(r=>new URL(r.url()).pathname===`/api/payments/${path}` && r.request().method()==='POST');
  await page.getByRole('button',{name:'Payment accounts',exact:true}).click();
  const panel=page.getByRole('region',{name:'Payment accounts',exact:true});await panel.getByText('AED 1500.00',{exact:true}).waitFor();
  await panel.getByRole('textbox',{name:'Card nickname',exact:true}).fill('Daily demo');
  const creating=responseFor('methods');await panel.getByRole('button',{name:'Add demo card',exact:true}).click();const created=await creating;assert.equal(created.status(),200);
  const method=(await created.json()).method;const request=created.request().postDataJSON();
  const replay=await api('methods',request);assert.equal(replay.status,200);assert.equal(replay.data.method.id,method.id);
  assert.equal((await api('methods',{...request,nickname:'changed'})).status,409);
  assert.equal((await api('methods',{...request,requestKey:crypto.randomUUID(),pan:'not-real-card-data'})).status,400);
  const defaulting=responseFor('methods/default');await panel.getByRole('button',{name:'Use Daily demo as default',exact:true}).click();assert.equal((await defaulting).status(),200);
  const linking=responseFor('billing-accounts');await panel.getByRole('button',{name:/^Link DEWA/}).click();assert.equal((await linking).status(),200);
  await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).locator('option').nth(1).waitFor({state:'attached'});
  const payableId=await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).locator('option').nth(1).getAttribute('value');assert.ok(payableId);
  await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).selectOption(payableId);
  await panel.getByRole('combobox',{name:'Payment source',exact:true}).selectOption(method.id);
  const reviewing=responseFor('preview');await panel.getByRole('button',{name:'Review payment quote',exact:true}).click();const reviewed=await reviewing;assert.equal(reviewed.status(),200);
  const preview=(await reviewed.json()).preview;assert.equal(preview.previewOnly,true);assert.equal(preview.source.id,method.id);assert.equal(preview.totalMinor,42040);
  const quote=panel.getByRole('article',{name:'Payment quote preview',exact:true});await quote.getByText('Total: AED 420.40',{exact:true}).waitFor();
  assert.equal((await api('preview',{accountId,payableId,methodId:method.id,expectedMethodVersion:1,totalMinor:1})).status,400);
  assert.equal((await api('billing-accounts',{accountId,requestKey:crypto.randomUUID(),provider:'dewa',reference:'someone-elses-account',nickname:'Invalid'})).status,403);
  assert.equal((await api('overview?accountId='+encodeURIComponent(accountId),undefined,otherToken)).status,403);
  assert.equal((await fetch(`${base}/api/payments/overview?accountId=${accountId}`)).status,401);
  const otherAccount=await fetch(`${base}/api/accounts`,{headers:{Authorization:`Bearer ${otherToken}`}}).then(r=>r.json()) as any;
  assert.equal((await api('methods/default',{accountId:otherAccount.accounts[0].id,requestKey:crypto.randomUUID(),methodId:method.id,expectedVersion:1},otherToken)).status,404);
  assert.equal(environment.providerState('payments',accountId,'wallet').balanceMinor,150000);
  console.log('PASS: PKCE card setup, provider-verified biller link, source-bound quote and no funds moved');
  console.log('PASS: persistent idempotency/conflict, unknown fields, raw card fields, cross-user/source and unauthenticated denial');
  await mkdir('docs/reports/assets',{recursive:true});await quote.scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-accounts-review.png'});
  const obligations=panel.getByRole('region',{name:'Bills and fines',exact:true});
  await obligations.getByText('Seeded settled history · no new charge',{exact:true}).waitFor();
  const book=environment.payableBook('dewa'),oldPayable=book.get(accountId,payableId);
  const changed=book.amend(accountId,payableId,oldPayable.revision,{amountMinor:42041});
  const providerRoot=`http://localhost:${environment.corePort+102}/v1/accounts/${accountId}`;
  const staleReview=await fetch(`${providerRoot}/payables/${encodeURIComponent(payableId)}/reviews`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({expectedRevision:oldPayable.revision})});
  assert.equal(staleReview.status,409);assert.equal((await staleReview.json() as any).code,'PAYABLE_CHANGED');
  const freshPreview=await api('preview',{accountId,payableId,methodId:method.id,expectedMethodVersion:1});assert.equal(freshPreview.status,200);assert.equal(freshPreview.data.preview.totalMinor,42041);assert.equal(freshPreview.data.preview.payable.revision,changed.revision);
  book.amend(accountId,payableId,changed.revision,{amountMinor:42040});
  const cycle=book.issueBill(accountId,{billId:'DEWA-browser-next-cycle',reference:oldPayable.reference,amountMinor:1234,dueDate:'2027-01-31',period:'2027-01'});
  await panel.getByRole('button',{name:'Refresh payment accounts',exact:true}).click();await obligations.getByText(cycle.label,{exact:true}).waitFor();
  book.amend(accountId,cycle.id,cycle.revision,{status:'CANCELLED'});
  await panel.getByRole('button',{name:'Refresh payment accounts',exact:true}).click();await obligations.getByText('AED 12.34 · CANCELLED · CLOSED · revision 2',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('combobox',{name:'Unpaid obligation',exact:true}).locator(`option[value="${cycle.id}"]`).count(),0);
  assert.equal((await fetch(`${providerRoot}/payables/${encodeURIComponent(cycle.id)}/amend`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({amountMinor:1})})).status,404);
  assert.equal(environment.providerState('payments',accountId,'wallet').balanceMinor,150000);
  await obligations.scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-payable-history.png'});
  console.log('PASS: provider revisions survive lifecycle changes; stale review denies, current preview changes, prior/withdrawn cycles stay visible with no charge');
  const disabling=responseFor('methods/status');await panel.getByRole('button',{name:'Disable Daily demo',exact:true}).click();assert.equal((await disabling).status(),200);
  await panel.getByText('Card status saved. No funding fallback was selected.',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Review payment quote',exact:true}).isDisabled(),true);
  const saved=await api(`overview?accountId=${accountId}`);assert.equal(saved.data.defaultMethodId,method.id);assert.equal(saved.data.methods.find((m:any)=>m.id===method.id).status,'DISABLED');
  const enabling=responseFor('methods/status');await panel.getByRole('button',{name:'Enable Daily demo',exact:true}).click();assert.equal((await enabling).status(),200);
  assert.equal((await api('preview',{accountId,payableId,methodId:method.id,expectedMethodVersion:1})).status,409);
  const household=await accounts.locator('option').filter({hasText:'Household account'}).getAttribute('value');assert.ok(household);await accounts.selectOption(household);
  await panel.getByText('No biller accounts linked yet.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Disable Daily demo',exact:true}).count(),0);
  await accounts.selectOption(accountId);await panel.getByRole('button',{name:'Disable Daily demo',exact:true}).waitFor();
  assert.equal(environment.providerState('payments',accountId,'wallet').balanceMinor,150000);
  console.log('PASS: disabled default stays explicit, changed versions fail, account switch restores only owned methods and links');
  await page.reload();await page.getByRole('button',{name:'Payment accounts',exact:true}).click();await page.getByRole('button',{name:'Disable Daily demo',exact:true}).waitFor();
  console.log('PASS: saved funding and linked resources survive browser reload');
  const prepaidLinking=responseFor('billing-accounts');await panel.getByRole('button',{name:'Link etisalat · Prepaid mobile',exact:true}).click();assert.equal((await prepaidLinking).status(),200);
  const withPrepaid=await api(`overview?accountId=${accountId}`);const line=withPrepaid.data.candidates.find((c:any)=>c.provider==='etisalat'&&c.reference.startsWith('PRE-'));
  assert.equal(line.balanceMinor,5000);assert.ok(withPrepaid.data.billingAccounts.some((b:any)=>b.provider==='etisalat'&&b.reference===line.reference&&b.status==='ACTIVE'));
  assert.equal((await api('billing-accounts',{accountId,requestKey:crypto.randomUUID(),provider:'du',reference:line.reference,nickname:'Wrong provider'})).status,403);
  console.log('PASS: owned prepaid line linked with its current balance; cross-provider line substitution denied');

  const walletDefault=responseFor('methods/default');await panel.getByRole('button',{name:'Use Cityside wallet as default',exact:true}).click();assert.equal((await walletDefault).status(),200);
  const current=await api(`overview?accountId=${accountId}`),currentMethod=current.data.methods.find((m:any)=>m.id===method.id),currentBiller=current.data.billingAccounts.find((b:any)=>b.provider==='dewa'&&b.status==='ACTIVE');
  const releaseHold=environment.bindPaymentUse(accountId,{resourceType:'METHOD',resourceId:method.id,resourceVersion:currentMethod.version,dependentKind:'HOLD',dependentId:'fixture-pending-hold'});
  const releaseRule=environment.bindPaymentUse(accountId,{resourceType:'BILLER',resourceId:currentBiller.id,resourceVersion:currentBiller.version,dependentKind:'MANDATE',dependentId:'fixture-rule-reference'});
  await panel.getByRole('button',{name:'Refresh payment accounts',exact:true}).click();await panel.getByText('hold · fixture-pending-hold',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Remove Daily demo',exact:true}).isDisabled(),true);assert.equal(await panel.getByRole('button',{name:/^Archive DEWA/}).isDisabled(),true);
  const blockedMethod=await api('methods/status',{accountId,requestKey:crypto.randomUUID(),methodId:method.id,expectedVersion:currentMethod.version,status:'REMOVED'});assert.equal(blockedMethod.status,409);assert.equal(blockedMethod.data.code,'RESOURCE_IN_USE');
  const blockedBiller=await api('billing-accounts/archive',{accountId,requestKey:crypto.randomUUID(),billingAccountId:currentBiller.id,expectedVersion:currentBiller.version});assert.equal(blockedBiller.status,409);assert.equal(blockedBiller.data.code,'RESOURCE_IN_USE');
  assert.equal((await api('resource-uses/release',{accountId,dependentId:'fixture-rule-reference'})).status,404);
  await panel.getByText('hold · fixture-pending-hold',{exact:true}).scrollIntoViewIfNeeded();await panel.screenshot({path:'docs/reports/assets/payment-related-items.png'});
  releaseHold();releaseRule();await panel.getByRole('button',{name:'Refresh payment accounts',exact:true}).click();
  await panel.getByRole('button',{name:'Remove Daily demo',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Remove Daily demo'&&!b.disabled));
  console.log('PASS: persisted lifecycle locks are shown, direct removal/archive is denied, and trusted release unblocks management');

  // A separate isolated owner exercises the source settlement contract through real signed HTTP.
  const settlementAccount=otherAccount.accounts[0].id;
  async function providerApi(port:number,path:string,input?:unknown,key=crypto.randomUUID()) {
    const response=await fetch(`http://localhost:${environment!.corePort+port}/v1/accounts/${settlementAccount}${path}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${otherToken}`,'Content-Type':'application/json','Idempotency-Key':key},...(input?{body:JSON.stringify(input)}:{})});
    return {status:response.status,data:await response.json() as any};
  }
  const payableList=await providerApi(102,'/payables');assert.equal(payableList.status,200);
  const settlementPayable=payableList.data.payables.find((p:any)=>p.status==='UNPAID');
  const detail=await providerApi(102,`/payables/${encodeURIComponent(settlementPayable.id)}`);assert.equal(detail.status,200);
  const startingWallet=await providerApi(107,'/wallet');assert.equal(startingWallet.data.balanceMinor,150000);
  const captureKey=crypto.randomUUID(),captureBody={amountMinor:settlementPayable.amountMinor,merchant:'dewa',reference:detail.data.settlementReference,source:'wallet'};
  const capture=await providerApi(107,'/charges',captureBody,captureKey);assert.equal(capture.status,200);
  assert.equal((await providerApi(107,'/charges',captureBody,captureKey)).data.charge.id,capture.data.charge.id);
  const settlementPath=`/payables/${encodeURIComponent(settlementPayable.id)}/payments`,settlementBody={expectedRevision:settlementPayable.revision,paymentId:capture.data.charge.id},settlementKey=crypto.randomUUID();
  const settled=await providerApi(102,settlementPath,settlementBody,settlementKey);assert.equal(settled.status,200);assert.equal(settled.data.payable.status,'PAID');assert.equal(settled.data.receipt.amountMinor,settlementPayable.amountMinor);
  assert.deepEqual((await providerApi(102,settlementPath,settlementBody,settlementKey)).data,settled.data);
  assert.equal((await providerApi(102,settlementPath,settlementBody)).status,409);
  assert.equal((await providerApi(107,'/wallet')).data.balanceMinor,150000-settlementPayable.amountMinor);
  assert.equal((await providerApi(107,'/transactions')).data.transactions.length,1);
  assert.equal((await providerApi(102,`/payables/${encodeURIComponent(settlementPayable.id)}`)).data.payable.status,'PAID');
  assert.equal(environment.providerState('payments',accountId,'wallet').balanceMinor,150000);
  console.log('PASS: separate signed-owner revision-bound settlement, capture/settlement retries and one exact journal debit; setup owner remains unchanged');

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await panel.evaluate(e=>{e.scrollTop=0;});
  await panel.screenshot({path:'docs/reports/assets/payment-accounts-mobile.png'});
  await page.getByRole('button',{name:'Close payment accounts',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Payment accounts',exact:true}).evaluate(e=>document.activeElement===e),true);
  console.log('PASS: mobile layout has no horizontal overflow and close restores keyboard focus');
} catch(error) {
  await mkdir('.data/payment-accounts',{recursive:true});await page?.screenshot({path:'.data/payment-accounts/failure.png',fullPage:true}).catch(()=>{});throw error;
} finally {await browser?.close();await environment?.cleanup();}
