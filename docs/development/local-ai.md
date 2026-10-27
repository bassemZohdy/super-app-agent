# Conversation models and local voice

The current demo uses internal modules. VoiceStudio is unnecessary for its four preset voices, short dictation and conversational replies. No VoiceStudio code, voice cloning, commercial speech API, music or third-party recordings are included.

## Select a conversation provider

Text inference is explicitly selected with `CONVERSATION_PROVIDER=local|openrouter|litellm`; `ENABLE_LOCAL_LLM=true` enables the selected provider (the variable name is retained for compatibility). Provider failures stay visible and never silently switch providers or models.

For an existing LiteLLM server, export `LITELLM_BASE_URL` (or its `LITELLM_URL` alias) and `LITELLM_API_KEY` in the server environment. In private `.env`, set:

```dotenv
CONVERSATION_PROVIDER=litellm
ENABLE_LOCAL_LLM=true
LITELLM_MODEL=glm-5.3
LITELLM_MAX_TOKENS=512
```

`MiMo-V2.6-Flash-RL` is an alternative model identifier when advertised by the configured server. The gateway model list is available through its authenticated `models` endpoint. HTTP is allowed only for explicitly configured loopback/Docker-local endpoints; remote endpoints require HTTPS, embedded credentials/query strings are rejected, redirects are refused, and only the LiteLLM key goes to that endpoint. The browser sees the selected provider and model, never its credentials or server URL. In the isolated compatibility Compose stack, core uses `LITELLM_TLS_RELAY=edge-relay:4443`. The existing edge relay opens one fixed TCP destination from the shared LiteLLM URL. TLS stays end-to-end: core verifies the upstream certificate and hostname, and the relay has no API key or plaintext model payload. Its port is internal only. Host-run agents call LiteLLM directly and need no relay variable. Recreate both processes after changing the shared endpoint or provider: `docker compose -f docker-compose.demo.yml up -d --no-deps --force-recreate edge-relay agent-core`. No general backend internet route is enabled.

For direct OpenRouter, select `CONVERSATION_PROVIDER=openrouter`, export `OPENROUTER_API_KEY`, and use `OPENROUTER_MODEL=openrouter/free` or a `:free` model. Requests go only to the official HTTPS endpoint and cap prompt/completion prices at zero. The local provider never receives either hosted key. Health distinguishes configuration from a recent actual reply; it does not probe remote services with credentials on every refresh.

Voice is optional for text chat and has a separate local service configuration. A gateway may advertise audio-transcription/audio-speech models through `model/info`; that does not establish microphone, language or playback quality. Selecting a text provider does not transmit microphone recordings to it. Existing voice capture remains gesture-bound and produces an editable draft before Send.

## Start and verify

Requires Docker Compose, Node 24+ and the installed npm dependencies. Allow at least 5 GB of Docker memory for the two inference services plus space for the rest of the demo. CPU inference is supported on the tested Intel Mac; latency depends on hardware.

```bash
npm run demo:up           # base stack, realm reconciliation, then local-ai:up
npm run dev:react
npm run local-ai:up       # rebuild/recreate just AI services and core; reuse model cache
npm run local-ai:test     # four private speech API tests in the running container
npm run local-ai:verify   # real generated audio, local transcription and model reply
npm run local-ai:browser  # synthetic microphone in a separate Chrome; no physical mic
```

The first setup downloads roughly 1.4 GB of explicitly allowlisted model files. `services/voice/models.json` pins repository revisions; `services/voice/uv.lock` locks Python dependencies. Setup writes revision markers and per-file SHA-256 receipts in the `voice-models` named volume. Review new weights/dependencies before updating either. No model weights are committed to Git. The published llama.cpp CPU image is digest-pinned in Compose. Model receipts record installed bytes; they are not a separately signed supply-chain attestation.

`voice` (4200) and `conversation` (4201) have **no published host ports**. The authenticated concierge on localhost:4000 is their public API. Setup alone enables Hugging Face downloads; the speech runtime has `HF_HUB_OFFLINE=1`, telemetry disabled and local-only model loading. Conversation loads a local GGUF file. Dependencies/images still need network access on first installation; this is not an air-gapped release or network-egress firewall.

## Use

Sign in, open Conversation settings and choose a preset and speed (0.8–1.2×). Preview uses an original Rashid greeting. Stop voice cancels capture, pending browser fetches and playback. Read replies aloud defaults off. Editing, sending, changing language/preset, hiding the page and leaving also cancel audio. Speech is a bounded companion to the full visible reply; URLs, markup and code are removed, with long replies shortened without changing the on-screen service details.

Use microphone captures at most about 14 seconds and 45 KB, then transcribes on the local app server. Review/edit the draft before Send. Dictation never submits a conversation message or approves a service action. Supported capture formats are browser-selected WebM/Ogg/MP4/WAV; availability depends on MediaRecorder and microphone permission. No OS/Web Speech or remote fallback is enabled by the app.

Installed presets speak English: Jasper, Bruno, Hugo and Luna. Whisper accepts English and Arabic dictation. Selecting Arabic disables spoken replies; Arabic text/model quality and full civic routing parity still need evaluation. Flutter can use local text replies but has no native speech integration. Physical microphone, speaker and accessibility/device quality checks remain manual acceptance work.

