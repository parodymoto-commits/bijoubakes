// Renders the cartoon to a vertical 1080x1920 MP4 with the recorded voices.
// Usage: node tools/render-video.mjs [it|fr] [--seconds N] [--out file.mp4] [--page video.html]
// Build video.html first with: python3 tools/build-video-page.py
// Needs: playwright (Chromium) and ffmpeg/ffprobe on PATH.
// The page runs in its #video mode on a virtual clock, so every frame is captured
// at an exact time; CSS animations are stepped by hand to stay in sync.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const lang = args.find(a => a === 'it' || a === 'fr') || 'it';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const maxSeconds = Number(opt('--seconds', 3600));
const out = path.resolve(opt('--out', path.join(root, `video/daara-${lang}.mp4`)));
const FPS = 30, DT = 1000 / FPS;
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmp = fs.mkdtempSync(path.join(path.dirname(out), '.render-'));

// Length of every recorded line, in ms.
const audioDir = path.join(root, 'audio', lang);
const durations = {};
for (const f of fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'))) {
  const s = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(audioDir, f)]).toString();
  durations[`audio/${lang}/${f}`] = Math.round(parseFloat(s) * 1000);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.addInitScript(d => { window.__durations = d; }, durations);
await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
const pageFile = opt('--page', 'video.html');
await page.goto(pathToFileURL(path.join(root, pageFile)).href + `?lang=${lang}#video`);
await page.evaluate(() => document.fonts.ready);
// Stop natural time flow: from here the page clock only moves with runFor().
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
await page.clock.runFor(300);

const silent = path.join(tmp, 'video.mp4');
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent], { stdio: ['pipe', 'inherit', 'inherit'] });

await page.evaluate(() => window.__startVideo());
const stepAnimations = dt => {
  for (const a of document.getAnimations()) {
    if (!a.__v) { a.__v = true; a.pause(); a.currentTime = 0; continue; }
    const end = a.effect && a.effect.getComputedTiming().endTime;
    const t = (a.currentTime || 0) + dt;
    if (Number.isFinite(end) && t >= end) a.finish(); else a.currentTime = t;
  }
};
let frame = 0;
for (;;) {
  await page.evaluate(stepAnimations, frame === 0 ? 0 : DT);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
  frame++;
  if (frame % (FPS * 10) === 0) console.log(`${frame / FPS}s`);
  if (frame / FPS >= maxSeconds || await page.evaluate(() => !!window.__done)) break;
  await page.clock.runFor(DT);
}
const timeline = await page.evaluate(() => window.__timeline);
await browser.close();
ff.stdin.end();
await new Promise(r => ff.on('close', r));
const total = frame / FPS;

// Place each voice line at the moment its bubble appeared.
const inputs = [], filters = [];
let n = 0;
for (const ev of timeline) for (const f of ev.files) {
  if (ev.t / 1000 >= total) continue;
  inputs.push('-i', path.join(root, f));
  filters.push(`[${n + 1}:a]aresample=44100,adelay=${ev.t}|${ev.t}[a${n}]`);
  n++;
}
if (n === 0) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'); filters.push('[1:a]anull[a0]'); n = 1; }
const mix = `${filters.join(';')};${Array.from({ length: n }, (_, i) => `[a${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest,apad[aout]`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', out]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${out} (${total.toFixed(1)}s, ${frame} frames, ${n} voice clips)`);
