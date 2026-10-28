import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { config } from '../services/agent-core/src/orchestrator/config.ts';
import { CompatiblePlanner } from '../services/agent-core/src/orchestrator/planner.ts';
import { FinesAdapter } from '../services/agent-core/src/orchestrator/fines-adapter.ts';
import { VehiclesAdapter } from '../services/agent-core/src/orchestrator/vehicles-adapter.ts';
import { EVALUATION_CASES, EVALUATION_THRESHOLDS, EVALUATION_VERSION, evaluatePlanner } from './agent-evaluation.ts';
import { evaluatePlannerAuthority } from './agent-authority-evaluation.ts';

/** Explicit real-model qualification. Logs contain only static case IDs, bounded enums and measurements. */
async function qualify() {
  const cfg = config();
  if (cfg.AGENT_PLANNER !== 'compatible' || !cfg.AGENT_LLM_BASE_URL || !cfg.AGENT_LLM_MODEL) throw new Error('COMPATIBLE_PLANNER_REQUIRED');
  const planner = new CompatiblePlanner(cfg.AGENT_LLM_BASE_URL, cfg.AGENT_LLM_MODEL, cfg.AGENT_LLM_KEY, cfg.AGENT_LLM_TIMEOUT_MS, cfg.AGENT_LLM_MAX_TOKENS, cfg.AGENT_LLM_RESPONSE_FORMAT === 'json_object', cfg.AGENT_LLM_PROVIDER === 'local');
  const fines = new FinesAdapter(cfg.AGENT_SIMULATOR_URL, cfg.AGENT_WORKLOAD_KEY), vehicles = new VehiclesAdapter(cfg.AGENT_SIMULATOR_URL, cfg.AGENT_WORKLOAD_KEY);
  const tools = [fines.list, fines.pay, vehicles.list, vehicles.renew].map(({ id, description }) => ({ id, description }));
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const files = ['services/agent-core/src/orchestrator/planner.ts', 'scripts/agent-evaluation.ts', 'scripts/agent-authority-evaluation.ts', 'scripts/verify-agent-qualification.ts'];
  const provenance = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    sources: Object.fromEntries(files.map(file => [file, hash(readFileSync(file, 'utf8'))])),
    corpusSha256: hash(JSON.stringify(EVALUATION_CASES)), toolsSha256: hash(JSON.stringify(tools)),
    node: process.version, provider: cfg.AGENT_LLM_PROVIDER || 'compatible',
    model: /^[a-zA-Z0-9_./:-]{1,160}$/.test(cfg.AGENT_LLM_MODEL) ? cfg.AGENT_LLM_MODEL : '[nonstandard model identifier]',
    outputLimit: cfg.AGENT_LLM_MAX_TOKENS, requestDeadlineMs: cfg.AGENT_LLM_TIMEOUT_MS,
  };
  console.log(JSON.stringify({ evaluation: EVALUATION_VERSION, thresholds: EVALUATION_THRESHOLDS, cases: EVALUATION_CASES.length }));
  const quality = await evaluatePlanner(planner, tools, { onCase: result => console.log(JSON.stringify(result)) });
  const authority = quality.summary.passed ? await evaluatePlannerAuthority(planner) : { passed: false, skipped: 'QUALITY_GATE_NOT_PASSED' };
  const passed = quality.summary.passed && authority.passed;
  const report = { version: EVALUATION_VERSION, at: new Date().toISOString(), provenance, thresholds: EVALUATION_THRESHOLDS, quality, authority, passed };
  mkdirSync('.data/model-evaluation', { recursive: true });
  const artifact = `.data/model-evaluation/${report.at.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
  writeFileSync(artifact, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ summary: quality.summary, authority, passed, artifact }));
  if (!passed) process.exitCode = 1;
}
void qualify().catch(() => { console.error('Qualification could not complete; check private configuration or local test runtime. No values logged.'); process.exitCode = 1; });
