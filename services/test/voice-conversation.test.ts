import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceClient, type Recognition, type VoiceEnvironment } from '../../packages/protocol-core/src/voice-client.ts';
import { executeCoreRequest as core, sseClients } from '../agent-core/src/index.ts';
import { balance, transactions } from '../service-wallet/src/index.ts';
import { activeRides } from '../service-ride/src/index.ts';
import { checkedSurface } from '../../packages/protocol-core/src/surface-client.ts';

function fixture(options: { startThrows?: boolean; noInput?: boolean; noOutput?: boolean } = {}) {
  const recordings: FakeRecognition[] = [], spoken: any[] = [], transcripts: string[] = [], states: string[] = [], errors: string[] = [];
  let cancelled = 0;
  class FakeRecognition implements Recognition {
    lang = ''; continuous = true; interimResults = true; started = false; stopped = false; aborted = false;
    onresult: Recognition['onresult'] = null; onerror: Recognition['onerror'] = null; onend: Recognition['onend'] = null;
    constructor() { recordings.push(this); }
    start() { if (options.startThrows) throw new Error('start failed'); this.started = true; }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  const environment: VoiceEnvironment = {};
  if (!options.noInput) environment.webkitSpeechRecognition = FakeRecognition;
  if (!options.noOutput) {
    environment.SpeechSynthesisUtterance = class { text: string; constructor(text: string) { this.text = text; } };
    environment.speechSynthesis = { speak: utterance => { spoken.push(utterance); }, cancel: () => { cancelled++; } };
  }
  const client = new VoiceClient({ allowBrowserFallback: true, onTranscript: text => transcripts.push(text), onState: state => states.push(state), onError: error => errors.push(error) }, environment);
  return { client, recordings, spoken, transcripts, states, errors, cancelled: () => cancelled };
}

test('voice: starts only on request and delivers bounded final transcripts as drafts', () => {
  const f = fixture();
  assert.equal(f.recordings.length, 0);
  f.client.startListening('ar-AE');
  const r = f.recordings[0];
  assert.equal(r.lang, 'ar-AE'); assert.equal(r.continuous, false); assert.equal(r.started, true);
  const interim: any = [{ transcript: 'interim' }]; interim.isFinal = false;
  r.onresult!({ results: [interim] }); assert.equal(f.transcripts.length, 0);
  const final: any = [{ transcript: 'x'.repeat(5000) }]; final.isFinal = true;
  r.onresult!({ results: [final] }); assert.equal(f.transcripts[0].length, 4000);
  f.client.stopListening(); assert.equal(r.stopped, true);
  r.onend!(); assert.equal(f.states.at(-1), 'idle');
});

test('voice: permission/network/empty input errors release microphone and keep text fallback', () => {
  for (const error of ['not-allowed', 'network', 'no-speech', 'audio-capture', 'language-not-supported']) {
    const f = fixture(); f.client.startListening();
    f.recordings[0].onerror!({ error });
    assert.equal(f.states.at(-1), 'idle'); assert.equal(f.recordings[0].aborted, true);
    assert.ok(f.errors[0].length); assert.equal(f.transcripts.length, 0);
  }
  const errors: string[] = [];
  const unavailable = new VoiceClient({ allowBrowserFallback: true, onTranscript: () => {}, onState: () => {}, onError: error => errors.push(error) }, {
    SpeechRecognition: class { constructor() { throw new Error('unavailable'); } } as any,
    SpeechSynthesisUtterance: class { constructor() { throw new Error('unavailable'); } },
    speechSynthesis: { speak: () => {}, cancel: () => {} },
  });
  unavailable.startListening(); unavailable.speak('reply'); assert.equal(errors.length, 2);
  const f = fixture({ startThrows: true }); f.client.startListening();
  assert.equal(f.states.at(-1), 'idle'); assert.equal(f.recordings[0].aborted, true); assert.equal(f.errors.length, 1);
});

test('voice: absent APIs are reported without throwing or starting audio', () => {
  const f = fixture({ noInput: true, noOutput: true });
  assert.equal(f.client.canListen, false); assert.equal(f.client.canSpeak, false);
  f.client.startListening(); f.client.speak('reply');
  assert.equal(f.errors.length, 2); assert.equal(f.recordings.length, 0); assert.equal(f.spoken.length, 0);
});

test('voice: speech is opt-in, cancels listening, handles playback failure and disposes callbacks', () => {
  const f = fixture();
  f.client.startListening(); const lateResult = f.recordings[0].onresult!;
  f.client.speak('Only the assistant reply', 'en-US');
  assert.equal(f.recordings[0].aborted, true); assert.equal(f.spoken[0].text, 'Only the assistant reply');
  assert.equal(f.states.at(-1), 'speaking');
  lateResult({ results: [] }); assert.equal(f.transcripts.length, 0);
  f.client.cancel(); assert.equal(f.cancelled(), 1); assert.equal(f.states.at(-1), 'idle');
  f.client.speak('Again'); f.spoken[1].onerror(); assert.equal(f.errors.length, 1); assert.equal(f.states.at(-1), 'idle');
  f.client.startListening(); const lateError = f.recordings[1].onerror!;
  f.client.dispose(); const count = f.states.length;
  lateError({ error: 'not-allowed' }); f.client.startListening(); f.client.speak('after dispose');
  assert.equal(f.states.length, count); assert.equal(f.errors.length, 1);
});

test('voice: neural audio playback plays via Audio element, falls back cleanly on failure, and can be cancelled', async () => {
  const createdAudio: any[] = [];
  class FakeAudio {
    src: string;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = false;
    constructor(src: string) {
      this.src = src;
      createdAudio.push(this);
    }
    async play() {}
    pause() { this.paused = true; }
  }

  const states: string[] = [];
  const errors: string[] = [];
  const spokenUtterances: any[] = [];

  const env: VoiceEnvironment = {
    Audio: FakeAudio as any,
    SpeechSynthesisUtterance: class { text: string; constructor(text: string) { this.text = text; } },
    speechSynthesis: { speak: (u: any) => spokenUtterances.push(u), cancel: () => {} },
  };

  // 1. Success case: neural TTS audio plays and onended transitions state to idle
  let fetchCount = 0;
  const client = new VoiceClient({ allowBrowserFallback: true,
    onTranscript: () => {},
    onState: state => states.push(state),
    onError: err => errors.push(err),
    fetchAudio: async () => {
      fetchCount++;
      return { audioBase64: 'FAKE_BASE64_AUDIO', format: 'audio/mpeg' };
    },
  }, env);

  assert.equal(client.canSpeak, true);
  client.speak('Welcome to Dubai!');
  await new Promise(r => setTimeout(r, 10));

  assert.equal(fetchCount, 1);
  assert.equal(states.at(-1), 'speaking');
  assert.equal(createdAudio.length, 1);
  assert.match(createdAudio[0].src, /FAKE_BASE64_AUDIO/);

  createdAudio[0].onended!();
  assert.equal(states.at(-1), 'idle');

  // 2. Fallback case: fetchAudio returns no audioBase64 -> falls back to browser synthesis
  const fallbackClient = new VoiceClient({ allowBrowserFallback: true,
    onTranscript: () => {},
    onState: state => states.push(state),
    onError: err => errors.push(err),
    fetchAudio: async () => ({ available: false }),
  }, env);

  fallbackClient.speak('Fallback test');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(spokenUtterances.length, 1);
  assert.equal(spokenUtterances[0].text, 'Fallback test');

  // 3. Cancel mid-flight: pauses audio and returns to idle
  client.speak('Cancel me');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(states.at(-1), 'speaking');
  client.cancel();
  assert.equal(states.at(-1), 'idle');
  assert.equal(createdAudio.at(-1).paused, true);
});

const intent = (sessionId: string, text: string) => core('POST', '/api/a2ui/intent', {}, { sessionId, text });

test('conversation: replies and current-proposal explanations agree across HTTP/SSE without effects', async () => {
  const sid = 'conversation_explanation', events: any[] = [];
  sseClients.set(sid, new Set([event => events.push(event)]));
  try {
    const hello = await intent(sid, 'hello');
    assert.match(hello.data.surface.assistantMessage.text, /Hello/);
    await intent(sid, 'show my wallet');
    const before = balance, count = transactions.length;
    const result = await intent(sid, 'explain this');
    assert.equal(result.status, 200);
    assert.match(result.data.surface.assistantMessage.text, /Review all details/);
    const streamed = events.filter(event => event.type === 'A2UI_RENDER_SURFACE').at(-1).data.surface;
    assert.deepEqual(streamed.assistantMessage, result.data.surface.assistantMessage);
    assert.throws(() => checkedSurface({ ...streamed, assistantMessage: { id: null, text: 'invalid' } }, sid), /invalid surface/);
    assert.throws(() => checkedSurface({ ...streamed, assistantMessage: { id: 'test', text: 'x'.repeat(4001) } }, sid), /invalid surface/);
    assert.equal(streamed.assistantMessage.id, streamed.revision);
    assert.equal(balance, before); assert.equal(transactions.length, count);
  } finally { sseClients.delete(sid); }
});

test('conversation: follow-ups retain topic, explicit topic switches work and sessions are isolated', async () => {
  const sid = 'conversation_context';
  const ride = await intent(sid, 'find a cab ride');
  assert.equal(ride.data.activeDomain, 'ride');
  const followup = await intent(sid, 'show me the options');
  assert.equal(followup.data.surface.view.id, ride.data.surface.view.id);
  assert.notEqual(followup.data.surface.revision, ride.data.surface.revision);
  assert.equal((await intent(sid, 'show my wallet')).data.activeDomain, 'wallet');
  assert.equal((await intent(sid, 'show that again')).data.activeDomain, 'wallet');
  assert.equal((await intent('conversation_independent', 'show that again')).data.activeDomain, 'concierge');
});

test('conversation: spoken/textual assent never books or pays; cancel invalidates the approval', async () => {
  const sid = 'conversation_consent';
  const proposal = await intent(sid, 'find a cab ride');
  const before = balance, ledger = transactions.length, rides = activeRides.size;
  const assent = await intent(sid, 'book it');
  assert.match(assent.data.surface.assistantMessage.text, /confirmation button/);
  assert.equal(balance, before); assert.equal(transactions.length, ledger); assert.equal(activeRides.size, rides);
  const cancelled = await intent(sid, 'cancel that');
  assert.equal(cancelled.data.surface.view.id, 'conversation_card');
  assert.match(cancelled.data.surface.assistantMessage.text, /approval has been cleared/);
  const stale = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: proposal.data.surface.revision, action: 'book_ride', payload: { selectedChoice: 'drv_1' } });
  assert.equal(stale.data.code, 'STALE_SURFACE');
  assert.equal(activeRides.size, rides);
});