## Models and sources

| Function | Pinned source | Revision | Licence |
| --- | --- | --- | --- |
| Conversation | [Qwen2.5-1.5B-Instruct Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF) | `91cad51170dc346986eccefdc2dd33a9da36ead9` | Apache-2.0 |
| English voice | [KittenTTS mini 0.8](https://huggingface.co/KittenML/kitten-tts-mini-0.8) | `c02725660cea441db4c383af69f1f26f5cd00947` | Apache-2.0 |
| Dictation | [faster-whisper base](https://huggingface.co/Systran/faster-whisper-base) | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` | MIT |

The local adapters use [llama.cpp](https://github.com/ggml-org/llama.cpp) and [faster-whisper](https://github.com/SYSTRAN/faster-whisper), both MIT. The minimal Kitten CPU adapter derives from the published Apache-2.0 source. [Attribution and dependency licences](../../services/voice/THIRD_PARTY.md) distinguish permissive model licences from GPL/LGPL runtime components. Preserve all upstream notices and corresponding-source obligations when redistributing an image; the repository's MIT licence does not replace them.

## What the model sees

Earlier assistant turns sent back as history go through the same minimiser as the current surface (what the resident typed is only scrubbed of identifiers; what the assistant said was built from service state and follows the consent). The resident controls whether personal context is included per conversation (Conversation settings, "Share my profile details with the assistant", `POST /api/a2ui/model-privacy`); it is read on the next call and shared until turned off. Every model request goes through `services/agent-core/src/model-input.ts`. Raw identifiers (account, meter, card, ledger, order and receipt references, Emirates ID, phone, email, UUIDs, and any run of seven or more digits) are replaced with `[redacted]`, with or without consent, and `boundedMessages` applies this as a last net for every caller. The current surface is rebuilt for the prompt from an allowlist of structural properties (`type`, `variant`, `level`, `trend`, labels and text); unknown properties, node IDs, map coordinates and option IDs are dropped, and the surface streamed to the resident is not changed. While personal context is shared, amounts and dates stay so the model can answer from service data; when `state.metadata.modelPersonalContext` is `false`, every number is withheld. Consent is read for each call, so a withdrawal applies to the next one. All three concierge shells expose the profile-sharing control and restore its saved value. Personal context is shared by default. Covered by `services/test/p117-model-input.test.ts`.

## Configuration, bounds and failures

Compose sets `ENABLE_LOCAL_LLM=true`, `CONVERSATION_SERVICE_URL=http://conversation:4201` and `VOICE_SERVICE_URL=http://voice:4200`. Set `ENABLE_LOCAL_LLM=false` and recreate core for deterministic text. The setup readiness gate accepts explicitly disabled text inference and still requires speech readiness. The `.env.example` loopback endpoints are host-runner defaults; Compose supplies private DNS endpoints. Compose forwards the explicitly selected text provider configuration only to core; provider keys remain server-side.

The local provider accepts only fixed local inference hosts and paths. Explicitly selected hosted providers use their separate validated server configuration. Callers cannot choose model URLs or files. Authenticated speech requests allow installed presets, English TTS, bounded text/audio and one active request per actor (20/minute, two process-wide). CPU speech work is serial. Uploaded audio must have a matching media signature; FFmpeg is restricted to pipe input, forced demuxers, duration/output/time bounds. Text and audio stay in RAM and are not logged or written by inference. The local verification scripts deliberately write their synthetic fixture and the original public sample. Submitted transcripts/replies follow normal Redis chat retention (100 turns and configured session TTL).

Model requests use at most the latest 12 messages, a 24 KiB content budget, 192 output tokens for local/OpenRouter or a validated 64–1024 LiteLLM output limit (512 by default), 45 seconds and 30 calls/hour per actor/account. Model prose never grants tool authority or bypasses confirmed service actions. Failures are visible; text/manual service controls remain available. Cancellation stops browser capture/upload/playback; an already-running server inference may finish within its bounded deadline.

The conversation container explicitly probes `http://127.0.0.1:4201/health`; the pinned upstream image defaults to port 8080, which does not match this private service. A green container check confirms readiness, while `local-ai:verify` additionally proves real inference.

For a readiness failure inspect `docker compose -f docker-compose.demo.yml logs voice conversation agent-core`. Missing models: rerun `local-ai:up`. Busy: wait or type. Permission denied: allow microphone only for the local app. Unsupported Arabic speech: use text. Do not publish inference ports or send real customer audio to this demo.

[Voice architecture](../architecture/voice-and-conversation.md) · [Executed evidence](../reports/2026-10-24-local-ai.md) · [Original generated preview](../assets/voice/rashid-preview.wav).

The focused planner shares the LiteLLM configuration validator, identifier minimizer and per-owner budget implementation. It always withholds assistant amounts and keeps exact user-selected fine references outside provider input, binding them back to the validated plan server-side. Its owner key is subject/workload; the concierge uses actor/account. Budgets are process-local. The two paths preserve separate prompts and authority contracts.
