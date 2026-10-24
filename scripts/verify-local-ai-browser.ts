/** Uses generated audio as a fake device in an isolated Chrome, never the physical mic. */
import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.LOCAL_AI_APP_URL || 'http://localhost:3000';
assert.ok(['http://localhost:3000', 'http://127.0.0.1:3000'].includes(base), 'Use the local React demo.');
const source = resolve('.data/local-ai/dictation-source.wav');
await access(source); // npm run local-ai:verify generates this original synthetic fixture.
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${source}`,
] });
let currentPage: import('playwright').Page | undefined;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
  // Wait for the native recorder, rather than measuring from the permission UI.
  await context.addInitScript(() => {
    const original = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(timeslice?: number) {
      this.addEventListener('start', () => { (window as any).__localCaptureReady = true; }, { once: true });
      return original.call(this, timeslice);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      this.addEventListener('playing', () => { (window as any).__localAudioPlayed = true; }, { once: true });
      return play.call(this);
    };
  });
  const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(60000);
  let intents = 0; const speech: number[] = [];
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/a2ui/intent') intents++; });
  page.on('response', r => { if (new URL(r.url()).pathname === '/api/a2ui/tts') speech.push(r.status()); });
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in with Keycloak', exact: true }).click();
  await page.locator('#username').fill('demo-commuter'); await page.locator('#password').fill('demo123'); await page.locator('#kc-login').click();
  await page.getByRole('combobox', { name: 'Current account', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Conversation settings', exact: true }).click();
  await page.getByText('Local open-source speech is ready.', { exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('combobox', { name: 'Voice preset', exact: true }).locator('option').allTextContents(), ['Jasper', 'Bruno', 'Hugo', 'Luna']);
  await page.getByRole('combobox', { name: 'Voice preset', exact: true }).selectOption('Luna');
  const preview = page.waitForResponse(r => new URL(r.url()).pathname === '/api/a2ui/tts');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  assert.equal((await preview).status(), 200);
  await page.waitForFunction(() => (window as any).__localAudioPlayed === true);
  await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
  await mkdir('docs/reports/assets', { recursive: true });
  await page.screenshot({ path: 'docs/reports/assets/local-ai-settings.png' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const transcript = page.waitForResponse(r => new URL(r.url()).pathname === '/api/voice/transcribe').then(r => ({ response: r }), e => ({ error: e }));
  await page.getByRole('button', { name: 'Use microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).waitFor();
  await page.waitForFunction(() => (window as any).__localCaptureReady === true);
  await page.waitForTimeout(4000); // Deliberate capture window for the synthetic spoken phrase.
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
  const outcome = await transcript;
  if ('error' in outcome) throw outcome.error;
  assert.equal(outcome.response.status(), 200);
  await page.waitForFunction(() => /wallet|balance/i.test((document.querySelector('textarea') as HTMLTextAreaElement)?.value || ''));
  assert.match(await page.getByRole('textbox', { name: 'Message Rashid' }).inputValue(), /wallet|balance/i);
  assert.equal(intents, 0, 'Dictation must never submit a message or execute a service action.');
  await mkdir('docs/reports/assets', { recursive: true });
  await page.screenshot({ path: 'docs/reports/assets/local-ai-draft.png' });
  console.log('PASS: real Chrome fake-device capture → local Whisper → editable draft; zero intent requests');
  console.log('PASS: four presets, alternate-voice preview HTTP 200, native audio playing and stop controls; no physical microphone used');
  assert.deepEqual(speech, [200]);
} catch (error) {
  await mkdir('.data/local-ai', { recursive: true });
  if (currentPage) {
    await currentPage.screenshot({ path: '.data/local-ai/browser-failure.png' }).catch(() => {});
    console.error('Visible voice status:', await currentPage.locator('.voice-status').textContent().catch(() => 'no status'));
  }
  throw error;
} finally { await browser.close(); }
