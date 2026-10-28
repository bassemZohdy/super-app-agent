# Local selected-planner qualification — 28 October 2026

Executed against clean implementation revision **`44e2d168e2a2b0d4b46f89dcc83048279c59e660`**, using the existing local llama-server. The [machine-readable evidence](2026-10-28-local-planner.json) records source/corpus/tool hashes, every case result, configured limits and the live authority checks. No hosted or fixture inference fallback was used.

## Target and reproducibility

- Runtime: Node v24.15.0, Darwin arm64; llama-server build `9750 (bf533823c)`.
- Model: `unsloth/Qwen3.5-4B-GGUF:Q4_K_M`, weight revision `e87f176479d0855a907a41277aca2f8ee7a09523`.
- Weight file: 2,740,937,888 bytes; SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.
- Context: 8192 tokens; resident server with four slots. Classification used sequential calls with no intentional concurrent inference.
- Selection: `AGENT_PLANNER=compatible`, `AGENT_LLM_PROVIDER=local`, loopback `/v1/`, JSON schema generated from `Plan`, reasoning disabled per request, 512 output tokens and a 15-second request deadline. No API key was needed or inherited from hosted configuration.
- Corpus: `fines-renewal-en-ar-v1` in [agent-evaluation.ts](../../scripts/agent-evaluation.ts), with 12 English and 12 Arabic cases. The source hashes in the JSON pin the exact prompt and runner.

Reproduce with the private local configuration described in [integrations](../integrations.md#local-llama-server-planner), then run:

```bash
npm run check
npm run check:agent
npm run agent:qualify:model
npm run agent:verify:model
```

## Declared gates and observed results

| Gate | Declared threshold | Observed |
| --- | --- | --- |
| Intent and exact selection | Every case correct | 24/24; English 12/12, Arabic 12/12 |
| Individual classification latency | At most 15 seconds | Maximum 915 ms |
| Classification p95, nearest rank | At most 8 seconds | 823 ms |
| Live authority checks | Every check passes | Eight passed |
| Provider errors | Fail; no retry or fallback | Failure handling retained and covered offline |

The live authority checks used the same actual local model through a disposable HTTP/LangGraph/SQLite simulator. They verified read-only listing; an exact selected-fine quote with no pre-approval effect; refused typed assent, mismatched approval and cross-owner inspection; one simulated payment with an idempotent replay; and an Arabic vehicle renewal with separate fines and renewal approvals. Temporary state and random synthetic credentials were removed after the checks. Interactive demo databases were not opened or reset by qualification.

`npm run check` passed: 947 offline tests passed, two optional tests skipped, and 19 workspace builds succeeded. `npm run check:agent` passed all 55 focused tests, including malformed/invented/oversized replies, truncation and reported output-budget overruns, real header/body deadline stalls and graph failure without consent or effects. Browser and Compose suites were not rerun for this backend-only change.

## Interpretation and limits

This is acceptance evidence for the finite local demo corpus and the pinned local model, not general model quality, production identity, real financial effects, native devices or other hardware. The corpus was used during prompt development and is not an independent held-out set. Earlier local runs exposed classification ambiguity and invalid shapes; the final clean-revision run uses the same declared gold cases and thresholds. Latency excludes model loading/download and measures an already resident, warmed server; it does not establish concurrent capacity. Prior LiteLLM/OpenRouter connection failures are not converted into passing hosted-provider evidence.

Authorization, exact consent, current quotes and original-operation idempotency remain outside the model. Configuration, model weights or prompt changes require qualification again. Credentials, endpoint URLs and raw provider replies are excluded from the checked-in JSON evidence.
