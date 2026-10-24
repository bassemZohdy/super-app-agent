import { delegationAppUrl } from './endpoints.ts';
/** Paced, asserted real demo UI recording. No traces, network dumps or token output. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
const url = delegationAppUrl;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join('docs/recordings/delegation/runs', stamp);
await mkdir(dir, { recursive: true });
const review = Number(process.env.DELEGATION_REVIEW_MS || 6000), receipt = Number(process.env.DELEGATION_RECEIPT_MS || 8000);
assert.ok(Number.isFinite(review) && review >= 1000 && review <= 30000 && Number.isFinite(receipt) && receipt >= 1000 && receipt <= 30000);
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, recordVideo: { dir, size: { width: 1440, height: 1050 } } });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const hold = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const chapters: { title: string; elapsedSeconds: number }[] = [];
const started = Date.now();
function chapter(title: string) { chapters.push({ title, elapsedSeconds: (Date.now() - started) / 1000 }); console.log(`Verified chapter: ${title}`); }
let successful = false;
try {
  await page.goto(url); await page.getByRole('button', { name: 'Sign in with Keycloak' }).click();
  await page.locator('#username').fill('demo-commuter'); await page.locator('#password').fill('demo123'); await page.locator('#kc-login').click();
  await page.getByRole('button', { name: 'Delegated access', exact: true }).waitFor();
  chapter('Sign in and open delegated access'); await hold(review);
  await page.getByRole('button', { name: 'Delegated access', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Delegated access', exact: true });
  await panel.getByRole('button', { name: 'Allow up to 3 wallet balance checks' }).waitFor();
  chapter('Review actor, account, operation and five-minute consent'); await hold(review);
  await panel.getByRole('button', { name: 'Allow up to 3 wallet balance checks' }).click();
  const row = panel.getByRole('article').first();
  await row.getByText('Active · 0/3', { exact: false }).waitFor();
  chapter('Explicitly approve bounded wallet reads'); await hold(review);
  await row.getByRole('button', { name: 'Run approved operation' }).click();
  await panel.getByText('Approved operation completed.', { exact: false }).waitFor();
  await row.getByText('Active · 1/3', { exact: false }).waitFor();
  chapter('Broker exchanges assertion and provider authorizes exact read'); await hold(receipt);
  await row.getByRole('button', { name: 'View audit history' }).click();
  await panel.getByLabel('Delegation audit history').filter({ hasText: 'execution.authorized' }).waitFor();
  chapter('Inspect consent-to-effect audit'); await hold(review);
  await row.getByRole('button', { name: 'Revoke consent' }).click();
  await row.getByText('Revoked · 1/3', { exact: false }).waitFor();
  assert.equal(await row.getByRole('button', { name: 'Run approved operation' }).isDisabled(), true);
  chapter('Withdraw consent and verify execution is disabled'); await hold(receipt);
  await panel.getByRole('button', { name: 'Approve one AED 1 demo wallet credit' }).click();
  await row.getByText('Active · 0/1', { exact: false }).waitFor();
  chapter('Explicitly approve one exact AED 1 synthetic credit'); await hold(review);
  await row.getByRole('button', { name: 'Run approved operation' }).click();
  await row.getByText('Active · 1/1', { exact: false }).waitFor();
  assert.equal(await row.getByRole('button', { name: 'Run approved operation' }).isDisabled(), true);
  chapter('Execute once and verify the grant limit blocks another run'); await hold(receipt);
  await row.getByRole('button', { name: 'Revoke consent' }).click();
  await row.getByText('Revoked · 1/1', { exact: false }).waitFor();
  chapter('Revoke the completed write grant'); await hold(review);
  await panel.screenshot({ path: join(dir, 'revoked.png') });
  successful = true;
} catch (error) {
  await page.screenshot({ path: join(dir, 'failure.png') }); throw error;
} finally {
  // Each created consent expires after five minutes even if the browser fails.
  await context.close();
  const video = await page.video()?.path(); await browser.close();
  await writeFile(join(dir, 'chapters.json'), JSON.stringify({ successful, reviewMs: review, receiptMs: receipt, chapters, synthetic: true }, null, 2));
  if (successful && video) {
    const videoSource = `runs/${stamp}/${basename(video)}`;
    await writeFile('docs/recordings/delegation/index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cityside delegated access demo</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px;color:#24495f}video{width:100%}</style><h1>Delegated access — synthetic local demo</h1><p>Real Keycloak login, explicit bounded consent, broker/provider authorization, audit and withdrawal. Six-second reviews and eight-second result holds. This recording is demonstration evidence.</p><video controls preload="metadata" src="${videoSource}"></video><p><a href="../index.html">Other demo recordings</a></p></html>\n`);
    console.log(`PASS: paced delegation recording saved to ${dir}`);
  }
}
