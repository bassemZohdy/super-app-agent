/** Real PKCE + provider/SQLite payment setup. Isolated data, no money effects or cloud calls. */
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
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('region',{name:'Payment accounts',exact:true}).screenshot({path:'docs/reports/assets/payment-accounts-mobile.png'});
  await page.getByRole('button',{name:'Close payment accounts',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Payment accounts',exact:true}).evaluate(e=>document.activeElement===e),true);
  console.log('PASS: mobile layout has no horizontal overflow and close restores keyboard focus');
} catch(error) {
  await mkdir('.data/payment-accounts',{recursive:true});await page?.screenshot({path:'.data/payment-accounts/failure.png',fullPage:true}).catch(()=>{});throw error;
} finally {await browser?.close();await environment?.cleanup();}
