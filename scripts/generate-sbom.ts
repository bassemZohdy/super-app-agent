import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Generates a local CycloneDX SBOM for the monorepo's production dependencies.
// Opt-in only: nothing runs this automatically, and no CI workflow is involved.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const outputFile = new URL('../dist/sbom/super-app-agent.cdx.json', import.meta.url);

function generateSbom(): string {
  // Argument array, no shell string: arguments are passed to npm verbatim.
  // Windows runs npm through its command shim, which only a shell can start. The arguments are fixed, so the shell adds no input.
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'npm.cmd' : 'npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit=dev'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: windows,
  });
}

function main(): void {
  let sbom: string;
  try {
    sbom = generateSbom();
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr?.toString().trim();
    const reason = stderr || (error instanceof Error ? error.message : String(error));
    console.error(`SBOM generation failed: ${reason}`);
    process.exit(1);
  }

  try {
    JSON.parse(sbom);
  } catch {
    console.error('SBOM generation failed: npm sbom did not return valid JSON');
    process.exit(1);
  }

  mkdirSync(new URL('.', outputFile), { recursive: true });
  writeFileSync(outputFile, sbom.endsWith('\n') ? sbom : `${sbom}\n`);
  console.log('Generated dist/sbom/super-app-agent.cdx.json');
}

main();
