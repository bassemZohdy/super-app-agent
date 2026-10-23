/** Browser Web Speech adapter. No automatic sending, recording storage or paid API. */
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export interface VoiceEnvironment {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: { speak(utterance: any): void; cancel(): void };
  SpeechSynthesisUtterance?: new (text: string) => any;
}
export type VoiceState = 'idle' | 'listening' | 'speaking';
type VoiceCallbacks = { onTranscript(text: string): void; onState(state: VoiceState): void; onError(message: string): void };
export class VoiceClient {
  readonly canListen: boolean;
  readonly canSpeak: boolean;
  private recognition?: Recognition;
  private utterance?: any;
  private disposed = false;
  private state: VoiceState = 'idle';
  private callbacks: VoiceCallbacks;
  private environment: VoiceEnvironment;
  constructor(callbacks: VoiceCallbacks, environment: VoiceEnvironment = globalThis as unknown as VoiceEnvironment) {
    this.callbacks = callbacks;
    this.environment = environment;
    this.canListen = !!(environment.SpeechRecognition || environment.webkitSpeechRecognition);
    this.canSpeak = !!(environment.speechSynthesis && environment.SpeechSynthesisUtterance);
  }
  private update(state: VoiceState) {
    this.state = state;
    if (!this.disposed) this.callbacks.onState(state);
  }
  startListening(language = 'en-US') {
    if (this.disposed) return;
    if (!this.canListen) { this.callbacks.onError('Voice input is unavailable in this browser. You can type your request.'); return; }
    this.cancel();
    const Constructor = (this.environment.SpeechRecognition || this.environment.webkitSpeechRecognition)!;
    let recognition: Recognition;
    try { recognition = new Constructor(); }
    catch { this.callbacks.onError('Could not initialize voice input. You can type your request.'); return; }
    this.recognition = recognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = event => {
      if (this.disposed || this.recognition !== recognition) return;
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) parts.push(event.results[i][0]?.transcript || '');
      }
      const text = parts.join(' ').trim().slice(0, 4000);
      if (text) this.callbacks.onTranscript(text);
    };
    recognition.onerror = event => {
      if (this.recognition !== recognition || this.disposed) return;
      const errors: Record<string, string> = {
        'not-allowed': 'Microphone permission was denied. Allow access in browser settings or type your request.',
        'service-not-allowed': 'Speech recognition is not permitted. You can type your request.',
        'audio-capture': 'No microphone is available. Check your audio input or type your request.',
        'no-speech': 'No speech was detected. Try again or type your request.',
        'network': 'Speech recognition could not connect. Try again or type your request.',
        'language-not-supported': 'That speech language is unavailable. Choose another language or type your request.',
      };
      if (event.error !== 'aborted') this.callbacks.onError(errors[event.error] || 'Speech recognition failed. You can type your request.');
      this.detachRecognition(recognition);
      try { recognition.abort(); } catch { /* Already ended. */ }
      this.update('idle');
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.detachRecognition(recognition);
      this.update('idle');
    };
    try { this.update('listening'); recognition.start(); }
    catch { this.detachRecognition(recognition); try { recognition.abort(); } catch {} this.update('idle'); this.callbacks.onError('Could not start the microphone. You can type your request.'); }
  }
  stopListening() {
    if (!this.recognition || this.disposed) return;
    try { this.recognition.stop(); }
    catch { this.cancel(); }
  }
  speak(text: string, language = 'en-US') {
    if (this.disposed) return;
    if (!this.canSpeak) { this.callbacks.onError('Spoken replies are unavailable in this browser. Replies remain visible in chat.'); return; }
    this.cancel();
    let utterance: any;
    try { utterance = new this.environment.SpeechSynthesisUtterance!(text.slice(0, 3000)); }
    catch { this.callbacks.onError('Could not initialize speech playback. You can read the reply in chat.'); return; }
    utterance.lang = language;
    this.utterance = utterance;
    const finished = () => {
      if (this.utterance !== utterance || this.disposed) return;
      this.utterance = undefined;
      this.update('idle');
    };
    utterance.onend = finished;
    utterance.onerror = () => {
      if (this.utterance !== utterance || this.disposed) return;
      finished(); this.callbacks.onError('The spoken reply could not play. You can read it in chat.');
    };
    try { this.update('speaking'); this.environment.speechSynthesis!.speak(utterance); }
    catch { finished(); this.callbacks.onError('The spoken reply could not play. You can read it in chat.'); }
  }
  private detachRecognition(recognition: Recognition) {
    recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
    if (this.recognition === recognition) this.recognition = undefined;
  }
  cancel() {
    const recognition = this.recognition;
    if (recognition) {
      this.detachRecognition(recognition);
      try { recognition.abort(); } catch { /* Already ended. */ }
    }
    this.utterance = undefined;
    if (this.state === 'speaking') {
      try { this.environment.speechSynthesis?.cancel(); } catch { /* Cleanup must keep text input usable. */ }
    }
    this.update('idle');
  }
  dispose() { this.disposed = true; this.cancel(); }
}
