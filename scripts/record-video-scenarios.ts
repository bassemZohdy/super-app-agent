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
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await pause(1500);

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Commuter Morning Rush (Ride Booking with EV Personalization & Telemetry)
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 1: Commuter Morning Rush (Ride to SFO Airport)');
  const promptInput = page.locator('input[placeholder="Ask the concierge..."]');
  await promptInput.click();
  await promptInput.fill('I need a cab to SFO Airport Terminal 2');
  await pause(800);

  const sendBtn = page.locator('button:has-text("Send")');
  await sendBtn.click();

  // Wait for LangGraph reasoning & AG-UI Ride Card
  await page.waitForSelector('.ag-surface-card#ride_card', { timeout: 8000 });
  await pause(2000);

  // Select Tesla Model Y EV Option
  const teslaChoice = page.locator('.ag-choice-item:has-text("Tesla Model Y")');
  if (await teslaChoice.count() > 0) {
    await teslaChoice.first().click();
    await pause(1000);
  }

  // Click "Confirm & Dispatch Driver"
  const confirmRideBtn = page.locator('button:has-text("Confirm & Dispatch Driver")');
  await confirmRideBtn.click();

  // Wait for Driver Dispatched Confirmation Card with MapViewer & Telemetry
  await page.waitForSelector('.ag-surface-card#ride_confirmed_card', { timeout: 8000 });
  await pause(2500);

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Evening Dinner Delivery (Food Discovery with Dietary Badges)
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 2: Evening Dinner Delivery (Pizza Dining)');
  const foodChip = page.locator('button:has-text("Order woodfired pizza for dinner")');
  await foodChip.click();

  await page.waitForSelector('.ag-surface-card#food_card', { timeout: 8000 });
  await pause(2000);

  // Confirm Food Order
  const orderFoodBtn = page.locator('button:has-text("Order Dish & Dispatch to Kitchen")');
  if (await orderFoodBtn.count() > 0) {
    await orderFoodBtn.first().click();
    await page.waitForSelector('.ag-surface-card#food_confirmed_card', { timeout: 8000 });
    await pause(2500);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Zero-Trust Wallet Management (Balance, Gold VIP Badge & Top-Up)
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 3: Digital Wallet Management & Instant Reload');
  const walletChip = page.locator('button:has-text("Check wallet balance")');
  await walletChip.click();

  await page.waitForSelector('.ag-surface-card#wallet_card', { timeout: 8000 });
  await pause(2000);

  // Click "+$50 Quick Top Up"
  const topupBtn = page.locator('button:has-text("Quick Top-Up")');
  if (await topupBtn.count() > 0) {
    await topupBtn.first().click();
    await page.waitForSelector('.ag-surface-card#wallet_topup_card', { timeout: 8000 });
    await pause(2500);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Composite Multi-Agent Orchestration (Ride + Food + Wallet HITL)
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 4: Composite Multi-Domain Orchestration');
  const compositeChip = page.locator('button:has-text("Book ride to Downtown and order pizza")');
  await compositeChip.click();

  await page.waitForSelector('.ag-surface-card#composite_orchestrator_card', { timeout: 8000 });
  await pause(2500);

  // Click Human-In-The-Loop Confirmation Button
  const hitlBtn = page.locator('button:has-text("Authorize Both & Pay")');
  if (await hitlBtn.count() > 0) {
    await hitlBtn.first().click();
    await page.waitForSelector('.ag-surface-card#composite_success_card', { timeout: 8000 });
    await pause(2500);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: User Profile & Preferences Overview
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 5: User Profile & Dynamic Preferences');
  const profileChip = page.locator('button:has-text("My Profile & Preferences")');
  if (await profileChip.count() > 0) {
    await profileChip.first().click();
    await page.waitForSelector('.ag-surface-card#profile_card', { timeout: 8000 });
    await pause(2500);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Federated Microfrontend Mini-Apps Switching
  // ---------------------------------------------------------------------------
  console.log('   ▶ Recording Scenario 6: Microfrontend Mini-App Workspaces');
  // Switch to Ride Mini-App Tab
  const rideTab = page.locator('header button:has-text("RIDE")');
  await rideTab.click();
  await pause(1500);

  // Switch to Food Mini-App Tab
  const foodTab = page.locator('header button:has-text("FOOD")');
  await foodTab.click();
  await pause(1500);

  // Switch to Wallet Mini-App Tab
  const walletTab = page.locator('header button:has-text("WALLET")');
  await walletTab.click();
  await pause(1500);

  // Return to Autonomous Concierge
  const conciergeTab = page.locator('header button:has-text("CONCIERGE")');
  await conciergeTab.click();
  await pause(2000);

  console.log('✅ All visual life scenarios successfully enacted in browser!');
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
