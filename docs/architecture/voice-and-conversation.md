# Voice and conversational chat

React and Angular use an internal open-source speech module and local Qwen conversation. VoiceStudio is not required. Flutter displays text replies; native speech remains open. [Setup, sources and licences](../development/local-ai.md).

## User flow

1. Sign in and open Conversation settings → Voice studio. Choose Jasper, Bruno, Hugo or Luna, a speed and Preview voice. Stop voice cancels playback.
2. Use microphone captures a short recording, then shows Transcribing locally. English and Arabic dictation become an editable draft. Review before Send; nothing is auto-submitted.
3. Read the reply and inspect the service surface. Read replies aloud is opt-in and English-only. Arabic uses text replies. Full localised service routing still needs evaluation.
4. Execute effects only through the offered confirmation button. Chat assent, dictation and generated prose cannot book/pay. Cancel invalidates an outstanding approval and cannot undo a completed provider operation.

Editing, new requests, language/preset changes, hiding and teardown cancel capture/fetch/playback. Explicit draft errors leave typing available. Server inference may finish after browser cancellation within bounded deadlines. No automatic browser recognition, OS synthesis or cloud fallback is enabled.

## Boundaries and persistence

MediaRecorder → authenticated `/api/voice/transcribe` → private FastAPI → bounded FFmpeg decode → faster-whisper base CPU/int8 → draft. Audio is limited to 45 KB and 15 seconds; capture auto-stops earlier. File signatures, fixed formats, pipe-only decode and duration/output/time limits reject non-audio/playlist inputs. Audio is not written or logged by inference.

Committed assistant text → bounded speech companion → authenticated `/api/a2ui/tts` → private KittenTTS ONNX CPU → WAV playback. Four presets and speeds 0.8–1.2× are allowlisted. Speech input is limited to 480 characters; markup, URLs and code are removed, and long text is shortened while full details stay visible. Arabic synthesis is explicitly unavailable.

The active graph calls private llama.cpp/Qwen with bounded recent chat and current service context. Model responses reach HTTP/SSE clients; errors remain visible. Routing, tool selection, service validation and approval remain deterministic. The old OpenRouter text module is retained only for explicit diagnostics/tests, not active inference. Hosted TTS was removed.

Committed custom surfaces carry `assistantMessage: { id, text }`. Web clients deduplicate revisions and never speak progress events. Redis persists up to 100 turns, surface and approval state under the selected subject/account and TTL; submitted transcripts follow that normal chat retention. Fixture tests use memory. Explanations describe snapshots, not a new provider check. Model-selected planning and durable workflow migration remain separate backlog items.

`GET /api/voice/config` reports installed presets/readiness and limits. `/health` probes actual llama.cpp readiness and voice model-file readiness; first inference still loads speech engines. Speech APIs require an access token; private inference services publish no host port. Model revisions/dependencies are pinned, and only explicit setup downloads files. See [security boundaries](../../SECURITY.md).

## Evidence and limits

[Executed local AI checks](../reports/2026-10-24-local-ai.md) cover real CPU speech/transcription/model output plus browser draft review and playback controls. Unit/API tests cover cancellation, late permissions, no remote fallback, silence, invalid audio and limits. Synthetic browser audio does not establish physical microphone/speaker quality, accessibility or all devices. Arabic evaluation, native speech and production audio operations remain open in [TODO](../../TODO.md).
