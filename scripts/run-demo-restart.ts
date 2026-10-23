import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'cityside-restart-'));
const env = { ...process.env, DEMO_RESTART_RECORD: join(dir, 'record.json') };
function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
try {
  await run(process.execPath, ['--experimental-strip-types', 'scripts/verify-demo-restart.ts', '--prepare']);
  await run('docker', ['compose', '-f', 'docker-compose.demo.yml', 'restart', 'agent-core', 'redis', 'provider-payments']);
  await run(process.execPath, ['--experimental-strip-types', 'scripts/wait-demo-stack.ts']);
  await run(process.execPath, ['--experimental-strip-types', 'scripts/verify-demo-restart.ts', '--verify']);
} finally { await rm(dir, { recursive: true, force: true }); }
