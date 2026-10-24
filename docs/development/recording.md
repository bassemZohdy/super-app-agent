# Browser E2E scenarios and readable recordings

The fast browser checks and paced video use the same twelve asserted journeys in `scripts/e2e/runner.ts`. They exercise the current React shell, real local Keycloak PKCE/introspection, REST application/provider boundaries, independent SQLite state and Redis conversations. All records and money are simulated. Replies are deterministic; the isolated recorder disables local text inference and makes no speech/model calls. Real local AI has [separate checks](local-ai.md).

## Run

Requires the project's Node/npm dependencies, installed Google Chrome, `ffmpeg` and `ffprobe` on PATH. Playwright also needs its own small video helper:

```bash
npm ci --ignore-scripts
npx playwright install ffmpeg
npm run demo:up
npm run test:e2e      # same browser assertions, no presentation pauses or video
npm run test:video    # full paced recording, MP4/WebM, captions, screenshots and report
npm run recordings:serve
```

Open [the recording viewer](http://localhost:3300). It has measured chapter timestamps, click-to-seek controls, timed English captions, downloads and assertion reports. Its loopback Node server supports HTTP byte ranges so video seeking works. The recording has no audio. The title/status annotations are recording captions, not agent reasoning. Use HTTP rather than a file URL for reliable video/caption loading.

The recorder builds a separate production React bundle. It does not reuse a stale frontend, silently attach to occupied ports, reset existing provider volumes or modify the running demo's environment. It starts its own local core/application/provider servers and fresh temporary SQLite databases, while reusing local Keycloak (8085) and Redis (6379). Its browser context is new and tokens stay in memory. Login uses the public seeded `demo-commuter` account.

Default recording frontend: **3002**, a seeded Keycloak redirect origin. Ports **14000–14006** and **14101–14107** must be free for isolated APIs. Existing React/Angular processes on 3000/3001 can keep running. If 3002 is occupied, stop that frontend or select another free seeded origin with `E2E_APP_PORT=3000` or `3001`. Do not terminate an unrelated process. The API base can be changed with `E2E_CORE_PORT` (10000–65000).

## Pacing and readiness

| Phase | Default pause |
| --- | --- |
| Chapter introduction | 3.5 seconds |
| Review a prepared surface | 6 seconds |
| Before confirmation / draft submission | 1.5 seconds |
| Receipt or cancellation result | 8 seconds |
| Closing summary | 7 seconds |

These holds occur **after** response, surface and enabled-state checks. Network/UI timeouts remain separate (45 seconds). The recorder scrolls the service pane back to its heading for review, then reveals confirmation controls before clicking them. It does not use network-idle waits on persistent SSE connections.

`E2E_PACE` multiplies all presentation holds: `1` is normal video pacing; `1.5` is slower; `0` removes holds for debugging. Values outside 0–3 fail. Fast `test:e2e` defaults to 0; `test:video` defaults to 1. Pace-0 debug clips stay in ignored diagnostics and do not replace the readable viewer.

```bash
E2E_PACE=1.5 npm run test:video
```

## Scenarios and independent checks

1. **Sign in:** actual PKCE login reaches the account workspace.
2. **Wallet:** altered amount fails; cancellation removes the action; cancelled/consumed approvals cannot replay; one confirmed 50 AED top-up changes the ledger once.
3. **Parking:** selected zone and owned plate, two-hour activation, same-ticket extension and exact tariff debits.
4. **Utilities:** fresh unpaid bill becomes paid and wallet matches its authoritative amount.
5. **Telecom:** the selected Etisalat bill becomes paid for its exact amount.
6. **Traffic fines:** chat prepares the review; confirmed fines disappear from unpaid provider state with exact debit.
7. **Ride:** receipt's real booking ID tracks; an invented booking returns 404.
8. **Dining:** receipt's persisted order ID tracks; an invented order returns 404.
9. **Move-in:** no connection/permit exists before approval; confirmation creates matching DLD, DEWA and RTA records in isolated SQLite.
10. **Unified checkout:** paid utility/fine resources are not charged again; only the remaining Salik recharge changes wallet/toll balances.
11. **History and accounts:** open the original dining receipt from history, switch to separate household funds, return, and reload without creating another order.
12. **Sign out:** private account controls and receipt disappear; no browser script errors occurred.

Missing controls, unexpected HTTP responses, incorrect effects, missing receipts and visible `undefined`/`NaN` placeholders **fail the run**. Utility receipts retain the actual premise, dining uses the delivery-time contract, ride receipts retain the selected driver ETA, fines retain the account-owned plate and provider discount, and the unified review quote must exclude paid bills. Required steps are never conditionally skipped and a partial run is never labelled successful.

## Artifacts, cleanup and evidence

Successful videos are published under `docs/recordings/runs/<UTC timestamp>-video/`: MP4, WebM, timed VTT, screenshots, measured media metadata, JSON assertions and a Markdown report. The viewer and `latest.json` update only after every chapter and media check passes. The original recording remains at [the historical viewer](../recordings/legacy.html).

Fast checks and failed-run diagnostics stay under ignored `.data/e2e/`. A failure saves its screenshot and report, returns nonzero and preserves the last successful viewer/video. Credentials, access/refresh tokens, browser storage, raw request headers and network traces are not written to reports. Only synthetic UI screenshots and allowlisted assertion summaries are published.

The runner closes only its own browser/HTTP servers, deletes its recording-owned Redis sessions/graph continuations and temporary SQLite/build directory. A cleanup failure leaves a short Redis TTL as a fallback. It never clears shared Redis or deletes the running demo's SQLite volumes. Do not run two recording instances on the same chosen ports.

`npm run check:e2e` strictly type-checks the harness. Default tests also protect pacing bounds, timestamp formatting and preservation of the previous successful viewer on failed/incomplete publication. A green recording covers these selected journeys; it does not establish native parity, production identity/payment authority, official UI protocol compatibility or local model/speech quality.

## Latest verified recording

[Watch the current recording](../recordings/index.html): **4:09**, 1600 × 1000, twelve chapters and 34 recorded checks, with 6-second reviews and 8-second receipts. [MP4](../recordings/runs/20261024T010609Z-video/cityside-e2e.mp4) · [Assertion report](../recordings/runs/20261024T010609Z-video/report.md). Browser verification confirmed the media loads without error and the unified-checkout chapter seeks correctly. That recording’s dated suite passed 120 tests and 17 builds. The later [local AI verification](../reports/2026-10-24-local-ai.md) records 130 tests and 18 builds; it does not alter the video’s original provenance.

## Delegation recording

`npm run record:delegation` records the running synthetic reference stack and React shell, with six-second reviews and eight-second results after asserted state waits. It covers explicit wallet-read consent, broker/provider execution, audit, revocation and a separately approved one-time AED 1 synthetic credit. Unlike the twelve-chapter harness above, it uses the running provider state and adds that exact synthetic credit; both grants are revoked. It stores dated runs under `docs/recordings/delegation/runs` and promotes only successful video. [Watch delegation](../recordings/delegation/index.html) · [Runbook](delegation.md). No traces or token dumps are captured.

The post-delegation regression reran all twelve existing journeys successfully with the strict interactive provider policy. Its isolated APIs explicitly block the live broker backchannel, so this harness cannot accidentally execute a live grant. The dedicated delegation recorder above remains the evidence for the separate grant flow.

Delegation recordings keep their dated run files as the canonical media. The delegation viewer points directly at the latest successful run; a second copy of that WebM is not retained. Earlier successful runs remain dated evidence.
