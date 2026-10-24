import { gatewayUrl, keycloakIssuerUrl } from './endpoints.ts';
/** Real local inference; generated synthetic audio only, never a physical microphone. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const base = gatewayUrl;
const login = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123' }) });
assert.equal(login.status, 200);
const token = (await login.json() as any).access_token;
async function api(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() as any };
}
const config = await api('/api/voice/config'); assert.equal(config.status, 200); assert.equal(config.data.ttsReady, true); assert.equal(config.data.asrReady, true);
assert.equal((await fetch(`${base}/api/voice/config`)).status, 401);
await mkdir('.data/local-ai', { recursive: true });
await mkdir('docs/assets/voice', { recursive: true });
const started = Date.now();
const speech = await api('/api/a2ui/tts', { text: 'Show my wallet balance.', voice: 'Jasper', speed: 1, language: 'en-US' });
assert.equal(speech.status, 200, JSON.stringify({ status: speech.status, error: speech.data.error }));
const wave = Buffer.from(speech.data.audioBase64, 'base64'); assert.equal(wave.subarray(0, 4).toString(), 'RIFF');
await writeFile('.data/local-ai/dictation-source.wav', wave);
const convert = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', '.data/local-ai/dictation-source.wav', '-c:a', 'libopus', '-b:a', '16k', '.data/local-ai/dictation-source.webm'], { encoding: 'utf8' });
assert.equal(convert.status, 0, convert.stderr);
const input = await readFile('.data/local-ai/dictation-source.webm'); assert.ok(input.length < 45000);
const transcript = await api('/api/voice/transcribe', { audioBase64: input.toString('base64'), format: 'audio/webm', language: 'en-US' });
assert.equal(transcript.status, 200, JSON.stringify(transcript.data)); assert.equal(transcript.data.requiresReview, true); assert.match(transcript.data.text, /wallet|balance/i);
console.log(`PASS: real CPU speech → compressed audio → local Whisper draft (${Date.now() - started}ms); no action submitted`);
assert.equal((await api('/api/a2ui/tts', { text: 'Hello', voice: 'alloy' })).status, 400);
assert.equal((await api('/api/a2ui/tts', { text: 'Hello', voice: 'Jasper', language: 'ar-AE' })).status, 422);
assert.equal((await api('/api/voice/transcribe', { audioBase64: Buffer.from('#EXTM3U\nhttps://example.invalid/private').toString('base64'), format: 'audio/webm' })).status, 422);
console.log('PASS: authentication, preset allowlist, unsupported speech language and non-audio rejection');
const sessionId = `local_ai_${randomUUID()}`;
try {
  const health = await fetch(`${base}/health`).then(r => r.json()) as any;
  assert.equal(health.llm.provider, 'llama.cpp'); assert.equal(health.llm.ready, true);
  const reply = await api('/api/a2ui/intent', { sessionId, text: 'Hello Rashid. Please introduce yourself in one short sentence.' });
  assert.equal(reply.status, 200); assert.equal(reply.data.inference?.provider, 'llama.cpp'); assert.equal(reply.data.inference?.status, 'connected', JSON.stringify(reply.data.inference));
  const text = reply.data.surface?.assistantMessage?.text; assert.equal(typeof text, 'string'); assert.ok(text.length > 10 && text.length <= 4000);
  assert.ok(!/OpenRouter|API key/i.test(text)); console.log(`PASS: actual local open-source conversation reply: ${text}`);
  const preview = await api('/api/a2ui/tts', { text: 'Marhaba. I am Rashid, your city concierge. Tell me what you need, and we will take it one step at a time.', voice: 'Jasper', speed: 1, language: 'en-US' });
  assert.equal(preview.status, 200);
  await writeFile('docs/assets/voice/rashid-preview.wav', Buffer.from(preview.data.audioBase64, 'base64'));
  console.log('PASS: original open-source model preview saved; no cloud credentials used');
} finally { await fetch(`${base}/api/sessions/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); }
