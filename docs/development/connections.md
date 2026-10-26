# Connections view

The **Connections** view (workspace tools, next to Delegated access and Payment accounts) shows which providers the concierge talks to, the operations each one advertises, and the calls made for the signed-in resident, with failures in words. It is read-only.

## How discovery works

`GET /api/connections` (optionally `?refresh=1`) asks `packages/backend-kit/src/connections.ts` for each of the seven providers. Each provider is read from a fixed address (its `PROVIDER_<NAME>_URL`, or the local default) at `/openapi.json`, with redirects refused, a four-second limit and a 2 MB cap. The result is cached for 30 seconds per provider; `refresh=1` (the **Check connections** button) reads again.

A document is accepted only if it is OpenAPI 3.1, every path is a plain path (no `..`, encoded dots or slashes, query, fragment, backslash, scheme or `//`), every operation has a valid unique `operationId`, and any `servers` entry is relative, on the provider's own host or a local address. A refused document is shown as `Refused · <reason>` and lists no operations; the other providers are unaffected. An unreachable provider says so without echoing the address it tried.

`bindOperation` resolves a call by its operation ID against the advertised operations and the provider's own origin: the address in the document is never used, path parameters are percent-encoded (and `.` or `..` refused), and a result that would leave the provider's origin is refused.

## What the call record holds

`ProviderClient` records every call for its owner: time, provider, method, path, status, an error code on failure and the duration. Account and object ids in the path are replaced (`/v1/accounts/{account}/payment-orders/{id}/approve`), the record is bounded to 50 calls per owner and 500 owners, and `/api/connections` returns only the signed-in owner's calls, newest first. Nothing else about a call (headers, bodies, tokens) is kept.

## Design brief and checklist (QA-10)

*Who and why:* a resident, or someone helping one, who wants to know whether the concierge's services are reachable and what a failed payment or lookup actually called. *Shape:* one region with a heading, one **Check connections** button, a status line, one article per provider (state in words; operations in a disclosure with a captioned table that scrolls inside its own region) and a list of recent calls. *Feedback:* the status line says how many connections have a problem; a call is `OK 200` or `Failed 409 CODE`, never only a color. *Responsive:* the table scrolls in its region; paths wrap in the list; nothing makes the page scroll sideways. *Tokens:* colors come from `theme.css` custom properties only.

Checked by `test/browser/connections/connections.spec.ts` on the phone and desktop projects: every control is at least 44px with 14px text, every provider article and table is named, nothing scrolls sideways, a refused provider is stated and lists no operations, and the call list shows OK and failed calls without an account id. `npm run check:tokens` passes.
