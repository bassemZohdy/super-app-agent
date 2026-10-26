/** Records the readable journeys (QA-07): `npm run record:journeys`, which also publishes them if every one passes. */
import { defineConfig } from 'playwright/test';
import { artifactRoots } from './artifact-roots.ts';

const roots = artifactRoots(process.env.E2E_SUITE || 'recordings');
export default defineConfig({
  testDir: './recordings',
  testMatch: '**/*.spec.ts',
  outputDir: roots.results,
  reporter: [['list']],
  workers: 1, fullyParallel: false, retries: 0, timeout: 240_000, expect: { timeout: 45_000 },
  use: { channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: { mode: 'on', size: { width: 1280, height: 800 } }, viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'recording' }],
});
