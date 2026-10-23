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
  Audio?: new (src?: string) => any;
}
export type VoiceState = 'idle' | 'listening' | 'speaking';
export type VoiceCallbacks = {
  onTranscript(text: string): void;
  onState(state: VoiceState): void;
  onError(message: string): void;
  fetchAudio?: (text: string, language: string) => Promise<{ audioBase64?: string; format?: string; available?: boolean } | null | undefined>;
};
export class VoiceClient {
  readonly canListen: boolean;
  readonly canSpeak: boolean;
  private recognition?: Recognition;
  private utterance?: any;
  private currentAudio?: any;
  private speechGeneration = 0;
  private disposed = false;
  private state: VoiceState = 'idle';
  private callbacks: VoiceCallbacks;
  private environment: VoiceEnvironment;
  constructor(callbacks: VoiceCallbacks, environment: VoiceEnvironment = globalThis as unknown as VoiceEnvironment) {
    this.callbacks = callbacks;
    this.environment = environment;
    this.canListen = !!(environment.SpeechRecognition || environment.webkitSpeechRecognition);
    this.canSpeak = !!(environment.speechSynthesis && environment.SpeechSynthesisUtterance) || !!callbacks.fetchAudio;
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
    if (!this.canSpeak) {
      this.callbacks.onError('Spoken replies are unavailable in this browser. Replies remain visible in chat.');
      return;
    }
    this.cancel();
    const generation = ++this.speechGeneration;

    if (this.callbacks.fetchAudio) {
      this.update('speaking');
      this.callbacks.fetchAudio(text, language)
        .then(result => {
          if (this.disposed || this.speechGeneration !== generation) return;
          if (result && result.audioBase64) {
            this.playNeuralAudio(result.audioBase64, result.format || 'audio/mpeg', generation, text, language);
          } else {
            this.speakBrowser(text, language, generation);
          }
        })
        .catch(() => {
          if (this.disposed || this.speechGeneration !== generation) return;
          this.speakBrowser(text, language, generation);
        });
      return;
    }

    this.speakBrowser(text, language, generation);
  }

  private playNeuralAudio(audioBase64: string, format: string, generation: number, fallbackText: string, fallbackLang: string) {
    const AudioConstructor = this.environment.Audio || (globalThis as any).Audio;
    if (!AudioConstructor) {
      this.speakBrowser(fallbackText, fallbackLang, generation);
      return;
    }
    try {
      const audio = new AudioConstructor(`data:${format};base64,${audioBase64}`);
      this.currentAudio = audio;
      const cleanup = () => {
        if (this.currentAudio === audio) this.currentAudio = undefined;
        if (!this.disposed && this.speechGeneration === generation) {
          this.update('idle');
        }
      };
      audio.onended = cleanup;
      audio.onerror = () => {
        if (this.currentAudio === audio) this.currentAudio = undefined;
        if (!this.disposed && this.speechGeneration === generation) {
          this.speakBrowser(fallbackText, fallbackLang, generation);
        }
      };
      const playPromise = audio.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (this.currentAudio === audio) this.currentAudio = undefined;
          if (!this.disposed && this.speechGeneration === generation) {
            this.speakBrowser(fallbackText, fallbackLang, generation);
          }
        });
      }
    } catch {
      this.speakBrowser(fallbackText, fallbackLang, generation);
    }
  }

  private speakBrowser(text: string, language: string, generation?: number) {
    if (this.disposed) return;
    if (generation !== undefined && this.speechGeneration !== generation) return;
    if (!this.environment.speechSynthesis || !this.environment.SpeechSynthesisUtterance) {
      this.update('idle');
      this.callbacks.onError('The spoken reply could not play. You can read it in chat.');
      return;
    }
    let utterance: any;
    try {
      utterance = new this.environment.SpeechSynthesisUtterance(text.slice(0, 3000));
    } catch {
      this.update('idle');
      this.callbacks.onError('Could not initialize speech playback. You can read the reply in chat.');
      return;
    }
    utterance.lang = language;
    this.utterance = utterance;
    const gen = generation ?? this.speechGeneration;
    const finished = () => {
      if (this.utterance !== utterance || this.disposed || this.speechGeneration !== gen) return;
      this.utterance = undefined;
      this.update('idle');
    };
    utterance.onend = finished;
    utterance.onerror = () => {
      if (this.utterance !== utterance || this.disposed || this.speechGeneration !== gen) return;
      finished();
      this.callbacks.onError('The spoken reply could not play. You can read it in chat.');
    };
    try {
      this.update('speaking');
      this.environment.speechSynthesis.speak(utterance);
    } catch {
      finished();
      this.callbacks.onError('The spoken reply could not play. You can read it in chat.');
    }
  }

  private detachRecognition(recognition: Recognition) {
    recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
    if (this.recognition === recognition) this.recognition = undefined;
  }
  cancel() {
    this.speechGeneration++;
    const recognition = this.recognition;
    if (recognition) {
      this.detachRecognition(recognition);
      try { recognition.abort(); } catch { /* Already ended. */ }
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
      } catch { /* Ignore cleanup errors */ }
      this.currentAudio = undefined;
    }
    this.utterance = undefined;
    if (this.state === 'speaking') {
      try { this.environment.speechSynthesis?.cancel(); } catch { /* Cleanup must keep text input usable. */ }
    }
    this.update('idle');
  }
  dispose() { this.disposed = true; this.cancel(); }
}
