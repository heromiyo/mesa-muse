import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config, mediaDir } from '../config.ts';
import { downloadMedia } from '../whatsapp/cloud.ts';
import { toWav, transcribe } from '../meta/voice.ts';
import type { Inbound } from '../whatsapp/inbound.ts';

export const publicMedia = (file: string) => `${config.publicUrl}/media/${path.basename(file)}`;

export async function saveMedia(name: string, bytes: Buffer): Promise<string> {
  const file = path.join(mediaDir, name);
  await writeFile(file, bytes);
  return file;
}

/** Voice note → text with Muse Voice Transcribe. */
export async function heard(m: Inbound, keywords: string[] = []): Promise<string> {
  const { file } = await downloadMedia(m.mediaId!, 'ogg');
  return transcribe(await toWav(file), { phone: m.from, keywords });
}

/** Photo → bytes plus a data URL Muse Spark can look at (downscaled to keep calls quick). */
export async function photo(m: Inbound): Promise<{ bytes: Buffer; dataUrl: string; url: string }> {
  const { file, bytes } = await downloadMedia(m.mediaId!, 'jpg');
  const small = await sharp(bytes).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { bytes, dataUrl: `data:image/jpeg;base64,${small.toString('base64')}`, url: publicMedia(file) };
}

export const pngDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** A numbered contact sheet of cut-out products, so the owner can say "number 3 is K25". */
export async function contactSheet(pngs: Buffer[]): Promise<Buffer> {
  const cell = 360, cols = Math.min(3, pngs.length), rows = Math.ceil(pngs.length / cols);
  const tiles = await Promise.all(pngs.map(async (png, i) => {
    const fitted = await sharp(png).resize(cell - 60, cell - 90, { fit: 'inside' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${cell}" height="${cell}"><circle cx="38" cy="38" r="24" fill="#1f3a2e"/><text x="38" y="47" font-family="Arial" font-weight="700" font-size="26" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
    return [
      { input: fitted, left: (i % cols) * cell + 30, top: Math.floor(i / cols) * cell + 60 },
      { input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell },
    ];
  }));
  return sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#f6f1e7' } })
    .composite(tiles.flat()).jpeg({ quality: 88 }).toBuffer();
}
