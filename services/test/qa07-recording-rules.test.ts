import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_HOLD_MS, manifestProblems, toWebVtt, type Chapter, type Manifest } from '../../test/browser/recording-rules.ts';

const chapter = (over: Partial<Chapter> = {}): Chapter => ({ id: 'a', kind: 'review', title: 'Review', caption: 'The exact total is shown before anything moves.', startMs: 0, endMs: 6500, assertions: ['no journal entry yet'], ...over });
const manifest = (chapters: Chapter[], over: Partial<Manifest> = {}): Manifest => ({ scenario: 'fines', title: 'Fines', revision: 'a1b2c3d', createdAt: '2026-10-26T00:00:00.000Z',
  provenance: { stack: 'in-process', browser: 'chrome', viewport: { width: 1280, height: 800 }, synthetic: true }, video: 'fines.webm', durationMs: 20_000, chapters, ...over });

test('QA-07: a review needs six seconds on screen and a receipt eight', () => {
  assert.equal(MIN_HOLD_MS.review, 6000);
  assert.equal(MIN_HOLD_MS.receipt, 8000);
  assert.deepEqual(manifestProblems(manifest([chapter(), chapter({ id: 'b', kind: 'receipt', title: 'Receipt', startMs: 6500, endMs: 15000 })])), []);
  assert.match(manifestProblems(manifest([chapter({ endMs: 5900 })]))[0], /review needs 6000ms/);
  assert.match(manifestProblems(manifest([chapter({ kind: 'receipt', endMs: 7900 })]))[0], /receipt needs 8000ms/);
});

test('QA-07: a chapter must assert state before it pauses, carry a caption and not overlap', () => {
  assert.match(manifestProblems(manifest([chapter({ assertions: [] })])).join(), /asserts no state/);
  assert.match(manifestProblems(manifest([chapter({ caption: ' ' })])).join(), /no caption/);
  assert.match(manifestProblems(manifest([chapter(), chapter({ id: 'b', startMs: 6000, endMs: 13000 })])).join(), /starts before the previous chapter ends/);
  assert.match(manifestProblems(manifest([chapter()], { durationMs: 1000 })).join(), /video ends before/);
  assert.match(manifestProblems(manifest([chapter()], { revision: 'main' })).join(), /not a git revision/);
  assert.match(manifestProblems(manifest([])).join(), /no chapters/);
});

test('QA-07: captions are WebVTT with simulated time and failures labelled on their own lines', () => {
  const vtt = toWebVtt([chapter({ simulatedTime: '+60 min (operator advanced the run clock)', failure: 'the response was lost after the capture', startMs: 3_725_500, endMs: 3_731_500 })]);
  assert.ok(vtt.startsWith('WEBVTT\n\n01\n01:02:05.500 --> 01:02:11.500\nReview\n'));
  assert.match(vtt, /\nSimulated time: \+60 min/);
  assert.match(vtt, /\nSimulated failure: the response was lost/);
});
