import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceClient, type VoiceEnvironment } from '../../packages/protocol-core/src/voice-client.ts';
import { speechText } from '../../packages/protocol-core/src/voice-text.ts';
import { localSpeech, localTranscription } from '../agent-core/src/local-voice.ts';
import { invokeLocalConversation } from '../agent-core/src/local-conversation.ts';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function capture() {
  const recorders: any[] = [], drafts: string[] = [], states: string[] = [], errors: string[] = [];
  let stopped = 0, browserCalls = 0;
  const stream = { getTracks: () => [{ onended: null, stop: () => stopped++ }] };
  class Recorder {
    static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
    state = 'inactive'; ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void; onerror?: () => void;
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(80)]) }); void this.onstop?.(); }
  }
  const environment: VoiceEnvironment = { MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => stream } },
    SpeechRecognition: class { constructor() { browserCalls++; throw new Error('Proprietary speech must not start'); } } as any,
    SpeechSynthesisUtterance: class {}, speechSynthesis: { speak: () => browserCalls++, cancel: () => browserCalls++ } };
  return { recorders, drafts, states, errors, stream, environment, stopped: () => stopped, browserCalls: () => browserCalls };
}
test('local voice: capture requires a gesture, creates only a draft and releases microphone tracks', async () => {
  const f = capture(); let uploads = 0;
  const voice = new VoiceClient({ onTranscript: t => f.drafts.push(t), onState: s => f.states.push(s), onError: e => f.errors.push(e), allowBrowserFallback: false,
    transcribeAudio: async (input) => { uploads++; assert.equal(input.format, 'audio/webm'); return { text: 'Show my wallet balance' }; } }, f.environment);
  assert.equal(f.recorders.length, 0); assert.equal(uploads, 0);
  voice.startListening(); await tick(); voice.stopListening(); await tick();
  assert.deepEqual(f.drafts, ['Show my wallet balance']); assert.ok(f.states.includes('transcribing'));
  assert.equal(f.stopped(), 1); assert.equal(f.browserCalls(), 0); voice.dispose();
});
test('local voice: cancellation discards late permission and transcription results', async () => {
  const f = capture(); let approve: (stream: any) => void = () => {};
  f.environment.navigator!.mediaDevices!.getUserMedia = () => new Promise(resolve => { approve = resolve; });
  const voice = new VoiceClient({ onTranscript: t => f.drafts.push(t), onState: () => {}, onError: e => f.errors.push(e), allowBrowserFallback: false, transcribeAudio: async () => ({ text: 'Must not arrive' }) }, f.environment);
  voice.startListening(); voice.cancel(); approve(f.stream); await tick();
  assert.equal(f.recorders.length, 0); assert.equal(f.stopped(), 1); assert.equal(f.drafts.length, 0);
  let complete: (result: { text: string }) => void = () => {}; let signal: AbortSignal | undefined;
  const g = capture();
  const other = new VoiceClient({ onTranscript: t => g.drafts.push(t), onState: () => {}, onError: () => {}, allowBrowserFallback: false,
    transcribeAudio: (_input, s) => { signal = s; return new Promise(resolve => { complete = resolve; }); } }, g.environment);
  other.startListening(); await tick(); other.stopListening(); await tick(); other.cancel();
  assert.equal(signal?.aborted, true); complete({ text: 'Late draft' }); await tick(); assert.equal(g.drafts.length, 0);
  voice.dispose(); other.dispose();
});
test('local voice: outages never start browser speech; playback fetch is abortable', async () => {
  const f = capture(); let signal: AbortSignal | undefined;
  const v = new VoiceClient({ onTranscript: () => {}, onState: s => f.states.push(s), onError: e => f.errors.push(e), allowBrowserFallback: false,
    fetchAudio: async (_text, _lang, s) => { signal = s; throw new Error('Local engine unavailable'); } }, f.environment);
  v.speak('Hello'); await tick(); assert.match(f.errors[0], /Local engine/); assert.equal(f.browserCalls(), 0);
  v.cancel(); assert.equal(signal?.aborted, true); v.dispose();
});
test('speech preparation preserves visible facts and bounds spoken output without reading markup or URLs', () => {
  assert.equal(speechText('**Balance:** AED 1500.50. [Details](https://example.invalid)'), 'Balance: AED 1500.50. Details');
  const long = speechText('Please review your account. '.repeat(50)); assert.ok(long.length <= 480); assert.match(long, /full details are on screen/);
});
test('local audio and conversation use allowlisted loopback services only, with no provider key', async t => {
  const previous = { VOICE_SERVICE_URL: process.env.VOICE_SERVICE_URL, CONVERSATION_SERVICE_URL: process.env.CONVERSATION_SERVICE_URL };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.VOICE_SERVICE_URL = 'https://external.invalid/'; process.env.CONVERSATION_SERVICE_URL = 'https://external.invalid/';
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Must not fetch'); });
  await assert.rejects(localSpeech('voice-ssrf-test', { text: 'Hello' }), /endpoint/);
  await assert.rejects(invokeLocalConversation([{ role: 'user', content: 'Hello' }]), /endpoint/);
  assert.equal(requests, 0);
  process.env.VOICE_SERVICE_URL = 'http://localhost:4200';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    assert.ok(!init?.headers || !JSON.stringify(init.headers).includes('Authorization'));
    return new Response(Buffer.from('RIFF0000WAVE0000'));
  });
  const audio = await localSpeech('voice-local-test', { text: 'Hello', voice: 'Jasper' }); assert.equal(audio.format, 'audio/wav'); assert.equal(audio.localOnly, true);
  await assert.rejects(localTranscription('voice-invalid-test', { audioBase64: '!', format: 'audio/webm' }));
});
