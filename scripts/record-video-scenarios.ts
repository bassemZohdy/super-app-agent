/**
 * SuperApp Agent - Visual End-to-End Life Scenarios Video Recorder
 * Uses Playwright + Headless Google Chrome to record a high-definition .webm video
 * of the React Host Shell executing real-world multi-agent life journeys.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

console.log('================================================================');
console.log('🎬 SUPERAPP AGENT: STARTING VISUAL E2E VIDEO FLIGHT RECORDER');
console.log('================================================================\n');

// 1. Boot Backend Microservices & Agent Core
console.log('📦 [1/4] Booting backend microservices and Agent Core...');

process.env.PORT = '4001';
const { server: rideServer } = await import('../services/service-ride/src/index.ts');
await new Promise<void>((resolve) => rideServer.listen(4001, '0.0.0.0', resolve));

process.env.PORT = '4002';
const { server: foodServer } = await import('../services/service-food/src/index.ts');
await new Promise<void>((resolve) => foodServer.listen(4002, '0.0.0.0', resolve));

process.env.PORT = '4003';
const { server: walletServer } = await import('../services/service-wallet/src/index.ts');
await new Promise<void>((resolve) => walletServer.listen(4003, '0.0.0.0', resolve));

process.env.PORT = '4004';
const { server: catalogServer } = await import('../services/service-catalog/src/index.ts');
await new Promise<void>((resolve) => catalogServer.listen(4004, '0.0.0.0', resolve));

process.env.PORT = '4005';
const { server: profileServer } = await import('../services/service-profile/src/index.ts');
await new Promise<void>((resolve) => profileServer.listen(4005, '0.0.0.0', resolve));

process.env.PORT = '4000';
const { server: coreServer } = await import('../services/agent-core/src/index.ts');
await new Promise<void>((resolve) => coreServer.listen(4000, '0.0.0.0', resolve));

console.log('✅ Backend mesh ready (4000, 4001, 4002, 4003, 4004, 4005)');

// 2. Serve React Production Build on Port 3000
console.log('🌐 [2/4] Serving React 18 Host Shell on http://localhost:3000...');
const distDir = path.resolve(process.cwd(), 'apps/shell-react/dist');

const staticServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let filePath = path.join(distDir, url.pathname);

  if (url.pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise<void>((resolve) => staticServer.listen(3000, '0.0.0.0', resolve));
console.log('✅ Frontend static server running on http://localhost:3000');

// 3. Launch Google Chrome with Video Recording
const videoOutputDir = path.resolve(process.cwd(), 'docs/recordings/videos');
fs.mkdirSync(videoOutputDir, { recursive: true });

console.log('🎥 [3/4] Launching Google Chrome with 1280x720 video recording...');
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: {
    dir: videoOutputDir,
    size: { width: 1280, height: 720 },
  },
});

const page = await context.newPage();

// Helper for human-like pauses
const pause = (ms: number) => page.waitForTimeout(ms);

try {
  console.log('🎬 [4/4] Executing and recording user life journeys in the browser...');

  // Navigate to Host Shell
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await pause(1500);

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Smart Mobility - RTA Smart Parking Meter Activation & Extension
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 1: Smart Mobility (RTA Parking in Downtown Zone 302A)');
  const parkChip = page.locator('button:has-text("Park in Zone 302A & Find EV Charger")');
  await parkChip.click();

  // Wait for LangGraph reasoning & AG-UI Parking Selection Card
  await page.waitForSelector('.ag-surface-card#parking_selection_card', { timeout: 8000 });
  await pause(2000);

  // Activate parking meter
  const activateParkingBtn = page.locator('button:has-text("Activate Smart Parking Meter")');
  await activateParkingBtn.click();

  // Wait for Active Parking Meter Card
  await page.waitForSelector('.ag-surface-card#parking_active_card', { timeout: 8000 });
  await pause(2000);

  // Extend parking meter
  const extendParkingBtn = page.locator('button:has-text("Extend Parking")');
  if (await extendParkingBtn.count() > 0) {
    await extendParkingBtn.first().click();
    await page.waitForSelector('.ag-surface-card#parking_extended_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Smart Utilities - DEWA Telemetry & Bill Settlement
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 2: Smart Utilities (DEWA Electricity & Water Settlement)');
  const promptInput = page.locator('input[placeholder="Ask the concierge..."]');
  await promptInput.click();
  await promptInput.fill('Check my DEWA electricity and water bill for premise DEWA-201948201');
  await pause(600);

  const sendBtn = page.locator('button:has-text("Send")');
  await sendBtn.click();

  await page.waitForSelector('.ag-surface-card#utilities_overview_card', { timeout: 8000 });
  await pause(2000);

  // Settle DEWA Bill
  const payDewaBtn = page.locator('button:has-text("Settle DEWA Bill via DubaiPay")');
  if (await payDewaBtn.count() > 0) {
    await payDewaBtn.first().click();
    await page.waitForSelector('.ag-surface-card#utilities_paid_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Citizen Safety - Dubai Police Traffic Fines Clearance
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 3: Citizen Safety (Dubai Police Fines Settlement)');
  await promptInput.click();
  await promptInput.fill('Check my Dubai Police traffic radar fines for plate Dubai B-74892');
  await pause(600);
  await sendBtn.click();

  await page.waitForSelector('.ag-surface-card#police_fines_card', { timeout: 8000 });
  await pause(2000);

  // Settle Police Fines with 10% Early Discount
  const settleFinesBtn = page.locator('button:has-text("Settle Fines via DubaiPay")');
  if (await settleFinesBtn.count() > 0) {
    await settleFinesBtn.first().click();
    await page.waitForSelector('.ag-surface-card#police_fines_settled_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Smart Housing - Ejari Move-In Autonomous Golden Path
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 4: Smart Housing (Ejari Move-In Golden Path)');
  const moveinChip = page.locator('button:has-text("Connect Ejari & Utilities for Unit 1402")');
  await moveinChip.click();

  await page.waitForSelector('.ag-surface-card#movein_card', { timeout: 8000 });
  await pause(2000);

  // Confirm Move-In Golden Path
  const confirmMoveInBtn = page.locator('button:has-text("Activate Smart Meter & Move-In Golden Path")');
  if (await confirmMoveInBtn.count() > 0) {
    await confirmMoveInBtn.first().click();
    await page.waitForSelector('.ag-surface-card#movein_confirmed_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Unified Living - Multi-Agency Reconciliation (DubaiPay)
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 5: Unified Living Settlement (DEWA + Police + Salik)');
  await promptInput.click();
  await promptInput.fill('Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag');
  await pause(600);
  await sendBtn.click();

  await page.waitForSelector('.ag-surface-card#smartcity_composite_card', { timeout: 8000 });
  await pause(2000);

  // Authorize Unified DubaiPay Settlement
  const confirmUnifiedBtn = page.locator('button:has-text("Authorize Unified DubaiPay Settlement")');
  if (await confirmUnifiedBtn.count() > 0) {
    await confirmUnifiedBtn.first().click();
    await page.waitForSelector('.ag-surface-card#composite_success_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: UAE PASS Citizen Identity & Asset Vault
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 6: UAE PASS National Identity & Digital Asset Vault');
  const profileChip = page.locator('button:has-text("My UAE PASS Citizen Profile")');
  if (await profileChip.count() > 0) {
    await profileChip.first().click();
    await page.waitForSelector('.ag-surface-card#profile_card', { timeout: 8000 });
    await pause(2000);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Federated Microfrontend Mini-Apps Switching
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 7: Smart City Polyglot Mini-App Workspaces');
  // Switch to Mobility Mini-App Tab
  const rideTab = page.locator('header button:has-text("SMART MOBILITY")');
  if (await rideTab.count() > 0) {
    await rideTab.click();
    await pause(1500);
  }

  // Switch to Utilities Mini-App Tab
  const foodTab = page.locator('header button:has-text("UTILITIES (DEWA)")');
  if (await foodTab.count() > 0) {
    await foodTab.click();
    await pause(1500);
  }

  // Switch to Citizen Pay Mini-App Tab
  const walletTab = page.locator('header button:has-text("CITIZEN PAY")');
  if (await walletTab.count() > 0) {
    await walletTab.click();
    await pause(1500);
  }

  // Return to Autonomous AI Concierge
  const conciergeTab = page.locator('header button:has-text("AI CONCIERGE")');
  if (await conciergeTab.count() > 0) {
    await conciergeTab.click();
    await pause(2000);
  }

  console.log('✅ All visual smart city life scenarios successfully enacted in browser!');
} finally {
  const videoObj = page.video();
  await page.close();
  await context.close();
  await browser.close();

  // Close HTTP servers
  staticServer.close();
  coreServer.close();
  rideServer.close();
  foodServer.close();
  walletServer.close();
  catalogServer.close();
  profileServer.close();

  if (videoObj) {
    const rawPath = await videoObj.path();
    const finalVideoPath = path.resolve(videoOutputDir, 'superapp-e2e-scenarios.webm');
    fs.copyFileSync(rawPath, finalVideoPath);
    const stats = fs.statSync(finalVideoPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    console.log('\n================================================================');
    console.log(`🎥 VIDEO RECORDING GENERATED SUCCESSFULLY!`);
    console.log(`📁 File: ${finalVideoPath}`);
    console.log(`📦 Size: ${sizeMb} MB (${stats.size} bytes)`);
    console.log(`🎞️ Format: WebM (VP8/VP9, 1280x720 30fps)`);
    console.log('================================================================\n');
  }
}
