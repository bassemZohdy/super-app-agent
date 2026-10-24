import type { RecordingPayload } from './local-recorder.ts';
export type LocalVoiceConfig = { provider: string; localOnly: boolean; ttsReady: boolean; asrReady: boolean; voices: Array<{ id: string; name: string; language: string; license: string }> };
export class LocalVoiceApi {
  private base: string; private token: () => string | Promise<string>;
  constructor(base: string, token: () => string | Promise<string>) { this.base = base; this.token = token; }
  private async request(path: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`${this.base}${path}`, { method: body === undefined ? 'GET' : 'POST', signal,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(response.status === 401 ? 'Sign in again to use local voice.' : data.error || 'Local voice is unavailable. You can continue typing.');
    return data;
  }
  config(signal?: AbortSignal): Promise<LocalVoiceConfig> { return this.request('/api/voice/config', undefined, signal); }
  speech(text: string, language: string, voice: string, speed: number, signal?: AbortSignal) { return this.request('/api/a2ui/tts', { text, language, voice, speed }, signal); }
  transcribe(input: RecordingPayload, signal: AbortSignal): Promise<{ text: string }> { return this.request('/api/voice/transcribe', input, signal); }
}
