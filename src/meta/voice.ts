import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { timed } from '../bus.ts';

const run = promisify(execFile);

/** WhatsApp voice notes are OGG/Opus; Muse Voice Transcribe wants mono 16-bit WAV at 16 or 24 kHz. */
export async function toWav(input: string): Promise<string> {
  const out = input.replace(/\.[^.]+$/, '') + '.wav';
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', out]);
  return out;
}

/** Transcribe a recording with Muse Voice Transcribe (one-shot HTTP endpoint). */
export async function transcribe(wavPath: string, opts: { phone?: string; keywords?: string[] } = {}): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const audio = await readFile(wavPath);
  return timed({ phone: opts.phone, model: config.meta.voice, task: 'voice note → text' }, async () => {
    const request: Record<string, unknown> = { mode: 'PUSH_TO_TALK', model: config.meta.voice, audioEncoding: 'WAV' };
    if (opts.keywords?.length) request.keywords = opts.keywords;
    // Same multipart shape as Meta's reference client: a JSON `request` part (no filename) and the audio file.
    const boundary = `muse${Date.now().toString(16)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(request)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${config.meta.baseUrl}/asr/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.meta.apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = (await res.json()) as { transcript?: string; turns?: { transcript?: string }[] };
    return (out.transcript || out.turns?.map((t) => t.transcript).join(' ') || '').trim();
  }, (text) => ({ transcript: text.slice(0, 400) }));
}
