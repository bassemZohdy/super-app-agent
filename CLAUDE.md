# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- Node.js 24+ and npm (`packageManager` is `npm@11.9.0`). Use `npm ci --ignore-scripts`, not pnpm, even though `pnpm-workspace.yaml` exists.
- Docker Compose is needed only for the integrated demo and `demo:verify*` scripts.
- Flutter 3.47+ / Dart 3.13+ for `apps/shell-flutter`, run from that directory.

## Commands

- `npm test`: offline Node test suite. Needs no Docker.
- `npm run lint`: ESLint with `--max-warnings 0`.
- `npm run check`: the full gate (lint, `check:e2e`, `check:docs`, `check:secrets`, tests, workspace builds). Run it before claiming a change is done.
- `npm run check:docs`: fails on broken local Markdown links in README, TODO.md, SECURITY.md and `docs/**`.
- `npm run check:secrets`: scans tracked source for OpenRouter keys and private keys.
- Scripts under `scripts/` run TypeScript directly through `node --experimental-strip-types`. There is no build step for them; `check:e2e` is their type check.
- Demo verification needs the running stack (`npm run demo:up`): `demo:verify`, `demo:verify:journeys`, `demo:verify:manual`, `demo:verify:security`, `demo:verify:restart`, `demo:verify:delegation`.
- `npm run test:redis` needs Redis on localhost:6379 or `TEST_REDIS_URL`.
- Local AI: `npm run local-ai:up` to start, `npm run local-ai:test` for the Python speech API tests (`services/voice`).

## Gotchas

- Do not run `npm run dev:backend` while the Docker demo stack is up. Both bind ports 4000–4006.
- The demo mounts the checkout read-only and does not hot-reload. Restart affected containers after source edits. Recreate them after env edits: `docker compose -f docker-compose.demo.yml up -d --force-recreate <service>`.
- Keycloak imports `services/keycloak/realm-export.json` only when the realm does not exist. Edits to that file do not reach an existing realm. Run `npm run demo:realm` (or `demo:delegation:realm`) to reconcile, then sign in again.
- `.env` holds local secrets and is gitignored. Edit `.env.example` for new keys. Never copy secrets into source or docs.
- All people, money and government entities are simulated. Never submit real card data.
- For payments, do not blindly repeat a charge with a new idempotency key when settlement is unknown. Inspect the provider payment or bill status and reconcile first.
- Do not add hosted LLM inference. The app runs local llama.cpp/Qwen and internal speech services only. Set `ENABLE_LOCAL_LLM=false` for deterministic replies.

## Git and PRs

- Only `main` exists; there is no `develop`. Branch as `feature/<short-description>` from `main`, and open PRs into `main`.
- Commit messages use Conventional Commits with a scope, lowercase, e.g. `feat(payments): ...`, `fix(local-ai): ...`.
