/** Where a browser suite writes results, so two suites (or an interactive and a qualification run) can run side by side
 *  without sharing a trace, report or output folder (QA-09). The suite name is a short, fixed-shape label. */
import { join, resolve } from 'node:path';

export type ArtifactRoots = { suite: string; root: string; results: string; report: string };

export function artifactRoots(suite = process.env.E2E_SUITE || 'browser', base = process.env.E2E_ARTIFACT_ROOT || resolve('.data', 'e2e-artifacts')): ArtifactRoots {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(suite)) throw new Error('E2E_SUITE must be a lowercase label of letters, digits and hyphens.');
  const root = join(resolve(base), suite);
  return { suite, root, results: join(root, 'results'), report: join(root, 'report') };
}
