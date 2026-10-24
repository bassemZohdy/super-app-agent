/** User-triggered short microphone capture. Transcription is always a reviewable draft. */
export type RecordingPayload = { audioBase64: string; format: string; language: string };
export interface CaptureEnvironment {
  navigator?: { mediaDevices?: { getUserMedia(options: any): Promise<any> } };
  MediaRecorder?: { new(stream: any, options: any): any; isTypeSupported?(mime: string): boolean };
}
export class LocalRecorder {
  readonly available: boolean;
  private generation = 0;
  private recorder?: any;
  private stream?: any;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  constructor(privateEnvironment: CaptureEnvironment, callbacks: {
    transcribe(input: RecordingPayload, signal: AbortSignal): Promise<{ text: string }>;
    onDraft(text: string): void; onState(state: 'idle' | 'listening' | 'transcribing'): void; onError(message: string): void;
  }) {
    this.environment = privateEnvironment; this.callbacks = callbacks;
    this.available = Boolean(privateEnvironment.MediaRecorder && privateEnvironment.navigator?.mediaDevices?.getUserMedia);
  }
  private environment: CaptureEnvironment;
  private callbacks: { transcribe(input: RecordingPayload, signal: AbortSignal): Promise<{ text: string }>; onDraft(text: string): void; onState(state: 'idle' | 'listening' | 'transcribing'): void; onError(message: string): void };
  private releaseTracks() {
    clearTimeout(this.timer); this.timer = undefined;
    for (const track of this.stream?.getTracks() || []) { track.onended = null; track.stop(); }
    this.stream = undefined;
  }
  async start(language: string) {
    this.cancel(); const generation = this.generation;
    this.callbacks.onState('listening');
    try {
      const stream = await this.environment.navigator!.mediaDevices!.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return; }
      this.stream = stream;
      const Ctor = this.environment.MediaRecorder!;
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => !Ctor.isTypeSupported || Ctor.isTypeSupported(type));
      if (!mime) throw new Error('This browser cannot record a supported local-audio format.');
      const recorder = new Ctor(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
      this.recorder = recorder;
      const chunks: Blob[] = []; let size = 0;
      recorder.ondataavailable = (event: { data: Blob }) => { if (generation !== this.generation || !event.data.size) return; chunks.push(event.data); size += event.data.size; if (size >= 40000 && recorder.state === 'recording') recorder.stop(); };
      recorder.onerror = () => { if (generation !== this.generation) return; this.cancel(); this.callbacks.onState('idle'); this.callbacks.onError('Microphone capture failed. You can type your request.'); };
      for (const track of stream.getTracks()) track.onended = () => { if (generation !== this.generation) return; this.cancel(); this.callbacks.onState('idle'); this.callbacks.onError('Microphone disconnected. The recording was discarded.'); };
      recorder.onstop = async () => {
        if (generation !== this.generation) return;
        this.recorder = undefined; this.releaseTracks();
        if (size < 32 || size > 45000) { this.callbacks.onState('idle'); this.callbacks.onError('Keep microphone drafts short, then review them before sending.'); return; }
        this.callbacks.onState('transcribing');
        try {
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          if (generation !== this.generation) return;
          let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const request = new AbortController(); this.request = request;
          const result = await this.callbacks.transcribe({ audioBase64: btoa(binary), format: mime.split(';')[0], language }, request.signal);
          if (generation !== this.generation) return;
          if (result.text.trim()) this.callbacks.onDraft(result.text.trim().slice(0, 4000));
          else this.callbacks.onError('No clear speech was detected. Try again or type your request.');
        } catch (e) { if (generation === this.generation) this.callbacks.onError(e instanceof Error ? e.message : 'Local dictation failed. You can type your request.'); }
        finally { if (generation === this.generation) { this.request = undefined; this.callbacks.onState('idle'); } }
      };
      recorder.start(250);
      this.timer = setTimeout(() => { if (generation === this.generation && recorder.state === 'recording') recorder.stop(); }, 14000);
    } catch (e) {
      if (generation !== this.generation) return;
      this.cancel(); this.callbacks.onState('idle');
      this.callbacks.onError((e as { name?: string }).name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access or type your request.' : 'The microphone could not start. You can type your request.');
    }
  }
  stop() { if (this.recorder?.state === 'recording') this.recorder.stop(); else { this.cancel(); this.callbacks.onState('idle'); } }
  cancel() {
    this.generation++; this.request?.abort(); this.request = undefined;
    if (this.recorder) { this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null; try { if (this.recorder.state !== 'inactive') this.recorder.stop(); } catch {} this.recorder = undefined; }
    this.releaseTracks();
  }
}
