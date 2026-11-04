// node scripts/record-demo.mjs — run `npm run demo`, record the control room at
// 1600x900 with Playwright, and burn the demo's step captions into an MP4.
// Needs playwright-core (e2e/node_modules) and a Playwright Chromium.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../e2e/node_modules/playwright-core');
const out = path.resolve('videos'); mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || undefined; // default: playwright-core's own Chromium

const demo = spawn('node', ['scripts/demo.ts'], { env: { ...process.env, DEMO_PORT: '8790' }, stdio: ['ignore', 'pipe', 'inherit'] });
let t0 = 0; const steps = []; let ready, ended, fail;
const died = new Promise((_, r) => (fail = r));
const isReady = Promise.race([new Promise((r) => (ready = r)), died]), isEnded = Promise.race([new Promise((r) => (ended = r)), died]);
demo.on('exit', (code) => fail(new Error(`demo exited (${code}) before END`)));
readline.createInterface({ input: demo.stdout }).on('line', (line) => {
  if (line.startsWith('T0 ')) t0 = Number(line.slice(3));
  if (line.startsWith('Mesa Muse on')) ready();
  const m = line.match(/^STEP ([\d.]+) (.*)$/);
  if (m) { steps.push({ at: Number(m[1]), text: m[2] }); if (m[2] === 'END') ended(); console.log(line); }
});

await isReady;
const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: out, size: { width: 1600, height: 900 } } });
const videoStart = Date.now();
const page = await context.newPage();
await page.goto('http://127.0.0.1:8790');
await isEnded;
await page.waitForTimeout(8000);
const video = page.video();
demo.removeAllListeners('exit');
await context.close(); await browser.close(); demo.kill();

// Captions: intro until the first step, then each step until the next.
const shift = (t0 - videoStart) / 1000;
const ts = (s) => { const ms = Math.max(0, Math.round(s * 1000)); const h = String(Math.floor(ms / 3600000)).padStart(2, '0'); const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'); const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`; };
const cues = [{ from: 0, to: shift + steps[0].at, text: 'Mesa Muse — a shop on WhatsApp from one voice note and one photo.\nMuse Spark · Muse Voice Transcribe · SAM 3.1 · WhatsApp Cloud API' }];
steps.forEach((s, i) => { if (s.text !== 'END') cues.push({ from: shift + s.at, to: shift + (steps[i + 1]?.at ?? s.at + 8), text: s.text }); });
cues.push({ from: shift + steps.at(-1).at, to: shift + steps.at(-1).at + 8, text: 'Every step: real Mesa Muse code. Model replies in this recording are scripted\nwhile our Meta Model API account billing is resolved.  github.com/heromiyo/mesa-muse' });
const srt = path.join(out, 'demo.srt');
writeFileSync(srt, cues.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n'));

renameSync(await video.path(), path.join(out, 'demo-raw.webm'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(out, 'demo-raw.webm'),
  // Captions sit in a green bar under the picture, never over the chats.
  '-vf', `pad=1600:1010:0:0:color=0x1f3a2e,subtitles=${srt}:original_size=1600x1010:force_style='FontName=Noto Sans,FontSize=8,Bold=1,PrimaryColour=&H00FFFFFF,BorderStyle=1,Outline=0,Shadow=0,MarginV=6,Alignment=2'`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', path.join(out, 'mesa-muse-demo.mp4')]);
console.log(`Wrote ${path.join(out, 'mesa-muse-demo.mp4')}`);
