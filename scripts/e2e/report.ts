import { writeFile, copyFile, access, mkdir, rename } from 'node:fs/promises';
import { join, relative, basename, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export type Chapter = { id: string; title: string; description: string; start: number; end: number; status: 'running' | 'passed' | 'failed'; checks: Array<{ at: number; message: string }> };
type Report = { status: string; createdAt: string; source: string; dirty: boolean; scope: string; chapters: Chapter[]; pacing: { scale: number; chapter: number; review: number; action: number; receipt: number; end: number } };
export const timecode = (seconds: number) => {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export async function publishRecording(output: string, report: Report) {
  if (report.status !== 'passed' || report.chapters.length !== 12 || report.chapters.some(chapter => chapter.status !== 'passed' || !chapter.checks.length)) throw new Error('Only complete asserted recordings can be published');
  const video = join(output, 'cityside-e2e.webm');
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name,r_frame_rate', '-of', 'json', video]);
  const metadata = JSON.parse(probe.stdout);
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Recorded video is empty');
  if (report.pacing.scale > 0 && duration < report.chapters.at(-1)!.end - 3) throw new Error('Recorded video is shorter than the asserted journey timeline');
  console.log('Encoding a shareable MP4 and generating measured chapters…');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'cityside-e2e.mp4')]);
  const vtt = 'WEBVTT\n\n' + report.chapters.map(chapter => `${chapter.id}\n${timecode(chapter.start)} --> ${timecode(Math.min(chapter.end, duration))}\n${chapter.title}\n${chapter.description}\n`).join('\n');
  await writeFile(join(output, 'chapters.vtt'), vtt);
  const assertions = report.chapters.reduce((sum, chapter) => sum + chapter.checks.length, 0);
  await writeFile(join(output, 'report.md'), `# Cityside browser recording\n\nRecorded: ${report.createdAt}. Source: \`${report.source}\`${report.dirty ? ' plus working-tree recording changes' : ''}.\n\n${report.scope}\n\n**Result:** ${report.chapters.length} chapters and ${assertions} checks passed. Video: ${duration.toFixed(1)} seconds, ${metadata.streams[0].width} × ${metadata.streams[0].height}.\n\nPacing: chapter ${report.pacing.chapter / 1000}s, review ${report.pacing.review / 1000}s, pre-action ${report.pacing.action / 1000}s, receipt ${report.pacing.receipt / 1000}s. These pauses follow state/response assertions; they do not replace readiness checks.\n\n[MP4](cityside-e2e.mp4) · [WebM](cityside-e2e.webm) · [Timed captions](chapters.vtt) · [Machine-readable checks](results.json)\n\n${report.chapters.map(chapter => `## ${timecode(chapter.start).slice(3, 8)} — ${chapter.title}\n\n${chapter.description}\n\n${chapter.checks.map(check => `- PASS: ${check.message}`).join('\n')}\n`).join('\n')}\n`);
  await writeFile(join(output, 'media.json'), JSON.stringify({ duration, ...metadata }, null, 2) + '\n');
  const destination = resolve('docs/recordings/runs', basename(output));
  await mkdir(dirname(destination), { recursive: true });
  await rename(output, destination); output = destination;
  const root = 'docs/recordings';
  try { await access(join(root, 'legacy.html')); } catch { await copyFile(join(root, 'index.html'), join(root, 'legacy.html')); }
  const base = relative(root, output).split('\\').join('/');
  const html = `<!doctype html>
<html lang="en" data-cityside-recording><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Cityside — verified E2E journeys</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f2f6f8;color:#193d50;font:16px/1.6 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:32px 24px}h1{font-size:32px;line-height:1.2}p{max-width:100ch}a{color:#24657e}video{display:block;width:100%;background:#111;border-radius:14px}.layout{display:grid;grid-template-columns:1fr 350px;gap:24px;margin-top:24px}.chapters{display:flex;flex-direction:column;gap:8px}button{font:inherit;text-align:left;background:white;color:inherit;border:1px solid #ccdce4;border-radius:9px;padding:12px;cursor:pointer}button:hover,button[aria-current=true]{border-color:#24657e;background:#e6f0f4}button:focus-visible{outline:3px solid #337d9e}.time{font-size:12px;font-weight:bold;color:#4a7287}small,.muted{color:#537184}section{background:white;border:1px solid #d7e3e9;padding:20px;border-radius:12px}.links{display:flex;flex-wrap:wrap;gap:20px;margin:18px 0}.status{font-size:12px;letter-spacing:.05em;text-transform:uppercase}@media(max-width:950px){.layout{grid-template-columns:1fr}main{padding:20px 14px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}</style></head>
<body><main><p class="status">${report.chapters.length} journeys · ${assertions} asserted checks passed · ${escape(report.createdAt.slice(0,10))}</p><h1>Cityside: everyday services, at a readable pace</h1><p>Sign in, review and cancel an approval, top up a wallet, pay bills, book a ride, order dinner and restore an account-owned conversation. Each chapter waits for its real result before allowing time to read it.</p><p class="muted">${escape(report.scope)} This video has no audio; timed captions and chapter descriptions provide context. UI captions are recording annotations, not model reasoning.</p>
<video id="recording" controls preload="metadata" poster="${base}/01-signed-in.png"><source src="${base}/cityside-e2e.mp4" type="video/mp4"><source src="${base}/cityside-e2e.webm" type="video/webm"><track kind="captions" srclang="en" label="English chapters" src="${base}/chapters.vtt">Your browser cannot play this recording.</video>
<div class="links"><a href="${base}/cityside-e2e.mp4" download>Download MP4</a><a href="${base}/cityside-e2e.webm" download>Download WebM</a><a href="${base}/report.md">Assertion report</a><a href="${base}/results.json">Raw results</a><a href="legacy.html">Historical recording</a></div>
<div class="layout"><section><h2 id="chapter-title">Select a chapter</h2><p id="chapter-description">${duration.toFixed(0)} seconds · ${metadata.streams[0].width} × ${metadata.streams[0].height} · 6-second review and 8-second receipt pauses at default speed.</p><ul id="checks"></ul><p class="muted">Source <code>${escape(report.source.slice(0,12))}</code>${report.dirty ? ' plus working-tree recording changes' : ''}. Review the report for the verified boundary.</p></section><nav class="chapters" aria-label="Recording chapters">${report.chapters.map((chapter,index) => `<button type="button" data-chapter="${index}"><span class="time">${timecode(chapter.start).slice(3,8)} · ${chapter.id}</span><br>${escape(chapter.title)}</button>`).join('')}</nav></div></main>
<script>const chapters=${JSON.stringify(report.chapters).replaceAll('<','\\u003c')};const video=document.getElementById('recording');const buttons=[...document.querySelectorAll('[data-chapter]')];function show(index){const chapter=chapters[index];document.getElementById('chapter-title').textContent=chapter.title;document.getElementById('chapter-description').textContent=chapter.description;document.getElementById('checks').replaceChildren(...chapter.checks.map(check=>{const li=document.createElement('li');li.textContent='PASS: '+check.message;return li}));buttons.forEach((button,i)=>button.setAttribute('aria-current',String(i===index)))}buttons.forEach((button,index)=>button.addEventListener('click',()=>{video.currentTime=chapters[index].start;show(index);video.play().catch(()=>{})}));video.addEventListener('timeupdate',()=>{const index=chapters.findLastIndex(chapter=>chapter.start<=video.currentTime);if(index>=0)show(index)});show(0);</script></body></html>`;
  await writeFile(join(root, 'index.html'), html);
  await writeFile(join(root, 'latest.json'), JSON.stringify({ directory: base, duration, assertions, chapters: report.chapters.length, createdAt: report.createdAt }, null, 2) + '\n');
  return output;
}
