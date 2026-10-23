# Voice and conversational chat

> Current scope: browser dictation drafts and opt-in speech playback remain available after Keycloak login. React no longer auto-sends dictated messages. Server TTS remains an optional API; browser playback does not prove remote neural voice availability. Session storage and identity are described in the [provider guide](../demo/provider-backends.md).

React and Angular now offer microphone dictation and optional spoken replies alongside typed chat and interactive surfaces. Flutter displays the same assistant text, with native speech support still a backlog item.

## Using the chat

1. Select **Use microphone**, allow browser microphone access, and speak. English and Arabic recognition locales are offered where the browser supports them. Current service routing mainly understands English; Arabic greetings/assent are recognized, but full Arabic service conversations are not implemented.
2. Review or edit the transcript in the normal message field, then press **Send**. Recognition never sends a request automatically.
3. Read the assistant response in the transcript and inspect the matching surface. Ask “explain this,” “what happens next,” or “show me the options.” Explicitly naming another service changes the topic.
4. Enable **Read replies aloud** to speak future assistant replies. **Cancel voice** stops listening/playback. Editing, sending a new request, hiding the tab or unmounting also cancels audio. Spoken replies default off.
5. Bookings/payments still require the surface button and matching revision. Saying “yes,” “book it” or “pay it” only asks the user to review that button. “Cancel that” clears the current approval; it does not undo completed provider operations.

## Contracts and implementation

Committed custom surfaces may include `assistantMessage: { id, text }`, where the ID is the committed revision. HTTP and SSE share the same message. Web shells validate the surface/session/revision and append/speak the message once for the current revision; they never speak progress deltas. Failure replies use the sanitized execution-outcome message. Existing surface-only clients remain compatible.

The core already records turns in its process-local session. `conversation.ts` handles bounded greetings/help/thanks, current-proposal explanation, safe textual assent, cancellation and simple topic-preserving follow-ups. It is deterministic and does not add a general LLM conversation engine, model planning, durable history or parameter extraction. A response explaining the surface is a snapshot, not a fresh provider status check. P1-03 and P0-05 track those remaining boundaries.

`voice-client.ts` wraps standard/prefixed browser recognition and speech synthesis without new dependencies, provider keys, audio uploads to our backend or automatic resubmission. Missing APIs, denied permission, no microphone/speech, network/language/start/playback errors expose a text fallback. Recognition and synthesis cancel each other; disposal detaches callbacks and aborts capture. Transcripts are capped at the existing 4,000-character input limit; playback is capped at 3,000 characters while the full reply remains visible.

## Browser, privacy and validation boundaries

Speech recognition availability varies by browser, device, security context and language. Use a supported browser on localhost or HTTPS. Some browsers send audio to their recognition service, so this feature is not an offline/on-device guarantee. The UI discloses that processing before activation; this app stores no raw audio. Submitted transcripts are handled like typed messages in the selected account-bound session (Redis in integrated mode, memory in the fixture runner). Browser/OS speech services may have their own processing policies.

Primary references: [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [Web Speech usage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API), [recognition errors](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error).

84 Node tests and 14 JS workspace builds pass. Fake speech-engine tests verify lifecycle, bounded final drafts, permission/network failures, unsupported APIs, cancellation, stale callbacks and playback errors. Conversation regressions verify topic isolation, shared HTTP/SSE replies, no effects from explanations/assent and invalidation on cancellation. Actual browser microphone/speaker, browser permissions and native speech execution have not been verified in this environment. Native Flutter speech and real device validation remain open in TODO.md.
