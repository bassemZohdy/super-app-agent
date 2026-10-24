export function pacing(video: boolean) {
  const scale = Number(process.env.E2E_PACE ?? (video ? '1' : '0'));
  if (!Number.isFinite(scale) || scale < 0 || scale > 3) throw new Error('E2E_PACE must be between 0 and 3');
  return { scale, chapter: 3500 * scale, review: 6000 * scale, action: 1500 * scale, receipt: 8000 * scale, end: 7000 * scale };
}
