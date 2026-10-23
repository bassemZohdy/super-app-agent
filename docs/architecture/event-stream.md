# Authenticated event stream (custom protocol)

`GET /api/a2ui/stream?sessionId=...` uses the existing custom JSON envelopes. It does not implement official AG-UI or A2UI.

## Wire contract

- Send `Authorization: Bearer <access-token>` and optionally `Last-Event-ID: <event-id>`. Never put real tokens in a URL. React/Angular use a shared fetch client; their current token getter still returns `demo-local` until P0-01 login is implemented.
- Tokens are verified and session ownership is checked on every connection. A supplied Origin must match `CORS_ORIGINS`. Stream responses include `Vary: Origin`, no-cache/no-transform and proxy-buffering suppression.
- A connection starts with a handshake without an event ID. A fresh connection also receives the current surface snapshot, if any. A resumed connection receives journaled events strictly after its cursor.
- Journaled delta/render frames contain `id: <envelope.id>` and `data: <JSON>`. Heartbeats are comments every 20 seconds. Handshakes/snapshots do not advance a journal cursor.
- An unknown, evicted, expired or foreign-session cursor returns **409** with `STREAM_RESET_REQUIRED`. The web client clears its cursor and reconnects for a fresh snapshot. Session auth still runs first; replay never crosses subjects/sessions.
- Invalid/missing auth returns 401, a different subject returns 403, a malformed session returns 400 and exceeding five listeners/session returns 429.
- Connections close at token expiration or after five minutes, whichever comes first. The token getter is called before every reconnect. The shared client stops on 400/401/403; the shell must handle reauthentication. Immediate logout/revocation is not implemented.

## Bounds and recovery limits

| Resource | Bound / behavior |
| --- | --- |
| Replay journal | 100 events/session; 1,000 sessions; 8 MiB total serialized event bytes |
| Retention | Five-minute idle TTL, pruned on journal read/append; oldest session window evicted at capacity |
| Slow stream | Wait for Node `drain` after `write(false)`; queued + writable bytes above 256 KiB destroy that connection |
| Browser parser | Incremental UTF-8, CR/LF, multi-line data; one-million-character frame limit |
| Reconnect delay | Exponential 500 ms to 10 seconds; abort cancels reads and delay |

This is **single-process recovery**, not a durable event broker. Restart loses replay/owners/sessions; active-active ownership, durable events, per-user/total quotas, session TTL and revocation remain P0-05/P2 work. Snapshots restore the latest UI, not a full transcript of lost progress. A too-large frame can disconnect a consumer rather than bypass its memory bound. The journal uses JSON byte size; memory overhead and other session maps are not included.

Flutter retains its earlier stream implementation. Web transport tests do not establish Flutter parity or end-user browser login.

## Verification and references

`services/test/event-stream.test.ts` exercises signed-bearer real HTTP transport with mocked JWKS, ownership, origins, replay, expiry, UTF-8 framing, backpressure, reconnect/reset and 401 stop. See the [dated evidence](../reports/2026-10-23-release-gates.md) for actual execution and outstanding checks.

Design references: [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html), [Node HTTP response.write](https://nodejs.org/api/http.html#responsewritechunk-encoding-callback), and [Keycloak browser adapter/token lifecycle](https://www.keycloak.org/securing-apps/javascript-adapter). These references guide transport/login work; they do not imply protocol conformance or a completed PKCE integration.
