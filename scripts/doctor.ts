/**
 * npm run doctor — prove every external dependency works with the keys in .env:
 * Muse Spark, Muse Voice Transcribe, SAM 3.1 and the WhatsApp Cloud API number.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'muse-doctor-'));
let failed = 0;
async function check(name: string, run: () => Promise<string>) {
  const t0 = performance.now();
  try {
    const detail = await run();
    console.log(`✔ ${name} (${((performance.now() - t0) / 1000).toFixed(1)}s) ${detail}`);
  } catch (err) {
    failed++;
    console.log(`✖ ${name}: ${(err as Error).message}`);
  }
}

const { models } = await import('../src/meta/models.ts');

await check('Muse Spark structured output', async () => {
  const out = await models.museJson<{ word: string }>({
    task: 'doctor', system: 'Answer with JSON.', user: 'Reply with the word ready.',
    schemaName: 'ping', schema: { type: 'object', additionalProperties: false, required: ['word'], properties: { word: { type: 'string' } } }, effort: 'minimal',
  });
  return JSON.stringify(out);
});

await check('Muse Voice Transcribe', async () => {
  const wav = path.join(dir, 'speech.wav');
  // espeak-ng makes a real spoken sentence when installed; otherwise a tone proves the endpoint accepts our upload.
  try { execFileSync('espeak-ng', ['-w', path.join(dir, 'raw.wav'), 'Hello, my shop sells cooking oil in Soweto market']); }
  catch { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', path.join(dir, 'raw.wav')]); }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'raw.wav'), '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', wav]);
  return JSON.stringify(await models.transcribe(wav));
});

await check('SAM 3.1 segmentation + cut-out', async () => {
  const svg = `<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="#efe7d8"/>
    <circle cx="160" cy="200" r="90" fill="#c0392b"/><circle cx="460" cy="200" r="70" fill="#c0392b"/></svg>`;
  const img = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  const cuts = await models.cutOut(img, 'red circle');
  if (!cuts.length) throw new Error('no masks returned');
  return `${cuts.length} cut-out(s), first ${cuts[0]!.box.right - cuts[0]!.box.left}×${cuts[0]!.box.bottom - cuts[0]!.box.top}px`;
});

await check('WhatsApp Cloud API number', async () => {
  const res = await fetch(`${config.wa.graph}/${config.wa.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
    headers: { Authorization: `Bearer ${config.wa.token}` },
  });
  const body = await res.json() as Record<string, string> & { error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? String(res.status));
  const digits = body.display_phone_number!.replace(/\D/g, '');
  const hint = config.wa.displayNumber === digits ? '' : ` — set WA_DISPLAY_NUMBER=${digits}`;
  return `${body.display_phone_number} "${body.verified_name}" quality ${body.quality_rating}${hint}`;
});

if (!config.wa.appSecret) console.log('! WA_APP_SECRET is empty: every webhook POST will be rejected (set ALLOW_UNSIGNED_WEBHOOKS=1 only for local testing).');
if (!config.wa.verifyToken) console.log('! WA_VERIFY_TOKEN is empty: Meta cannot verify the webhook.');
process.exit(failed ? 1 : 0);
