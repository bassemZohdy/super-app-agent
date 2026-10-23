# Voice and conversational chat

React and Angular offer microphone drafts and opt-in browser speech after sign-in. Flutter displays assistant text; native speech remains open. Typed messages and submitted transcripts use the same selected-account session and provider-backed service path.

## Using the chat

1. Choose **Use microphone** and grant browser access. English and Arabic recognition locales depend on the browser; service routing mainly understands English.
2. Review or edit the transcript, then press **Send**. The current React interface does not automatically submit dictation.
3. Read the reply and inspect the service surface. Follow-ups such as “explain this” retain the current proposal; explicit service names can change the topic.
4. Enable **Read replies aloud** for browser speech synthesis. Spoken replies default off. Cancel voice, editing, a new request, tab hiding and teardown cancel audio.
5. Execute service effects through the offered confirmation button. Chat assent does not book/pay. Cancellation clears an outstanding proposal and cannot undo a completed provider operation.

## Replies and persistence

Committed custom surfaces carry `assistantMessage: { id, text }` with the current revision. HTTP and SSE carry the same reply; web clients deduplicate the revision and do not speak progress events. Domain failures use sanitized outcome messages.

`conversation.ts` supplies bounded deterministic greetings, help, explanations, assent handling, cancellation and follow-ups. With a configured key and live inference enabled, the graph also calls OpenRouter with the last 12 turns and bounded current service surface. Generated text reaches clients. Routing, capability execution and approval checks remain deterministic; generated prose does not authorize a mutation. A model failure remains visible alongside available service results.

Redis integration persists the last 100 turns, surface and reconciliation state under a subject/account binding. The fixture runner keeps conversation state in memory. Explanations describe a surface snapshot rather than a fresh provider check. Neither mode implements a versioned durable workflow engine or model-selected tool planning.

## Audio and privacy

`voice-client.ts` wraps browser recognition and speech synthesis. Missing APIs, permission/network/language/playback failures leave text input available. Recognition and synthesis cancel each other; disposal detaches callbacks. Transcript input is limited to 4,000 characters and spoken playback to 3,000 characters.

Browser speech recognition may process audio remotely. The app stores no raw microphone audio; submitted transcripts follow normal session retention and may be sent to OpenRouter when enabled. The authenticated `/api/a2ui/tts` endpoint remains an optional server adapter with fallback information. Its existence does not prove a working OpenRouter neural voice or browser integration with that endpoint; current React playback uses browser synthesis.

## Evidence and limits

Node tests use fake speech engines to check drafts, cancellation, lifecycle/errors, and HTTP/SSE conversation consistency. Controlled model tests cover generated replies, retained context and visible provider errors. The [current report](../reports/2026-10-24-demo-completion.md) records the real provider/key result. Actual microphone/speaker permissions, recognition quality, neural TTS and native speech/device execution remain unverified. Full Arabic service understanding and production audio/egress consent remain in [TODO](../../TODO.md).
