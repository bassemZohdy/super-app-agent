# Stable demo handoff — 24 October 2026

> **Superseded.** Feature work resumed later on 24 October 2026 under a new goal, and the commits after `79cd691` are on GitHub `main`. Current state is in the [changelog](../CHANGELOG.md) and [TODO.md](../../TODO.md). This page remains the dated record of the `79cd691` checkpoint.

Feature work was paused at the user's request at that checkpoint. Application code is restored exactly to **`79cd691`**, which is pushed to GitHub `main`. Only this handoff and the proposed AUTO-03 architecture are added after that application checkpoint.

## Run and inspect

- React: http://localhost:3000 (the existing development server is left running).
- Core: http://localhost:4000; Keycloak: http://localhost:8085.
- Local synthetic users: `bassem` / `demo-commuter`, password `demo123`.
- Existing Compose services, databases and local open-source text/voice services are left running. No volumes were reset.
- If needed: `npm run demo:wait`, then `npm run dev:react` when port 3000 is free. [Setup](local-development.md).

## Verified checkpoint

The checkpoint passed **397 tests**, **18 workspace builds**, ESLint/E2E TypeScript/docs/secret checks, **12 signed browser journeys**, and normal three-wallet restart/preservation checks. [Execution evidence](../reports/2026-10-24-payment-obligations.md).

Delivered behavior includes manual wallet/card bills, fines and recharges; refunds, statements and original-payment recovery; owner/workspace/source lifecycle checks; canonical business reservations and persistent capture attempts. [Latest recording](../recordings/payment-obligations/index.html).

The selected payment/automation backlog remains **24 delivered / 26 open**. PAY-08 remains open for actual automatic-caller qualification. Mandates still return `executionEnabled:false`; no scheduler or new unattended payment lane is enabled.

## Continue next

Start with **AUTO-03** and its [proposed implementation contract](../architecture/automation-permit-contract.md). Complete atomic budget/count/cooldown and occurrence reservation from current server-verified consent, then exact RFC 7523 issuance/binding and provider admission. Exercise actual automatic/manual races, unknown/restart/revocation and definitive failure release before checking off AUTO-03 or PAY-08. Keep the full [TODO](../../TODO.md) acceptance criteria.

The unfinished draft was saved locally at `.data/handoff/auto03-draft-20261024T150507Z`: the original tracked-file patch, protocol/run prototypes and a hash manifest. It is reference material, not validated code. Experimental order/mandate hooks and prototype modules were removed from the active worktree.

Existing user-owned `.gitignore`, `.claude/` and `CLAUDE.md` changes are preserved and excluded from these commits. No credentials, issuer keys, tokens or environment files were archived or published.
