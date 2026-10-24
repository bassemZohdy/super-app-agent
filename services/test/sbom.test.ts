import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs the local SBOM generator offline (npm sbom reads the lockfile and node_modules only).
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sbomFile = fileURLToPath(new URL('../../dist/sbom/super-app-agent.cdx.json', import.meta.url));
const generator = fileURLToPath(new URL('../../scripts/generate-sbom.ts', import.meta.url));

test('sbom generator writes a CycloneDX document for production dependencies', () => {
  execFileSync(process.execPath, ['--experimental-strip-types', generator], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.ok(statSync(sbomFile).size > 0, 'SBOM file must not be empty');
  const sbom = JSON.parse(readFileSync(sbomFile, 'utf8'));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.ok(Array.isArray(sbom.components), 'components must be an array');
  assert.ok(sbom.components.length > 0, 'components must not be empty');

  // At least one component must carry a purl and a version, independent of workspace listing.
  const versioned = sbom.components.find(
    (component: { purl?: unknown; version?: unknown }) =>
      typeof component.purl === 'string' && typeof component.version === 'string',
  );
  assert.ok(versioned, 'expected at least one component with a purl and a version');
});
