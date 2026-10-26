/** Records a journey as a readable video (QA-07). A chapter asserts the state first, shows its caption (and, in the picture itself,
 *  any simulated time or simulated failure), and then stays on screen for the time a viewer needs. Chapter times are measured, not
 *  planned, and a journey that fails publishes nothing: the evidence goes to a staging folder that `scripts/record-journeys.ts`
 *  publishes only when every journey in the run passed. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright/test';
import { scenarioTest, expect } from '../stack.ts';
import { MIN_HOLD_MS, manifestProblems, toWebVtt, type Chapter, type ChapterKind, type Manifest } from '../recording-rules.ts';

export const STAGING = resolve(process.env.RECORDINGS_STAGING || join('.data', 'recordings-staging', 'current'));
type Spec = { id: string; kind: ChapterKind; title: string; caption: string; simulatedTime?: string; failure?: string };

export class Recorder {
  readonly chapters: Chapter[] = [];
  private current: string[] = [];
  constructor(private readonly page: Page, private readonly t0: number) {}
  /** Run one assertion, name it, and count it toward the chapter that is open. */
  async assert(label: string, check: () => unknown | Promise<unknown>) { await check(); this.current.push(label); }
  async chapter(spec: Spec, show: () => Promise<void>) {
    this.current = [];
    await this.caption(spec);
    const startMs = Date.now() - this.t0;
    await show();
    // The state is asserted first; only then does the picture hold still for the viewer.
    const wait = MIN_HOLD_MS[spec.kind] - (Date.now() - this.t0 - startMs);
    if (wait > 0) await this.page.waitForTimeout(wait);
    const endMs = Date.now() - this.t0;
    this.chapters.push({ ...spec, startMs, endMs, assertions: this.current });
  }
  private caption(spec: Spec) {
    return this.page.evaluate(({ title, caption, simulatedTime, failure }) => {
      document.getElementById('qa07-caption')?.remove();
      const box = document.createElement('div');
      box.id = 'qa07-caption';
      box.setAttribute('role', 'note');
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#10202b;color:#fff;font:600 17px/1.4 system-ui,sans-serif;padding:10px 20px;border-top:4px solid #f0b429;pointer-events:none';
      const line = (text: string, color?: string) => { const el = document.createElement('div'); el.textContent = text; if (color) el.style.color = color; box.append(el); };
      line(title); line(caption, '#d8e6f0');
      if (simulatedTime) line(`Simulated time: ${simulatedTime}`, '#f0b429');
      if (failure) line(`Simulated failure: ${failure}`, '#ff9b8a');
      document.body.append(box);
    }, { title: spec.title, caption: spec.caption, simulatedTime: spec.simulatedTime, failure: spec.failure });
  }
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** A scenario test that records its page and stages a manifest, captions and video when (and only when) it passes. */
export const recordedTest = scenarioTest.extend<{ recordingStart: number; rec: Recorder }>({
  recordingStart: [async ({ page }, use) => { void page; await use(Date.now()); }, { auto: true }],
  rec: async ({ page, resident, recordingStart }, use, testInfo) => {
    void resident;
    const rec = new Recorder(page, recordingStart);
    await use(rec);
    const durationMs = Date.now() - recordingStart;
    await page.close();
    if (testInfo.status !== 'passed') return;
    const scenario = testInfo.title.split(':')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dir = join(STAGING, scenario);
    mkdirSync(dir, { recursive: true });
    const source = await page.video()?.path();
    expect(source, 'the page was recorded').toBeTruthy();
    copyFileSync(source!, join(dir, `${scenario}.webm`));
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const manifest: Manifest = { scenario, title: testInfo.title.slice(testInfo.title.indexOf(':') + 1).trim(), revision: git('rev-parse', '--short', 'HEAD'), createdAt: new Date().toISOString(),
      provenance: { stack: 'in-process payments, providers, gateway and operator on this machine; real local Keycloak sign-in; the issuer run clock is simulated only where a chapter says so', browser: testInfo.project.use.channel ?? 'chromium', viewport, synthetic: true },
      video: `${scenario}.webm`, durationMs, chapters: rec.chapters };
    expect(manifestProblems(manifest), 'the recording is readable and honest').toEqual([]);
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(dir, `${scenario}.vtt`), toWebVtt(rec.chapters));
  },
});
export { expect };
