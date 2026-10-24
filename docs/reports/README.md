# Execution evidence register

Implementation baseline: `283521a` on 24 October 2026. Results describe the source and environment recorded, not a production certification. Planning updates do not create new feature evidence.

| Evidence | Verified scope | Interpretation |
| --- | --- | --- |
| [Payment accounts](2026-10-24-payment-accounts.md) | 136 tests, 18 builds and real-Keycloak isolated setup/quote/browser checks | PAY-01 delivered; no new financial execution or automation |
| [Local AI](2026-10-24-local-ai.md) | 130 Node tests, 18 builds, 12 browser journeys, four speech API tests, actual CPU text/speech/dictation, synthetic browser capture/playback, Flutter analysis/six tests, delegation security | Latest delivered baseline; physical/native/Arabic speech limits remain |
| [Delegation](2026-10-24-delegation-demo.md) | Exact-image RFC 7523, separate broker, current grants, bounded writes/revocation, paced browser evidence | Supported no-preview demo; recurring payment mandates are not implemented |
| [Demo completion](2026-10-24-demo-completion.md) | Provider/Redis/manual/MCP/restart/security and then-current 114 tests/17 builds | Earlier stage; hosted-model observations are historical |
| [Provider browser recording](../recordings/runs/20261024T010609Z-video/report.md) | Twelve isolated journeys, 34 checks, measured pacing and then-current 120 tests/17 builds | Canonical dated recording, independent of later model changes |
| [Older reports](../INDEX.md#evidence-and-provenance) | 23 October checks and original fixture scenarios | Preserve original observations; not current feature claims |

Current setup: [local development](../development/local-development.md), [local AI](../development/local-ai.md), [delegation](../development/delegation.md). Proposed work and its acceptance gates live in [TODO](../../TODO.md).

[Payment/automation planning and cleanup](2026-10-24-payment-planning.md) records documentation/media maintenance and 50 proposed tasks. It is planning evidence; the subsequent payment-account report records the first delivered setup slice. Recurring mandates and automatic services remain unimplemented.
