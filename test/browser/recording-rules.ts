/** What a recorded journey must show to be readable (QA-07), kept apart from the browser so it can be tested offline: the
 *  shortest time a chapter may stay on screen, the manifest every publication carries, and the captions as WebVTT. */
export type ChapterKind = 'state' | 'review' | 'receipt' | 'recovery';
/** Milliseconds a viewer needs: a review is read, a receipt is checked line by line, a recovery is followed step by step. */
export const MIN_HOLD_MS: Readonly<Record<ChapterKind, number>> = { state: 3000, review: 6000, receipt: 8000, recovery: 6000 };

export type Chapter = {
  id: string; kind: ChapterKind; title: string; caption: string;
  /** Said on screen when the run's clock was moved by the operator; never left to be mistaken for real time. */
  simulatedTime?: string;
  /** Said on screen when the chapter shows a simulated failure. */
  failure?: string;
  startMs: number; endMs: number; assertions: string[];
};
export type Manifest = {
  scenario: string; title: string; revision: string; createdAt: string;
  /** Where the evidence came from: how the stack ran and what it touched. */
  provenance: { stack: string; browser: string; viewport: { width: number; height: number }; synthetic: true };
  video: string; durationMs: number; chapters: Chapter[];
};

/** Problems that make a manifest unfit to publish. Empty means readable and honest. */
export function manifestProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  if (!/^[0-9a-f]{7,40}$/.test(manifest.revision)) problems.push('revision is not a git revision');
  if (manifest.chapters.length === 0) problems.push('no chapters');
  let previousEnd = 0;
  for (const chapter of manifest.chapters) {
    const label = `chapter ${chapter.id}`;
    if (chapter.startMs < previousEnd) problems.push(`${label} starts before the previous chapter ends`);
    if (chapter.endMs - chapter.startMs < MIN_HOLD_MS[chapter.kind]) problems.push(`${label} stays ${chapter.endMs - chapter.startMs}ms; a ${chapter.kind} needs ${MIN_HOLD_MS[chapter.kind]}ms`);
    if (chapter.assertions.length === 0) problems.push(`${label} asserts no state before its pause`);
    if (!chapter.caption.trim() || !chapter.title.trim()) problems.push(`${label} has no caption`);
    previousEnd = chapter.endMs;
  }
  if (manifest.durationMs < previousEnd) problems.push('the video ends before its last chapter');
  return problems;
}

const stamp = (ms: number) => {
  const total = Math.max(0, Math.round(ms)), hours = Math.floor(total / 3_600_000), minutes = Math.floor(total / 60_000) % 60, seconds = Math.floor(total / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
};
/** The captions, one cue per chapter, with the simulated-time and failure labels on their own lines. */
export function toWebVtt(chapters: readonly Chapter[]): string {
  const cues = chapters.map((chapter, index) => [String(index + 1).padStart(2, '0'), `${stamp(chapter.startMs)} --> ${stamp(chapter.endMs)}`, chapter.title, chapter.caption,
    ...(chapter.simulatedTime ? [`Simulated time: ${chapter.simulatedTime}`] : []), ...(chapter.failure ? [`Simulated failure: ${chapter.failure}`] : [])].join('\n'));
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
