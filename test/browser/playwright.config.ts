/** Playwright Test runner for the browser journeys (QA-09). Journeys live in folders named for the resident's intent; every
 *  test gets a fresh browser context, traces are kept on failure, and each suite writes to its own artifact root.
 *  Run with `npm run test:browser`. The Compose stack must be up (`npm run demo:up`). */
import { defineConfig } from 'playwright/test';
import { artifactRoots } from './artifact-roots.ts';

const roots = artifactRoots();

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // The readable recordings run with video on through recordings.config.ts (npm run record:journeys), not with the suite.
  testIgnore: '**/recordings/**',
  outputDir: roots.results,
  reporter: [['list'], ['html', { outputFolder: roots.report, open: 'never' }]],
  // The journeys share one running stack and its accounts, so they run one at a time; isolation is per browser context.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  use: { channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
});
