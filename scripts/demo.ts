/**
 * npm run demo — the real Mesa Muse code (webhook, router, owner and customer
 * brains, WhatsApp client, control room) driven through one owner and one
 * customer journey, with SCRIPTED stand-ins for the Meta Model API and the
 * WhatsApp Graph API. Used to record the demo video while live model access is
 * pending; the control room shows a banner saying so.
 *
 * Open http://localhost:8790 and watch. Nothing leaves this machine.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(path.join(tmpdir(), 'muse-demo-'));
const FAKE = 8791, APP = Number(process.env.DEMO_PORT ?? 8790);
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'demo.db'), DATA_DIR: dir, PORT: String(APP), PUBLIC_URL: `http://localhost:${APP}`,
  MODEL_API_KEY: 'LLM|demo|demo', MODEL_API_BASE: `http://localhost:${FAKE}/v1`,
  WA_TOKEN: 'EAAdemo', WA_PHONE_NUMBER_ID: '100', WA_VERIFY_TOKEN: 'demo', WA_APP_SECRET: 'demo-secret',
  WA_DISPLAY_NUMBER: '260970000000', WA_GRAPH: `http://localhost:${FAKE}/graph`, ALLOW_OPEN_CONTROL_ROOM: '1',
  DEMO_NOTICE: 'Simulation: real Mesa Muse code with scripted Meta model and WhatsApp responses — live Meta Model API access is pending account billing.',
});

const OWNER = '260971234567', BUYER = '260962345678';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- product art (drawn, clearly not photos) ----------
const PRODUCTS = [
  { phrase: 'orange drink bottle', name: 'Orange squash 2L', note: 'Family size, mixes 10 litres', k: 45, color: '#e67e22', cap: '#c0392b', shape: 'bottle' },
  { phrase: 'cooking oil bottle', name: 'Cooking oil 2.5L', note: 'Sunflower oil', k: 95, color: '#f4d03f', cap: '#27ae60', shape: 'bottle' },
  { phrase: 'washing paste tub', name: 'Washing paste 400g', note: 'For hand washing', k: 25, color: '#2e86c1', cap: '#1b4f72', shape: 'tub' },
  { phrase: 'sugar packet', name: 'White sugar 2kg', note: 'Local brand', k: 55, color: '#fdfefe', cap: '#5d6d7e', shape: 'bag' },
];
function art(p: (typeof PRODUCTS)[number], w = 220, h = 300) {
  const body = p.shape === 'bottle'
    ? `<rect x="70" y="16" width="80" height="34" rx="8" fill="${p.cap}"/><path d="M60 60 Q110 30 160 60 L170 270 Q110 290 50 270 Z" fill="${p.color}"/>`
    : p.shape === 'tub'
      ? `<rect x="30" y="70" width="160" height="26" rx="8" fill="${p.cap}"/><path d="M38 96 L182 96 L170 270 L50 270 Z" fill="${p.color}"/>`
      : `<path d="M50 40 L170 40 L180 280 L40 280 Z" fill="${p.color}" stroke="#aab7b8" stroke-width="4"/><rect x="40" y="40" width="140" height="22" fill="${p.cap}"/>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 220 300" xmlns="http://www.w3.org/2000/svg">${body}
    <rect x="62" y="140" width="96" height="60" rx="6" fill="#fff" opacity=".92"/>
    <text x="110" y="178" font-family="Arial" font-weight="700" font-size="22" fill="#1f3a2e" text-anchor="middle">K${p.k}</text></svg>`;
}
const cutPng = (p: (typeof PRODUCTS)[number]) => sharp(Buffer.from(art(p))).png().toBuffer();

// ---------- WhatsApp Graph + Meta Model API stand-ins ----------
const media = new Map<string, Buffer>();
let mediaSeq = 0, removeNext = false;
const turns: any[] = [];
async function read(req: IncomingMessage) { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c); }

const answers: Record<string, (b: any) => unknown> = {
  shop_profile: () => ({ name: 'Bana Bupe Groceries', about: 'drinks, cooking oil, sugar and soap', location: 'Soweto market, stall 14, Lusaka', hours: 'Mon–Sat 06:00–19:00', payments: 'Cash, MTN MoMo, Airtel Money', delivery: 'Delivery in Matero and Chaisa, K20', language: 'Bemba', reply: 'Ee mukwai, Bana Bupe! Nalumfwa bwino. Ici e cintu nalumfwile:' }),
  stock_plan: () => ({ products: PRODUCTS.map((p) => ({ phrase: p.phrase, count: 2 })) }),
  catalog: (b) => {
    const n = b.messages[1].content.filter((c: any) => c.type === 'image_url').length;
    return { items: PRODUCTS.slice(0, n).map((p, i) => ({ number: i + 1, name: p.name, description: p.note, price_kwacha: p.k })) };
  },
  edits: () => removeNext
    ? { ops: [], reply: 'Nshili nalumfwa — no change.' }
    : { ops: [{ op: 'set_price', number: 2, value: '90' }], reply: 'Cawama! Cooking oil 2.5L is now K90.' },
  note: () => ({ message: 'Natotela, Chanda! Bana Bupe accepted your order #1 — K90 for 2 × Orange squash. Pay cash or MTN MoMo on pickup at stall 14 today at 17:00.' }),
};
const latency: Record<string, number> = { shop_profile: 2300, stock_plan: 2800, catalog: 3400, edits: 1600, note: 1200, turn: 1900 };

createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x'), raw = await read(req);
  const json = (b: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname.startsWith('/graph/')) {
    const p = url.pathname.slice(7);
    if (p === '100/messages') return json({ messages: [{ id: `wamid.${Date.now()}` }] });
    if (p === '100/media') return json({ id: `${900000 + ++mediaSeq}` });
    if (media.has(p)) return json({ url: `http://localhost:${FAKE}/dl/${p}` });
    res.writeHead(404); return res.end();
  }
  if (url.pathname.startsWith('/dl/')) return res.end(media.get(url.pathname.slice(4)));
  if (url.pathname === '/v1/chat/completions') {
    const b = JSON.parse(raw.toString());
    const kind = b.tools ? 'turn' : b.response_format.json_schema.name;
    await sleep(latency[kind] ?? 1500);
    if (kind === 'turn') {
      const next = turns.shift() ?? { content: 'Twalumba! Anything else?' };
      return json({ id: 'c', object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, finish_reason: next.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: next.content ?? null, tool_calls: next.tool_calls } }] });
    }
    return json({ id: 'c', object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answers[kind]!(b)) } }] });
  }
  if (url.pathname === '/v1/asr/transcribe') {
    await sleep(1700);
    const owner = raw.includes(Buffer.from('Bana Bupe'));
    return json({ sessionId: 'demo', transcript: owner
      ? 'Shina lyandi ni Bana Bupe. Ndashitisha Mazoe, oil, shuga na Boom pa Soweto market, stall 14. Ndaisula ukufuma 6 ulucelo ukufika 7 icungulo. Abantu balabbila cash nangu MTN.'
      : 'Mwapoleni, nalefwaya ama Mazoe yabili, nkesa ku 5 icungulo.' });
  }
  res.writeHead(404); res.end();
}).listen(FAKE);

// ---------- demo media ----------
const ogg = path.join(dir, 'voice.ogg');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:a', 'libopus', ogg]);
media.set('5001', readFileSync(ogg));
media.set('5003', readFileSync(ogg));
const shelf = await sharp({ create: { width: 1200, height: 700, channels: 3, background: '#8d6e4f' } })
  .composite(await Promise.all(PRODUCTS.map(async (p, i) => ({ input: await sharp(Buffer.from(art(p, 230, 314))).png().toBuffer(), left: 40 + i * 290, top: 300 }))))
  .jpeg().toBuffer();
media.set('5002', shelf);
media.set('5004', await sharp({ create: { width: 600, height: 800, channels: 3, background: '#d5d8dc' } })
  .composite([{ input: await sharp(Buffer.from(art(PRODUCTS[0]!, 360, 490))).png().toBuffer(), left: 120, top: 150 }]).jpeg().toBuffer());

// SAM 3.1 stand-in: one cut-out per phrase, traced like the real call.
const { models } = await import('../src/meta/models.ts');
const { trace } = await import('../src/bus.ts');
models.cutOut = async (_image, concept, phone) => {
  const t0 = performance.now();
  await sleep(1400 + Math.random() * 900);
  const p = PRODUCTS.find((x) => x.phrase === concept)!;
  trace({ phone, model: 'sam-3.1', task: `segment “${concept}”`, ms: performance.now() - t0, ok: true, detail: { outcome: 'completed', masks: 2 } });
  return [{ concept, png: await cutPng(p), box: { left: 0, top: 0, right: 220, bottom: 300 } }];
};
await import('../src/server.ts');
// The transcribe stand-in tells speakers apart by the keywords sent with the audio.
const realTranscribe = models.transcribe;
models.transcribe = async (wav, opts) => realTranscribe(wav, { ...opts, keywords: [...(opts?.keywords ?? []), opts?.phone === OWNER ? 'Bana Bupe' : 'customer'] });

// ---------- the journey ----------
let seq = 0;
async function hook(from: string, message: Record<string, unknown>) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: from, profile: { name: from === OWNER ? 'Bupe Mwila' : 'Chanda Phiri' } }],
    messages: [{ id: `demo.${++seq}`, from, timestamp: '0', ...message }],
  } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'demo-secret').update(body).digest('hex');
  await fetch(`http://localhost:${APP}/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
}
const text = (from: string, body: string) => hook(from, { type: 'text', text: { body } });
const tap = (from: string, id: string, title: string) => hook(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });

const pace = Number(process.env.DEMO_PACE ?? 1);
const t0 = Date.now();
console.log(`T0 ${t0}`);
const step = (label: string) => console.log(`STEP ${((Date.now() - t0) / 1000).toFixed(1)} ${label}`);
const beat = (s: number) => sleep(s * 1000 * pace);
console.log(`Control room: http://localhost:${APP}  (starting in 6 s)`);
await beat(6);

step('Bupe, a market trader, messages Mesa Muse on WhatsApp');
await text(OWNER, 'Muli shani');                                         await beat(4);
await tap(OWNER, 'role:sell', '🏪 Open my shop');                         await beat(5);
step('She describes her shop in a Bemba voice note → Muse Voice Transcribe → Muse Spark builds the shop profile');
await hook(OWNER, { type: 'audio', audio: { id: '5001', mime_type: 'audio/ogg; codecs=opus', voice: true } }); await beat(9);
await tap(OWNER, 'profile:ok', '✅ That is right');                      await beat(4);
step('One photo of her stall → Muse Spark names the products → SAM 3.1 cuts each one out → Muse Spark prices them in kwacha');
await hook(OWNER, { type: 'image', image: { id: '5002', mime_type: 'image/jpeg' } }); await beat(18);
step('She corrects a price in her own words → Muse Spark turns it into a catalogue edit');
await text(OWNER, 'Number 2 ni K90');                                    await beat(9);
step('One tap opens the shop: QR code + WhatsApp link');
await tap(OWNER, 'catalog:publish', '🚀 Open my shop');                    await beat(7);

const shop = await (await fetch(`http://localhost:${APP}/api/state`)).json() as { shops: { code: string }[] };
step('A customer arrives through the link and sees product cut-outs');
await text(BUYER, `Hi Bana Bupe Groceries! #${shop.shops[0]!.code}`);   await beat(8);
turns.push({ tool_calls: [{ id: 'c1', type: 'function', function: { name: 'show_products', arguments: JSON.stringify({ product_ids: [1] }) } }] });
turns.push({ content: 'Ee, tuli na Orange squash 2L pa K45 — ebo bwino ici mwatumine. Mulefwaya angati?' });
step('The customer sends a photo — Muse Spark vision finds the matching product and calls show_products');
await hook(BUYER, { type: 'image', image: { id: '5004', mime_type: 'image/jpeg', caption: 'Mwalikwata ici?' } }); await beat(9);
turns.push({ tool_calls: [{ id: 'c2', type: 'function', function: { name: 'set_cart', arguments: JSON.stringify({ product_id: 1, qty: 2 }) } }] });
turns.push({ content: '2 × Orange squash 2L = K90. Mukesa ku stall 14 nangu tumi delivery? Ishina lyenu?' });
step('A voice note → Muse Voice Transcribe → Muse Spark fills the cart (set_cart)');
await hook(BUYER, { type: 'audio', audio: { id: '5003', mime_type: 'audio/ogg; codecs=opus', voice: true } }); await beat(9);
turns.push({ tool_calls: [{ id: 'c3', type: 'function', function: { name: 'place_order', arguments: JSON.stringify({ customer_name: 'Chanda Phiri', fulfilment: 'Pickup at stall 14 today, 17:00' }) } }] });
turns.push({ content: 'Natumina Bana Bupe order yenu (#1, K90). Alamweba nomba line.' });
step('Muse Spark reads the order back and calls place_order — the owner gets it on WhatsApp');
await text(BUYER, 'Ee, Chanda. Nkesa ku 5.');                            await beat(9);
step('The owner approves with one tap; the customer is told in their language');
await tap(OWNER, 'order:1:accept', '✅ Accept');                          await beat(6);
step('END');
console.log('Demo journey finished. Ctrl+C to stop.');
