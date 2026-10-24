import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { HttpError } from '../../../packages/backend-kit/src/http-policy.ts';

export const localVoices = ['Jasper', 'Bruno', 'Hugo', 'Luna'] as const;
const actors = new Map<string, { until: number; count: number; active: number }>();
let active = 0;
function endpoint(path: string) {
  const url = new URL(process.env.VOICE_SERVICE_URL || 'http://127.0.0.1:4200');
  if (!['localhost', '127.0.0.1', '[::1]', 'voice'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new HttpError(503, 'Local speech endpoint is not configured.');
  return new URL(path, url);
}
export async function voiceConfig() {
  let status = { ttsReady: false, asrReady: false };
  try { const r = await fetch(endpoint('/health'), { redirect: 'error', signal: AbortSignal.timeout(1500) }); if (r.ok) status = await r.json() as typeof status; } catch { /* Text remains available. */ }
  return { provider: 'internal-open-source', localOnly: true, ttsReady: status.ttsReady === true, asrReady: status.asrReady === true,
    voices: localVoices.map(id => ({ id, name: id, language: 'en-US', license: 'Apache-2.0' })),
    spokenLanguages: ['en-US'], dictationLanguages: ['en-US', 'ar-AE'], maxRecordingSeconds: 15, maxAudioBytes: 45000, maxSpeechCharacters: 480 };
}
function admit(subject: string) {
  const now = Date.now();
  for (const [id, item] of actors) if (item.until <= now && !item.active) actors.delete(id);
  const item = actors.get(subject) || { until: now + 60000, count: 0, active: 0 };
  if (actors.size >= 1000 || item.active || active >= 2 || item.count >= 20) throw new HttpError(429, 'Voice is busy. Wait a moment or continue typing.');
  item.count++; item.active++; active++; actors.set(subject, item);
  return () => { item.active--; active--; };
}
async function boundedBytes(response: Response, limit: number) {
  if (!response.body) throw new Error('Empty voice response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > limit) { await reader.cancel(); throw new Error('Voice response exceeds limit'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function request(path: string, subject: string, body: unknown) {
  const release = admit(subject);
  try {
    const response = await fetch(endpoint(path), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new HttpError([413, 422, 429].includes(response.status) ? response.status : 503, response.status === 429 ? 'Local voice is busy. Try again shortly.' : 'Local speech could not process this request. Shorten it or continue typing.');
    return await boundedBytes(response, path === '/speech' ? 24000 * 45 * 2 + 1000 : 20000);
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(503, 'Local voice is unavailable. You can continue typing.'); }
  finally { release(); }
}
export async function localSpeech(subject: string, input: { text: string; voice?: string; speed?: number; language?: string }) {
  if (input.language && input.language !== 'en-US') throw new HttpError(422, 'The installed voice presets speak English. Arabic replies remain available as text.');
  if (input.voice && !localVoices.includes(input.voice as typeof localVoices[number])) throw new HttpError(400, 'Choose an installed open-source voice.');
  if (input.speed !== undefined && (!Number.isFinite(input.speed) || input.speed < 0.8 || input.speed > 1.2)) throw new HttpError(400, 'Choose a voice speed between 0.8 and 1.2.');
  const bytes = await request('/speech', subject, { text: input.text, voice: input.voice || 'Jasper', speed: input.speed || 1, language: 'en-US' });
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new HttpError(503, 'Local speech returned invalid audio.');
  return { success: true, available: true, provider: 'internal-open-source', localOnly: true, audioBase64: bytes.toString('base64'), format: 'audio/wav', voice: input.voice || 'Jasper', model: 'KittenML/kitten-tts-mini-0.8' };
}
export async function localTranscription(subject: string, input: { audioBase64: string; format: string; language?: string }) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64) || Buffer.from(input.audioBase64, 'base64').length > 45000) throw new HttpError(413, 'Keep microphone drafts short.');
  const bytes = await request('/transcribe', subject, { ...input, language: input.language || 'en-US' });
  let result: { text?: unknown }; try { result = JSON.parse(bytes.toString('utf8')); } catch { throw new HttpError(503, 'Local dictation returned an invalid result.'); }
  if (typeof result.text !== 'string' || result.text.length > 4000) throw new HttpError(503, 'Local dictation returned an invalid result.');
  return { success: true, text: result.text, localOnly: true, requiresReview: true };
}
