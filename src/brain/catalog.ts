import { museJson, imagePart } from '../meta/muse.ts';
import { cutOut, type Cutout } from '../meta/sam.ts';
import type { Shop } from '../db.ts';
import path from 'node:path';
import { pngDataUrl, saveMedia } from './media.ts';

/** `image` is the cut-out's file name under data/media. */
export type DraftItem = { name: string; description: string; price_ngwee: number; image: string };

const MAX_ITEMS = 9;

/**
 * Shelf photo → priced catalog, three Meta model calls deep:
 *   1. Muse Spark looks at the photo and names the distinct products as short noun phrases.
 *   2. SAM 3.1 cuts every instance of each phrase out along its pixel mask.
 *   3. Muse Spark sees the numbered cut-outs and writes a name, a one-line pitch and a market price in kwacha.
 */
export async function photoToProducts(photo: { bytes: Buffer; dataUrl: string }, shop: Shop, phone: string): Promise<DraftItem[]> {
  const plan = await museJson<{ products: { phrase: string; count: number }[] }>({
    task: 'photo → product list', phone,
    system: 'You help a market trader in Zambia put their stock online. List the distinct kinds of product for sale in the photo. ' +
      'For each, give a short visual noun phrase a segmentation model can find (e.g. "red cooking oil bottle", "packet of sugar", "denim jacket"), and how many you see. ' +
      'Skip shelves, people, hands, price tags and background. At most 6 kinds.',
    user: [{ type: 'text', text: `Shop: ${shop.name || 'a small shop'}. ${shop.about}` }, imagePart(photo.dataUrl)],
    schemaName: 'stock_plan',
    schema: {
      type: 'object', additionalProperties: false, required: ['products'],
      properties: { products: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['phrase', 'count'], properties: { phrase: { type: 'string' }, count: { type: 'integer' } } } } },
    },
  });

  const phrases = plan.products.slice(0, 6).map((p) => p.phrase);
  const found = await Promise.all(phrases.map((p) => cutOut(photo.bytes, p, phone).catch(() => [] as Cutout[])));
  // One representative per product kind (the largest, clearest cut-out), then fill with extra kinds' runners-up.
  const area = (c: Cutout) => (c.box.right - c.box.left) * (c.box.bottom - c.box.top);
  const best = found.map((list) => [...list].sort((a, b) => area(b) - area(a))[0]).filter((c): c is Cutout => !!c);
  const picks = best.slice(0, MAX_ITEMS);
  if (!picks.length) return [];

  const priced = await museJson<{ items: { number: number; name: string; description: string; price_kwacha: number }[] }>({
    task: 'cut-outs → names + prices', phone,
    system: 'You write a WhatsApp shop catalog for a trader in Zambia. For each numbered product photo, give a short customer-facing name (brand and size if visible), ' +
      'a one-line description a customer would care about, and a fair current retail price in Zambian kwacha for a small shop or market stall. ' +
      'If the owner mentioned prices, use them. Write in the language the owner uses.',
    user: [
      { type: 'text', text: `Owner's description of the shop: ${shop.about || '(none)'}\nLanguage: ${shop.language}\nThere are ${picks.length} numbered products, in order.` },
      ...picks.flatMap((c, i) => [{ type: 'text' as const, text: `Product ${i + 1} (seen as "${c.concept}")` }, imagePart(pngDataUrl(c.png))]),
    ],
    schemaName: 'catalog',
    schema: {
      type: 'object', additionalProperties: false, required: ['items'],
      properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['number', 'name', 'description', 'price_kwacha'],
        properties: { number: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, price_kwacha: { type: 'number' } } } } },
    },
  });

  const items: DraftItem[] = [];
  for (const [i, c] of picks.entries()) {
    const p = priced.items.find((x) => x.number === i + 1);
    if (!p) continue;
    const file = await saveMedia(`cut-${shop.id}-${Date.now()}-${i}.png`, c.png);
    items.push({ name: p.name, description: p.description, price_ngwee: Math.round(p.price_kwacha * 100), image: path.basename(file) });
  }
  return items;
}

export type EditOp = { op: 'set_price' | 'rename' | 'remove' | 'describe'; number: number; value: string };

/** Owner says "number 2 is K30, take out the soap" (typed or spoken) → edit operations on the draft. */
export async function editsFromWords(words: string, items: { name: string; price_ngwee: number }[], shop: Shop, phone: string) {
  return museJson<{ ops: EditOp[]; reply: string }>({
    task: 'owner words → catalog edits', phone,
    system: 'A shop owner is correcting their WhatsApp catalog by message or voice note. Turn what they said into edit operations on the numbered list. ' +
      'set_price value is kwacha as a number string, e.g. "30". rename/describe value is the new text. remove value is "". ' +
      'If they ask something that is not an edit, return no ops and answer briefly in reply. reply is one short friendly sentence in their language confirming what changed.',
    user: `Language: ${shop.language}\nCatalog:\n${items.map((it, i) => `${i + 1}. ${it.name} — K${it.price_ngwee / 100}`).join('\n')}\n\nOwner said: ${words}`,
    schemaName: 'edits',
    schema: {
      type: 'object', additionalProperties: false, required: ['ops', 'reply'],
      properties: {
        reply: { type: 'string' },
        ops: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'number', 'value'],
          properties: { op: { type: 'string', enum: ['set_price', 'rename', 'remove', 'describe'] }, number: { type: 'integer' }, value: { type: 'string' } } } },
      },
    },
  });
}

/** Apply edits by position; removals last so numbers the owner saw stay valid. */
export function applyEdits<T extends { name: string; description: string; price_ngwee: number }>(items: T[], ops: EditOp[]): T[] {
  const next = items.map((it) => ({ ...it }));
  const drop = new Set<number>();
  for (const op of ops) {
    const it = next[op.number - 1];
    if (!it) continue;
    if (op.op === 'set_price') { const k = Number(op.value.replace(/[^\d.]/g, '')); if (k > 0) it.price_ngwee = Math.round(k * 100); }
    else if (op.op === 'rename' && op.value.trim()) it.name = op.value.trim();
    else if (op.op === 'describe' && op.value.trim()) it.description = op.value.trim();
    else if (op.op === 'remove') drop.add(op.number - 1);
  }
  return next.filter((_, i) => !drop.has(i));
}
