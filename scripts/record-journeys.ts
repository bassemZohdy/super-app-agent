/** Records the readable journeys (QA-07) and publishes them only when every one passed. The last good publication stays when a run fails. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { manifestProblems, type Manifest } from '../test/browser/recording-rules.ts';

const staging = resolve('.data', 'recordings-staging', 'current'), published = resolve('docs', 'recordings', 'journeys');
rmSync(staging, { recursive: true, force: true });
const run = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'test', '-c', 'test/browser/recordings.config.ts'], { stdio: 'inherit', env: { ...process.env, RECORDINGS_STAGING: staging } });
if (run.status !== 0) { console.error('A journey failed: nothing was published and the last good publication is unchanged.'); process.exit(1); }

const scenarios = existsSync(staging) ? readdirSync(staging) : [];
if (scenarios.length === 0) { console.error('No recording was staged: nothing was published.'); process.exit(1); }
const manifests = scenarios.map(name => JSON.parse(readFileSync(join(staging, name, 'manifest.json'), 'utf8')) as Manifest);
const problems = manifests.flatMap(manifest => manifestProblems(manifest).map(problem => `${manifest.scenario}: ${problem}`));
if (problems.length) { console.error(`Not published: ${problems.join('; ')}`); process.exit(1); }

// Publish as a whole: build the new folder beside the old one, then swap, so a crash never leaves half a publication.
const next = `${published}.next`;
rmSync(next, { recursive: true, force: true });
mkdirSync(next, { recursive: true });
for (const name of scenarios) cpSync(join(staging, name), join(next, name), { recursive: true });
const index = manifests.map(m => ({ scenario: m.scenario, title: m.title, revision: m.revision, createdAt: m.createdAt, durationMs: m.durationMs, chapters: m.chapters.length, assertions: m.chapters.reduce((n, c) => n + c.assertions.length, 0), video: `${m.scenario}/${m.video}`, captions: `${m.scenario}/${m.scenario}.vtt`, manifest: `${m.scenario}/manifest.json` }));
writeFileSync(join(next, 'index.json'), `${JSON.stringify({ journeys: index }, null, 2)}\n`);
rmSync(`${published}.previous`, { recursive: true, force: true });
if (existsSync(published)) renameSync(published, `${published}.previous`);
renameSync(next, published);
rmSync(`${published}.previous`, { recursive: true, force: true });
console.log(`Published ${index.length} journeys to docs/recordings/journeys: ${index.map(j => `${j.scenario} (${Math.round(j.durationMs / 1000)}s, ${j.assertions} assertions)`).join(', ')}.`);
