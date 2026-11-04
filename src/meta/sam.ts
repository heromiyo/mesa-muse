import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from '@meta-sam/parser';
import sharp from 'sharp';
import { config } from '../config.ts';
import { timed } from '../bus.ts';
import { meta } from './client.ts';

export type Cutout = { concept: string; png: Buffer; box: { left: number; top: number; right: number; bottom: number }; confidence?: number };

// The API streams `response.content_part.done` but not always `response.output_text.done`,
// which the parser needs to close a text lane. Same normalisation as Meta's reference client.
async function* normalized(stream: AsyncIterable<unknown>): AsyncIterable<ResponsesEvent> {
  const done = new Set<string>();
  for await (const raw of stream) {
    const e = raw as { type?: string; item_id?: unknown; output_index?: unknown; content_index?: unknown; part?: { type?: unknown; text?: unknown } | null };
    const lane = `${String(e.item_id)}:${String(e.output_index)}:${String(e.content_index)}`;
    if (e.type === 'response.output_text.done') {
      if (!done.has(lane)) { done.add(lane); yield e as unknown as ResponsesEvent; }
      continue;
    }
    yield e as unknown as ResponsesEvent;
    if (e.type === 'response.content_part.done' && !done.has(lane) && e.part?.type === 'output_text' && typeof e.part.text === 'string') {
      done.add(lane);
      yield { type: 'response.output_text.done', item_id: e.item_id, output_index: e.output_index, content_index: e.content_index, text: e.part.text } as unknown as ResponsesEvent;
    }
  }
}

/**
 * SAM 3.1: find every instance of `concept` in the photo and return each one as a
 * transparent PNG cut along its pixel mask, ready to show a customer on WhatsApp.
 */
export async function cutOut(image: Buffer, concept: string, phone?: string): Promise<Cutout[]> {
  // Boxes come back in the pixel space of the image we send, so send exactly what we crop from.
  const jpeg = await sharp(image).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const { width: W = 0, height: H = 0 } = await sharp(jpeg).metadata();
  const result = await timed({ phone, model: config.meta.sam, task: `segment “${concept}”` }, async () => {
    const stream = await meta().responses.create({
      model: config.meta.sam,
      stream: true,
      input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: concept },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
      ] }],
    } as never);
    return parseImageStream(normalized(stream as unknown as AsyncIterable<unknown>)).finalResult;
  }, (r) => ({ outcome: r.outcome.status, masks: recordsOfKind(r.records, 'mask').length }));

  if (result.outcome.status !== 'completed') return [];
  const cutouts: Cutout[] = [];
  for (const rec of recordsOfKind(result.records, 'mask')) {
    const { left, top } = rec.bounds;
    const right = Math.min(rec.bounds.right, W), bottom = Math.min(rec.bounds.bottom, H);
    const { width, height } = rec.mask;
    if (right - left < 24 || bottom - top < 24 || width < 8 || height < 8) continue; // specks are not products
    const bits = decodeMaskToRaster(rec.mask);
    const alpha = Buffer.alloc(width * height);
    for (let i = 0; i < bits.length; i++) alpha[i] = bits[i] ? 255 : 0;
    const rgb = await sharp(jpeg).extract({ left, top, width: right - left, height: bottom - top }).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png().toBuffer();
    cutouts.push({ concept, png, box: { left, top, right, bottom }, confidence: rec.confidence });
  }
  return cutouts;
}

/** WhatsApp shows transparent PNGs on a dark or light bubble; put the cutout on a clean card. */
export async function productCard(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const side = Math.max(meta.width ?? 400, meta.height ?? 400) + 80;
  return sharp({ create: { width: side, height: side, channels: 3, background: '#f6f1e7' } })
    .composite([{ input: png, gravity: 'center' }])
    .resize(800, 800, { fit: 'inside' })
    .jpeg({ quality: 88 })
    .toBuffer();
}
