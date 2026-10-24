# Dependency triage: five production advisories (2026-10-24)

Scope: the five findings in `npm audit --omit=dev --json` (saved for this pass at `/tmp/audit-prod.json`, audit report version 2), triaged against this repository on branch `feature/p2-03-dep-triage`. This is backlog P2-03 triage evidence only. **No upgrade was performed.** No dependency, `package.json` or lockfile was changed. Each upgrade is a separate, tested pass (see [TODO.md](../../TODO.md), P2-03).

The audit counts 2 moderate and 3 high findings in the production tree (`dependencies.prod` 91 packages). Every finding below was checked against the repository, not against the advisory text alone.

## Triage table

| Package (installed) | Direct dependents (range) | Runtime placement | Reachability from this project | Advisory URL(s) and fix | Disposition |
|---|---|---|---|---|---|
| `@angular/core` (18.2.14), audit severity high | `apps/shell-angular` (`^18.2.0`) | Frontend SPA build only. Not a service in `docker-compose.yml` or `docker-compose.demo.yml`. Its `build`/`dev` scripts are the only consumers. | Not established for the template/i18n/XSS classes; none of the feature triggers found (see below). | 8 advisories in audit, e.g. `GHSA-prjf-86w9-mfqv` (i18n XSS), `GHSA-jj27-h5hq-8x99`, `GHSA-rgjc-h3x7-9mwg`. Fix: 22.2.3 (semver major). | Needs decision |
| `@angular/common` (18.2.14), high | `apps/shell-angular` (`^18.2.0`) | Same as above. | Not established for the HTTP/cache/date classes; features absent (see below). | 8 advisories, e.g. `GHSA-58c5-g7wp-6w37` (XSRF via protocol-relative URL), `GHSA-48r7-hpm6-gfxm` (formatDate OOM), `GHSA-q6f4-qqrg-jv6x`. Fix: 22.2.3 (major). | Needs decision |
| `@angular/platform-browser` (18.2.14), moderate | `apps/shell-angular` (`^18.2.0`) | Same as above. Audit lists it only as inheriting `@angular/common` and `@angular/core`. | Inherits the two rows above. | No advisory of its own; fix 22.2.3 (major). | Needs decision (same decision as the Angular rows) |
| `ajv` (8.17.1), moderate | Root `package.json` (exact `8.17.1`); `packages/protocol-core`, `packages/backend-kit`, `services/provider-simulator` (exact `8.17.1`); `services/agent-core` imports it through the root | Runtime. `protocol-core` and `backend-kit` are imported by the deployed services (agent-core, provider-simulator, service-* containers). | Partly established: the advisory needs the `$data` option. A repo-wide search for `$data` in sources returned no matches. Schemas are compiled from in-repo contracts (`requestSchema`, static schemas in `services/agent-core/src/mcp.ts`), not from request input. Other ajv code paths are not established as safe. | `GHSA-2g4f-4pwh-qvx6` (ReDoS when using `$data`), affected `>=7.0.0-alpha.0 <8.18.0`. Fix: 8.20.0 (minor). 8.20.0 is already in the tree via `@apidevtools/swagger-parser` and `@angular-devkit`. | Upgrade in a separate tested pass |
| `zod` (3.25.76), high, not direct | None in any workspace `package.json`. Pulled in by `@langchain/core@1.3.0` and `@langchain/langgraph@1.5.2` (both from `services/agent-core`). | Runtime. `services/agent-core` runs as the `agent-core` service in `docker-compose.demo.yml`. | Not established. No direct `zod` import in repo sources. Whether the LangChain/LangGraph code paths parse oversized, attacker-supplied collections with zod 3 was not traced. The zod 4.6.7 copies under `@modelcontextprotocol/*` are outside the affected range. | `GHSA-mrhx-c7xc-m3w5` (memory exhaustion on oversized constrained collections), affected `<4.6.6`. Audit reports a fix is available, but it is a transitive upgrade through the LangChain packages and was not verified here. | Upgrade in a separate tested pass; reachability must be established before any acceptance |

## Evidence notes

**Angular (three packages, one decision).**
- Declared only in `apps/shell-angular/package.json`, under `dependencies`. That is why they appear in the production tree.
- The shell is a client-side SPA: `apps/shell-angular/src` has three files (`main.ts`, `app/app.component.ts`, `index.html`). `npm run dev:angular` serves it on port 3001; the workspace `npm run build` builds it.
- Features tied to the advisory classes are absent from `apps/shell-angular/src`: no `HttpClient`, no XSRF module, no SSR or `provideClientHydration`/`HttpTransferCache`, no i18n or `@angular/localize`, no `DatePipe`/`DecimalPipe`/`CurrencyPipe`, no `innerHTML`, no `DomSanitizer` bypass, no dynamic component creation. The shell reads data through `packages/protocol-core` (`fetch`/SSE clients).
- The repository does not show that the shell is deployed. Neither compose file has a service that serves its `dist` output. `docker-compose.yml` lists `http://localhost:3001` only as a CORS origin.
- The decision is whether the Angular reference shell is a shipped artifact. If yes, the 18.x to 22.x move is a multi-major upgrade. If no, the choice is to keep it build-only or to retire it. Neither option is taken here.

**ajv.**
- All four direct declarations are exact pins to `8.17.1`, so the fix needs an edit to `package.json` files. That is part of the separate pass.
- The advisory's trigger is the `$data` option. Repo-wide search of `packages`, `services`, `apps` and `scripts` found no `$data` string. This is evidence that the documented trigger is not used, not proof that every ajv path is safe.
- Runtime validators: `packages/protocol-core/src/request-validation.ts` (`strict: true`, compiles contract schemas and validates request bodies), `packages/backend-kit/src/eligibility-client.ts`, `services/provider-simulator/src/*`, `services/agent-core/src/mcp.ts`.

**zod.**
- `npm ls zod --all` shows `zod@3.25.76` as the hoisted copy, required by `@langchain/core@1.3.0` (dependency of `services/agent-core`) and deduplicated for `@langchain/langgraph@1.5.2`.
- `@modelcontextprotocol/*` uses `zod@4.6.7`, which is outside the advisory range.
- The `zod` copy is a transitive runtime dependency of a deployed service. It is not a direct dependency to remove.

## Not established

- Whether zod 3 inside LangChain/LangGraph is reached with untrusted, oversized input in the agent-core request path.
- Whether any ajv validation path outside the `$data` option can be driven into the ReDoS-class behavior by request input.
- Whether the Angular reference shell is deployed anywhere outside this repository.
- Whether the audit's zod fix path resolves without a LangChain major upgrade (not checked).

## Next steps (not performed here)

1. Establish the Angular deployment status, then decide between upgrading to 22.x as a separate pass or keeping the shell build-only.
2. Upgrade `ajv` to 8.20.0 in a separate tested pass (minor, low risk).
3. Trace zod use from `services/agent-core` through `@langchain/core` before accepting or upgrading the zod finding.

## Verification of this report

Links in this report were checked by `npm run check:docs`. Reproduce the audit with `npm audit --omit=dev --json`.
