import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import { validateAGUISurface, type AGUISurfacePayload, type UIComponentNode } from '../../packages/protocol-core/src/index.ts';
import { startEnvironment } from './environment.ts';
import { pacing } from './config.ts';
import { publishRecording, type Chapter } from './report.ts';

type CoreData = { success: boolean; surface: AGUISurfacePayload; inference?: { provider: string }; outcome?: string };
const nodes = (node: UIComponentNode): UIComponentNode[] => [node, ...(node.children || []).flatMap(nodes)];

export async function runJourneys({ video }: { video: boolean }) {
  const pace = pacing(video);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  let output = resolve('.data/e2e', `${stamp}-${video ? 'video' : 'checks'}`);
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'cityside-video-'));
  const chapters: Chapter[] = [];
  const sessions = new Set<string>();
  const errors: string[] = [];
  let page: Page | undefined;
  let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let authorization = '';
  let current: CoreData | undefined;
  let start = performance.now();
  let chapter!: Chapter;
  let failure: Error | undefined;
  const elapsed = () => (performance.now() - start) / 1000;
  const hold = async (ms: number) => { if (ms) await delay(ms); };
  const check = (message: string) => { chapter.checks.push({ at: elapsed(), message }); console.log(`  PASS: ${message}`); };
  const caption = async (title: string, text: string) => {
    await page!.evaluate(({ title, text }) => {
      let banner = document.getElementById('e2e-recording-caption');
      if (!banner) {
        banner = document.createElement('div'); banner.id = 'e2e-recording-caption'; banner.setAttribute('aria-hidden', 'true');
        Object.assign(banner.style, { position: 'fixed', zIndex: '2147483647', top: '6px', left: '260px', right: '265px', padding: '7px 16px', borderRadius: '9px', background: '#173d51', color: 'white', font: '13px/1.5 system-ui', pointerEvents: 'none', boxShadow: '0 2px 8px #0002' });
        document.body.append(banner);
      }
      banner.replaceChildren();
      const strong = document.createElement('strong'); strong.textContent = title;
      const detail = document.createElement('div'); detail.textContent = text; detail.style.color = '#d9e7ed';
      banner.append(strong, detail);
    }, { title, text });
  };
  const shot = async (name: string) => { await page!.screenshot({ path: join(output, `${name}.png`), fullPage: false }); };
  const begin = async (id: string, title: string, description: string) => {
    if (chapter) { chapter.end = elapsed(); chapter.status = 'passed'; }
    chapter = { id, title, description, start: elapsed(), end: 0, status: 'running', checks: [] };
    chapters.push(chapter); console.log(`CHAPTER ${id}: ${title}`);
    await caption(`${id} · ${title}`, description); await hold(pace.chapter);
  };
  const idle = () => page!.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('button.new-chat'); return button && !button.disabled;
  });
  const readCore = async (response: Awaited<ReturnType<Page['waitForResponse']>>, id?: string) => {
    assert.equal(response.status(), 200, `Core ${new URL(response.url()).pathname} returned HTTP ${response.status()}`);
    const data = await response.json() as CoreData;
    assert.equal(data.success, true); assert.equal(data.outcome, 'SUCCEEDED');
    assert.equal(validateAGUISurface(data.surface).success, true, 'Returned surface must satisfy the runtime contract');
    if (id) assert.equal(data.surface.view.id, id);
    if (data.surface.view.type === 'SurfaceCard') await page!.locator(`[id="${data.surface.view.id}"]`).waitFor({ state: 'visible' });
    await idle();
    await page!.getByRole('complementary', { name: 'Service details', exact: true }).evaluate(element => { element.scrollTop = 0; });
    const visible = await page!.getByRole('complementary', { name: 'Service details', exact: true }).innerText();
    assert.doesNotMatch(visible, /\b(?:undefined|NaN)\b/, 'Visible service output must not contain missing-value placeholders');
    current = data; return data;
  };
  const post = async (path: string, action: () => Promise<unknown>, expectedId?: string) => {
    const [response] = await Promise.all([
      page!.waitForResponse(response => response.url() === `${environment!.coreUrl}${path}` && response.request().method() === 'POST'),
      action(),
    ]);
    return readCore(response, expectedId);
  };
  const service = async (name: string, id: string) => {
    const data = await post('/api/manual/prepare', () => page!.getByRole('button', { name, exact: true }).click(), id);
    assert.equal(data.inference?.provider, 'manual-service'); check(`${name} opened without a chat/model request`);
    await hold(pace.review); return data;
  };
  const confirm = async (action: string, expectedId: string) => {
    const node = nodes(current!.surface.view).find(node => node.onEvents?.some(event => event.payload.action === action));
    assert.ok(node && typeof node.properties?.label === 'string', `Expected offered action ${action}`);
    const button = page!.getByRole('button', { name: node.properties.label, exact: true });
    await button.scrollIntoViewIfNeeded(); await hold(pace.action);
    const previous = current!.surface.revision;
    const data = await post('/api/a2ui/action', () => button.click(), expectedId);
    assert.notEqual(data.surface.revision, previous); check(`${action} returned its asserted surface and a new revision`);
    await hold(pace.receipt); return data;
  };
  const payFromSurface=async(action:string,source='Cityside wallet')=>{
    await confirm(action,'payment_source_card');
    await page!.getByRole('radio').filter({hasText:source}).click();await hold(pace.review);
    await confirm('payment_surface_choose','payment_review_card');
    await confirm('payment_surface_authorize','payment_review_card');
    await confirm('payment_surface_execute','payment_receipt_card');
  };
  const account = () => page!.getByRole('combobox', { name: 'Current account', exact: true }).inputValue();
  const api = async (offset: number, path: string, status = 200) => {
    assert.ok(authorization, 'A real browser access token is required for independent result checks');
    const response = await fetch(`http://localhost:${environment!.corePort + offset}${path}`, { headers: { Authorization: authorization, 'X-Account-Id': await account() }, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, `Read-back ${path}`); return response.json() as Promise<any>;
  };
  const balance = async () => (await api(3, '/wallet/balance')).balanceMinor as number;
  const chat = async (text: string, id: string) => {
    await page!.getByRole('button', { name: 'New conversation', exact: true }).click();
    const input = page!.getByRole('textbox', { name: 'Message Rashid', exact: true });
    await input.fill(text); await hold(pace.action);
    await post('/api/a2ui/intent', () => page!.getByRole('button', { name: 'Send message', exact: true }).click(), id);
    await hold(pace.review);
  };
  try {
    environment = await startEnvironment();
    browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce',
      ...(video ? { recordVideo: { dir: scratch, size: { width: 1600, height: 1000 } } } : {}),
    });
    page = await context.newPage(); page.setDefaultTimeout(45000); start = performance.now();
    page.on('pageerror', () => errors.push('Unexpected browser script error'));
    page.on('request', request => {
      if (!request.url().startsWith(environment!.coreUrl)) return;
      const bearer = request.headers().authorization; if (bearer) authorization = bearer;
      if (request.method() === 'POST') {
        try { const body = request.postDataJSON(); if (typeof body.sessionId === 'string') sessions.add(body.sessionId); } catch { /* Non-JSON requests are not application actions. */ }
      }
    });
    await page.goto(environment.appUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).waitFor();
    await begin('01', 'Sign in and choose an account', 'Real local Keycloak PKCE · isolated SQLite data · simulated services and money');
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
    await page.locator('#username').fill('demo-commuter');
    await page.locator('#password').fill('demo123');
    await hold(pace.action); await page.locator('#kc-login').click();
    await page.getByRole('combobox', { name: 'Current account', exact: true }).waitFor(); await idle();
    await caption('01 · Signed in as Alex Commuter', 'Personal and household accounts are separately owned. No real government or payment systems.');
    const personal = await account(); assert.ok(personal.startsWith('acc_'));
    check('Real PKCE sign-in reached the authenticated account workspace'); await hold(pace.review); await shot('01-signed-in');

    await begin('02', 'Wallet: review, cancel and top up', 'Review first. Cancelled approvals cannot be replayed. A confirmed top-up changes the ledger once.');
    const offered = await service('Payments', 'wallet_card'); const initial = await balance(); assert.equal(initial, 150000);
    const altered = await fetch(`${environment.coreUrl}/api/a2ui/action`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: offered.surface.sessionId, accountId: personal, surfaceRevision: offered.surface.revision, action: 'topup_wallet', payload: { amount: 51 } }) });
    assert.equal(altered.status, 403); assert.equal(await balance(), initial); check('Changing the offered top-up amount is rejected with HTTP 403 and no debit');
    await post('/api/a2ui/cancel', () => page!.getByRole('button', { name: 'Cancel approval', exact: true }).click());
    await page.getByText('Approval cancelled. No service action was started.', { exact: true }).last().waitFor();
    assert.equal(await page.getByRole('button', { name: /Quick Top-Up/ }).count(), 0);
    const replay = await fetch(`${environment.coreUrl}/api/a2ui/action`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: offered.surface.sessionId, accountId: personal, surfaceRevision: offered.surface.revision, action: 'topup_wallet', payload: { amount: 50 } }) });
    assert.equal(replay.status, 409); assert.equal(await balance(), initial); check('Cancelled approval replay rejected with HTTP 409; balance unchanged');
    await caption('02 · Approval cancelled', 'The confirmation button is gone. Server replay rejected. Balance unchanged.'); await hold(pace.receipt); await shot('02-cancelled');
    const cardResponse=await fetch(`${environment.coreUrl}/api/payments/methods`,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({accountId:personal,requestKey:crypto.randomUUID(),preset:'approved',nickname:'Journey saved card'})});assert.equal(cardResponse.status,200);
    const topupOffer = await service('Payments', 'wallet_card'); await payFromSurface('topup_wallet','Journey saved card');
    const duplicate = await fetch(`${environment.coreUrl}/api/a2ui/action`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: topupOffer.surface.sessionId, accountId: personal, surfaceRevision: topupOffer.surface.revision, action: 'topup_wallet', payload: { amount: 50 } }) });
    assert.equal(duplicate.status, 409); check('Replaying the consumed top-up approval is rejected with HTTP 409');
    assert.equal(await balance(), initial + 5000); assert.equal((await api(3, '/wallet/transactions')).transactions.length, 1); check('Exactly one 50 AED top-up appears in the independently read ledger');

    await begin('03', 'Parking: select, activate and extend', 'Review the account-owned vehicle and zone. Confirm two hours, then review the extension receipt.');
    await service('Mobility', 'parking_selection_card'); const beforeParking = await balance();
    const option = nodes(current!.surface.view).find(node => node.type === 'ChoiceGroup')!.properties!.options!.find((option: { id: string }) => option.id === 'zone_302a');
    await page.locator('.ag-choice-item').filter({ hasText: option!.title }).click(); await hold(pace.action);
    await confirm('activate_parking', 'parking_active_card');
    assert.equal(await balance(), beforeParking - 800);
    const meter = (await api(1, '/mobility/parking/active')).meters[0]; assert.equal(meter.zoneId, 'zone_302a'); assert.equal(meter.durationHours, 2);
    await shot('03-parking-active'); await confirm('extend_parking', 'parking_extended_card');
    const extended = (await api(1, '/mobility/parking/active')).meters.find((row: { ticketId: string }) => row.ticketId === meter.ticketId);
    assert.equal(extended.durationHours, 3); assert.equal(await balance(), beforeParking - 1200); check('Provider state shows the same ticket extended to three hours; exact 12 AED debit');

    await begin('04', 'Utilities: review and settle a fresh bill', 'Fresh isolated DEWA bill. Review meter data and line items before paying from the simulated wallet.');
    await service('Utilities', 'utilities_overview_card'); const bill = (await api(2, '/utilities/bill')).bill; assert.equal(bill.status, 'UNPAID'); const beforeBill = await balance();
    await payFromSurface('pay_utilities_bill'); assert.equal((await api(2, '/utilities/bill')).bill.status, 'PAID'); assert.ok((await page.getByRole('complementary', { name: 'Service details', exact: true }).innerText()).includes(bill.premiseId)); assert.equal(await balance(), beforeBill - Math.round(bill.totalAmount * 100)); check('Bill is PAID in the provider and wallet matches the authoritative bill amount'); await shot('04-utility-receipt');

    await begin('05', 'Telecom: review a subscription and pay its bill', 'Etisalat is a simulator. Confirm only the offered provider and bill; verify settlement independently.');
    await service('Telecom', 'telecom_overview'); const telecom = (await api(6, '/telecom/etisalat/bills')).bills[0]; const beforeTelecom = await balance();
    await payFromSurface('pay_telecom_bill'); assert.equal((await api(6, '/telecom/etisalat/bills')).bills[0].status, 'PAID'); assert.equal(await balance(), beforeTelecom - telecom.amountMinor); check('Selected Etisalat bill is paid once for its exact amount'); await shot('05-telecom-receipt');

    await begin('06', 'Traffic fines: review and settle', 'Natural-language request through the same guarded core. Read violations and discounts before confirmation.');
    await chat('Check my police traffic fines', 'police_fines_card'); const fines = await api(3, '/fines/check'); const beforeFines = await balance(); assert.ok(fines.count > 0);
    await payFromSurface('pay_police_fines'); assert.equal((await api(3, '/fines/check')).count, 0); assert.equal(await balance(), beforeFines - Math.round(fines.totalPayable * 100)); check('No unpaid fines remain and the exact payable amount was debited'); await shot('06-fines-receipt');
    const paymentSetup = await fetch(`${environment.coreUrl}/api/payments/overview?accountId=${personal}`, { headers: { Authorization: authorization } }); assert.equal(paymentSetup.status,200);
    assert.ok((await paymentSetup.json()).candidates.some((candidate: {provider:string;reference:string})=>candidate.provider==='police'&&candidate.reference===fines.fines[0].plateNumber)); check('Owned vehicle remains linkable after every fine is paid');

    await begin('07', 'Ride: choose and confirm a real demo booking', 'Chat prepares a proposal. The receipt carries a real provider booking ID; unknown tracking IDs must fail.');
    await chat('Find me a cab ride to Downtown Dubai', 'ride_card');
    await confirm('book_ride', 'ride_confirmed_card'); const bookingId = nodes(current!.surface.view).find(node => node.id === 'booking_id')!.properties!.value;
    const tracking = await api(1, `/rides/track/${bookingId}`); assert.equal(tracking.booking.bookingId, bookingId); await api(1, '/rides/track/unknown-booking', 404); check('Actual booking tracks correctly; an invented booking returns HTTP 404'); await shot('07-ride-receipt');

    await begin('08', 'Dining: choose a meal and verify the order', 'A separate service journey with an account-owned persisted order and a traceable order reference.');
    await chat('Find pizza restaurants for dinner', 'food_card'); await confirm('order_food', 'food_confirmed_card');
    const orderId = nodes(current!.surface.view).find(node => node.id === 'order_id')!.properties!.value;
    assert.equal((await api(2, `/orders/track/${orderId}`)).order.orderId, orderId); await api(2, '/orders/track/unknown-order', 404); check('Actual order tracks correctly; an invented order returns HTTP 404'); await shot('08-food-receipt');
    const diningSurface = current!.surface;

    await begin('09', 'Move in: activate a reviewed tenancy plan', 'Read the proposal before confirmation. DLD, utility connection and residential permit records must agree.');
    await service('Housing', 'movein_card');
    assert.equal(environment.providerState('dewa', personal, 'connection'), undefined);
    assert.equal(environment.providerState('rta', personal, 'permit'), undefined);
    await confirm('confirm_movein', 'movein_confirmed_card');
    assert.equal(environment.providerState('dewa', personal, 'connection').status, 'CONNECTED_ACTIVE');
    assert.equal(environment.providerState('rta', personal, 'permit').status, 'ISSUED');
    assert.equal(environment.providerState('dld', personal, 'move-in').ejariContract, (await api(4, '/housing/ejari')).contract.contractNumber);
    check('Only confirmed move-in created matching persistent tenancy, connection and permit records'); await shot('09-movein-receipt');

    await begin('10', 'Unified checkout: avoid paying settled bills twice', 'The earlier utility bill and fines are already settled. Only the remaining Salik recharge may debit the wallet.');
    await chat('Pay my DEWA electricity bill, settle my police fines and recharge my Salik tag', 'smartcity_composite_card');
    assert.equal(nodes(current!.surface.view).find(node => node.id === 'metric_comp_total')!.properties!.value, '100.00 AED');
    check('Review quote excludes already-paid bills and matches the remaining 100 AED effect');
    const beforeUnified = await balance(); const salik = (await api(1, '/mobility/salik/balance')).balance;
    await payFromSurface('confirm_smartcity_checkout');
    assert.equal(await balance(), beforeUnified - 10000); assert.equal((await api(1, '/mobility/salik/balance')).balance, salik + 100);
    assert.equal((await api(2, '/utilities/bill')).bill.status, 'PAID'); assert.equal((await api(3, '/fines/check')).count, 0);
    check('Already-settled DEWA/fines were not charged again; only 100 AED recharged Salik'); await shot('10-unified-receipt');

    await begin('11', 'Switch accounts and restore the conversation', 'Household funds stay separate. Return to Personal, then reload the saved dining receipt and transcript.');
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    await page.getByRole('button', { name: 'Find pizza restaurants for dinner', exact: true }).click();
    await page.locator('#food_confirmed_card').waitFor(); await idle();
    check('Saved conversation history opens the original dining receipt without creating another order');
    const finalPersonal = await balance(); const savedSurface = diningSurface;
    const selector = page.getByRole('combobox', { name: 'Current account', exact: true });
    await selector.selectOption({ label: 'Household account' });
    await page.waitForFunction(id => (document.querySelector('select[aria-label="Current account"]') as HTMLSelectElement)?.value !== id, personal);
    await idle(); assert.equal(await balance(), 150000); assert.equal(await page.locator('#food_confirmed_card').count(), 0); check('Household account has separate fresh funds and no personal receipt'); await hold(pace.review); await shot('11-household');
    await selector.selectOption(personal); await page.locator('#food_confirmed_card').waitFor(); await idle(); assert.equal(await balance(), finalPersonal);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#food_confirmed_card').waitFor(); await idle();
    const saved = await fetch(`${environment.coreUrl}/api/sessions/${savedSurface.sessionId}`, { headers: { Authorization: authorization } }); assert.equal(saved.status, 200);
    const restored = await saved.json(); assert.equal(restored.surface.revision, savedSurface.revision); assert.ok(restored.messages.some((message: { role: string }) => message.role === 'user'));
    check('Personal receipt, revision, transcript and balance survive account switch and reload'); await caption('11 · Conversation restored', 'The saved receipt and transcript are restored without replaying the order.'); await hold(pace.receipt); await shot('11-restored');

    await begin('12', 'Sign out and return to the login screen', 'The private workspace closes. All services, balances and receipts in this recording are simulated.');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Current account', exact: true }).count(), 0); check('Signed-out screen has no private account selector or receipt');
    assert.deepEqual(errors, []); await caption('All 12 journeys verified', 'Real local identity, REST providers, SQLite and Redis · deterministic replies · no real payments'); await hold(pace.end); await shot('12-complete');
    chapter.end = elapsed(); chapter.status = 'passed';
  } catch (error) {
    failure = error instanceof Error ? error : new Error('E2E execution failed');
    if (chapter!) { chapter.status = 'failed'; chapter.end = elapsed(); }
    if (page && !page.isClosed()) await shot('failure').catch(() => {});
  } finally {
    const recording = page?.video();
    try {
      await context?.close();
      // saveAs needs the browser connection even after the context finalized video.
      if (recording) await recording.saveAs(join(output, failure ? 'failed.webm' : 'cityside-e2e.webm'));
    } catch (error) {
      failure ||= error instanceof Error ? error : new Error('Video finalization failed');
      if (chapter) chapter.status = 'failed';
    }
    await browser?.close();
    if (environment) {
      const { redisSessions } = await import('../../services/agent-core/src/session-store.ts');
      const store = redisSessions()!;
      for (const sessionId of sessions) {
        try {
          const raw = await store.client.get(`${store.prefix}session:${sessionId}`);
          if (!raw) continue;
          const row = JSON.parse(raw);
          const { discardRuntime } = await import('../../services/agent-core/src/langgraph/runtime.ts');
          await discardRuntime(row.state); await store.remove(sessionId, row.owner);
        } catch { console.error('A recording-owned session will expire by its short TTL.'); }
      }
      await environment.cleanup();
    }
    await rm(scratch, { recursive: true, force: true });
  }
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  const report = { status: failure ? 'failed' : 'passed', createdAt: new Date().toISOString(), source, dirty, video, pacing: pace, chapters,
    scope: 'Isolated local provider/application SQLite; real local Keycloak and Redis; deterministic replies; no real agencies, UAE PASS or money.',
    error: failure ? failure.message.replace(/Bearer\s+\S+/g, 'Bearer [redacted]') : undefined };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  if (failure) { console.error(`E2E failed; diagnostics at ${output}. Latest successful recording was preserved.`); throw failure; }
  if (video && pace.scale > 0) output = await publishRecording(output, report);
  else await writeFile(join(output, 'report.md'), `# Browser E2E checks\n\n${report.scope}\n\n${chapters.map(chapter => `- PASS: ${chapter.title} (${chapter.checks.length} assertions)`).join('\n')}\n`);
  console.log(`PASS: all ${chapters.length} browser journeys. Artifacts: ${output}`);
}
