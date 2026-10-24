import { gatewayUrl } from './endpoints.ts';
/** Explicit local setup: reviewed model revisions only; no cloud credentials. */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const compose = ['compose', '-f', 'docker-compose.demo.yml', '--profile', 'local-ai'];
async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', [...compose, ...args], { stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Local AI setup failed (${code}).`)));
  });
}
console.log('Preparing internal open-source text and speech. First setup downloads roughly 1.4 GB of pinned models; later runs reuse them.');
await run(['build', 'voice']);
await run(['run', '--rm', '--no-deps', '-e', 'HF_HUB_OFFLINE=0', 'voice', 'python', 'download_models.py']);
// The demo mounts source; recreate the core so an existing process loads changes.
await run(['up', '-d', '--force-recreate', 'voice', 'conversation', 'agent-core']);
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await response.json() as any;
    if ((data.llm?.ready === true || data.llm?.enabled === false) && data.voice?.ttsReady === true && data.voice?.asrReady === true) { console.log(`Ready: ${data.llm?.enabled ? 'local Qwen conversation' : 'deterministic text'}, KittenTTS voices and Whisper dictation. No cloud API key required.`); process.exit(0); }
  } catch {}
  await delay(1000);
}
throw new Error('Local models did not become ready. Inspect voice/conversation container logs.');
