# P0-10 session transitions — 23 October 2026

Per-session coordination covers intent/action graph execution, error handling, revision assignment and final broadcasts. Overlap returns 409 without changing messages or effects. Different sessions proceed independently. All action requests must echo the current server-issued surface UUID as `surfaceRevision`; replacement invalidates previous approvals even when timestamps match. No accumulated consumed-action Set remains.

Invalid input leaves the approval usable. Definitive failed execution rotates to a warning surface and releases the coordinator so a corrected intent can be proposed. Partial/unknown effects retain their step summary and reject both further intents and actions with `RECONCILIATION_REQUIRED`; no reset API enables blind retry. All three shells and the flight recorder echo revisions. Frontend error display/selection correctness continues under P1-12.

Validation: 72 Node tests, no failures/skips; forced build 14/14 JS tasks; whitespace checks. Five new test groups exercise controlled overlapping intents/actions, another session during a pause, duplicate writes, identical timestamps, HTTP/SSE revision agreement, invalid envelopes, definitive rejection/retry, and applied-then-thrown writes. The existing partial-outcome regression also checks blocked refresh.

Limits: all coordination/ownership/reconciliation state is in memory. Restart, multiple instances, alternative sessions, provider idempotency, reconciliation authorization/status/compensation and tenant isolation are P0-03/P0-05/P0-06. No real provider, model, workflow, browser, Keycloak, container or Flutter/native execution was performed.
