/**
 * End-to-end journey through the real webhook, router, brains, WhatsApp client and
 * OpenAI-SDK calls, against two fakes on localhost: the WhatsApp Graph API and the
 * Meta Model API. SAM is scripted through the `models` seam because its wire grammar
 * is internal to Meta's parser.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(path.join(tmpdir(), 'muse-flow-'));
const FAKE = 18791, APP = 18792;
Object.assign(process.env, {
  DB_PATH: ':memory:', DATA_DIR: dir, PORT: String(APP), PUBLIC_URL: `http://localhost:${APP}`,
  MODEL_API_KEY: 'LLM|1|test', MODEL_API_BASE: `http://localhost:${FAKE}/v1`,
  WA_TOKEN: 'EAAtest', WA_PHONE_NUMBER_ID: '555', WA_VERIFY_TOKEN: 'verify-me', WA_APP_SECRET: 'app-secret',
  WA_DISPLAY_NUMBER: '15550001111', WA_GRAPH: `http://localhost:${FAKE}/graph`,
});

const OWNER = '260970000001', BUYER = '260970000002';

// ---------- fakes ----------
type Sent = { to: string; type: string; body: Record<string, any> };
const sent: Sent[] = [];
const media = new Map<string, Buffer>();
const modelCalls: { kind: string; body: any }[] = [];
const turns: any[] = []; // scripted Muse Spark tool-loop replies
let mediaSeq = 0;

const json = (schema: string, body: any) => {
  switch (schema) {
    case 'shop_profile': return { name: 'Bana Bupe Groceries', about: 'drinks, cooking oil and soap', location: 'Soweto market', hours: '06:00-19:00', payments: 'Cash, MTN', delivery: 'Matero', language: 'Bemba', reply: 'Ee mukwai! Nalumfwa.' };
    case 'stock_plan': return { products: [{ phrase: 'orange juice bottle', count: 2 }, { phrase: 'cooking oil bottle', count: 1 }, { phrase: 'soap bar', count: 3 }] };
    case 'catalog': {
      const n = body.messages[1].content.filter((c: any) => c.type === 'image_url').length;
      const names = ['Mazoe Orange 2L', 'Cooking oil 2.5L', 'Boom bar'];
      return { items: Array.from({ length: n }, (_, i) => ({ number: i + 1, name: names[i] ?? `Item ${i + 1}`, description: 'Fresh stock', price_kwacha: [45, 95, 12][i] ?? 10 })) };
    }
    case 'edits': return { ops: [{ op: 'set_price', number: 2, value: '90' }], reply: 'Done — cooking oil is now K90.' };
    case 'note': return { message: 'Ee! Your order is accepted. Pay cash or MTN on pickup.' };
    default: throw new Error(`no fake for schema ${schema}`);
  }
};

async function read(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

let fake: Server;
before(async () => {
  fake = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const raw = await read(req);
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/graph/')) {
      assert.equal(req.headers.authorization, 'Bearer EAAtest');
      const p = url.pathname.slice(7);
      if (p === '555/messages') {
        const b = JSON.parse(raw.toString());
        if (b.status === 'read') return reply(200, { success: true });
        sent.push({ to: b.to, type: b.type, body: b });
        return reply(200, { messages: [{ id: `wamid.${sent.length}` }] });
      }
      if (p === '555/media') { const id = `up-${++mediaSeq}`; return reply(200, { id }); }
      if (media.has(p)) return reply(200, { url: `http://localhost:${FAKE}/dl/${p}` });
      return reply(404, { error: 'unknown' });
    }
    if (url.pathname.startsWith('/dl/')) { res.end(media.get(url.pathname.slice(4))); return; }
    if (url.pathname === '/v1/chat/completions') {
      const b = JSON.parse(raw.toString());
      assert.equal(req.headers.authorization, 'Bearer LLM|1|test');
      assert.equal(b.model, 'muse-spark-1.3');
      if (b.tools) {
        modelCalls.push({ kind: 'turn', body: b });
        const next = turns.shift() ?? { content: 'Anything else?' };
        return reply(200, { id: 'c', object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, finish_reason: next.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: next.content ?? null, tool_calls: next.tool_calls } }] });
      }
      const schema = b.response_format.json_schema.name;
      modelCalls.push({ kind: schema, body: b });
      return reply(200, { id: 'c', object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(json(schema, b)) } }] });
    }
    if (url.pathname === '/v1/asr/transcribe') {
      const text = raw.toString('latin1');
      assert.match(text, /name="request"\r\nContent-Type: application\/json\r\n\r\n\{"mode":"PUSH_TO_TALK","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"/);
      assert.match(text, /name="audio"; filename="voice.wav"\r\nContent-Type: audio\/wav\r\n\r\nRIFF/);
      modelCalls.push({ kind: 'asr', body: null });
      return reply(200, { sessionId: 's', transcript: 'Shina lyandi ni Bupe, ndashitisha Mazoe na oil ku Soweto market', audioDurationMs: 1000 });
    }
    reply(404, { error: url.pathname });
  }).listen(FAKE);

  // Real media for the downloads: an Opus voice note and a shelf photo.
  const ogg = path.join(dir, 'in.ogg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', ogg]);
  media.set('voice-1', readFileSync(ogg));
  media.set('photo-1', await sharp({ create: { width: 900, height: 600, channels: 3, background: '#d8c8a8' } }).jpeg().toBuffer());

  // Scripted SAM: three cut-outs from the photo.
  const { models } = await import('../src/meta/models.ts');
  models.cutOut = async (image, concept) => {
    modelCalls.push({ kind: 'sam', body: concept });
    const png = await sharp({ create: { width: 120, height: 200, channels: 4, background: { r: 200, g: 60, b: 40, alpha: 1 } } }).png().toBuffer();
    return [{ concept, png, box: { left: 10, top: 10, right: 130, bottom: 210 } }];
  };
  await import('../src/server.ts');
});
after(() => { fake.close(); setTimeout(() => process.exit(0), 50); });

// ---------- helpers ----------
let msgSeq = 0;
async function hook(from: string, message: Record<string, unknown>, id = `in.${++msgSeq}`) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: from, profile: { name: from === OWNER ? 'Bupe Mwila' : 'Chanda' } }],
    messages: [{ id, from, timestamp: '0', ...message }],
  } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
  const res = await fetch(`http://localhost:${APP}/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
  assert.equal(res.status, 200);
}
const text = (from: string, body: string) => hook(from, { type: 'text', text: { body } });
const tap = (from: string, id: string, title = id) => hook(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });

/** Wait until `n` more messages have gone out, then return them. */
async function out(n: number, timeout = 8000): Promise<Sent[]> {
  const start = sent.length, t0 = Date.now();
  while (sent.length < start + n) {
    if (Date.now() - t0 > timeout) assert.fail(`expected ${n} sends, got ${sent.length - start}: ${JSON.stringify(sent.slice(start))}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 80));
  return sent.slice(start);
}
const textOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? s.body.image?.caption ?? '';
const buttonIds = (s: Sent) => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
const mark = () => sent.length;

// ---------- the journey ----------
test('webhook verification handshake', async () => {
  const ok = await fetch(`http://localhost:${APP}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.equal(await ok.text(), '42');
  const bad = await fetch(`http://localhost:${APP}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
  assert.equal(bad.status, 403);
});

test('unsigned webhooks are rejected', async () => {
  const res = await fetch(`http://localhost:${APP}/webhook`, { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': 'sha256=00' } });
  assert.equal(res.status, 401);
});

let code = '';
test('owner opens a shop from a voice note and a photo', async () => {
  await text(OWNER, 'hi');
  let [m] = await out(1);
  assert.deepEqual(buttonIds(m!), ['role:sell', 'role:buy']);

  await tap(OWNER, 'role:sell');
  [m] = await out(1);
  assert.match(textOf(m!), /voice note/);

  await hook(OWNER, { type: 'audio', audio: { id: 'voice-1', mime_type: 'audio/ogg; codecs=opus', voice: true } });
  [m] = await out(1);
  assert.match(textOf(m!), /Bana Bupe Groceries/);
  assert.deepEqual(buttonIds(m!), ['profile:ok', 'profile:redo']);
  assert.ok(modelCalls.some((c) => c.kind === 'asr'));
  assert.match(modelCalls.find((c) => c.kind === 'shop_profile')!.body.messages[1].content, /Soweto market/);

  await tap(OWNER, 'profile:ok');
  [m] = await out(1);
  assert.match(textOf(m!), /photo/);

  await hook(OWNER, { type: 'image', image: { id: 'photo-1', mime_type: 'image/jpeg' } });
  const batch = await out(3, 15000); // "got it", contact sheet, review buttons
  assert.match(textOf(batch[0]!), /cutting it out/);
  assert.equal(batch[1]!.type, 'image');
  assert.match(textOf(batch[1]!), /1\. \*Mazoe Orange 2L\* — K45/);
  assert.deepEqual(buttonIds(batch[2]!), ['catalog:publish', 'catalog:more']);
  assert.equal(modelCalls.filter((c) => c.kind === 'sam').length, 3);
  const pricing = modelCalls.find((c) => c.kind === 'catalog')!.body.messages[1].content;
  assert.equal(pricing.filter((c: any) => c.type === 'image_url').length, 3, 'Muse Spark sees every cut-out');

  await text(OWNER, 'number 2 is K90');
  const fixed = await out(3);
  assert.match(textOf(fixed[0]!), /K90/);
  assert.match(textOf(fixed[1]!), /2\. \*Cooking oil 2.5L\* — K90/);

  await tap(OWNER, 'catalog:publish');
  const live = await out(2);
  assert.equal(live[0]!.type, 'image');
  const link = textOf(live[0]!).match(/https:\/\/wa\.me\/15550001111\?text=\S+/)![0];
  code = decodeURIComponent(link).match(/#([A-Z2-9]{4})/)![1]!;
  assert.match(textOf(live[1]!), /Forward this/);

  const state = await (await fetch(`http://localhost:${APP}/api/state`)).json();
  assert.equal(state.shops[0].stage, 'live');
  assert.deepEqual(state.shops[0].products.map((p: any) => p.price_ngwee), [4500, 9000, 1200]);
});

test('customer arrives by link, adds to cart, orders; owner accepts', async () => {
  await text(BUYER, `Hi Bana Bupe Groceries! #${code}`);
  const welcome = await out(4);
  assert.match(textOf(welcome[0]!), /Welcome to \*Bana Bupe Groceries\*/);
  const cards = welcome.slice(1);
  assert.ok(cards.every((c) => c.body.interactive?.header?.type === 'image'), 'each product card carries its cut-out');
  const firstAdd = buttonIds(cards[0]!)[0];
  assert.match(firstAdd, /^add:\d+$/);

  turns.push({ content: 'Added 1 Mazoe! Anything else?' });
  await tap(BUYER, firstAdd, '➕ Add to order');
  let [m] = await out(1);
  assert.match(textOf(m!), /Added 1 Mazoe/);
  const sys = modelCalls.filter((c) => c.kind === 'turn').at(-1)!.body.messages[0].content as string;
  assert.match(sys, /Cart: 1 × Mazoe Orange 2L/);

  turns.push({ tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'place_order', arguments: JSON.stringify({ customer_name: 'Chanda', fulfilment: 'Pickup today 5pm' }) } }] });
  turns.push({ content: 'Order sent to Bupe — she will confirm shortly.' });
  await text(BUYER, "That's all. I'm Chanda, I'll pick up at 5");
  const placed = await out(2);
  const toOwner = placed.find((s) => s.to === OWNER)!;
  assert.match(textOf(toOwner), /New order #1.*\n\n1 × Mazoe Orange 2L — K45/s);
  assert.deepEqual(buttonIds(toOwner), ['order:1:accept', 'order:1:decline']);
  assert.equal(toOwner.body.interactive.header.type, 'image');
  assert.match(textOf(placed.find((s) => s.to === BUYER)!), /Order sent/);
  const toolReply = modelCalls.filter((c) => c.kind === 'turn').at(-1)!.body.messages.at(-1);
  assert.equal(toolReply.role, 'tool');
  assert.match(toolReply.content, /Order #1 sent to the owner, total K45/);

  await tap(OWNER, 'order:1:accept', '✅ Accept');
  const done = await out(2);
  assert.match(textOf(done.find((s) => s.to === BUYER)!), /accepted/);
  assert.match(textOf(done.find((s) => s.to === OWNER)!), /Order #1 accepted/);

  await tap(OWNER, 'order:1:accept', '✅ Accept');
  [m] = await out(1);
  assert.match(textOf(m!), /already handled/);
});

test('WhatsApp retries of the same message are handled once', async () => {
  const before = mark();
  await hook(BUYER, { type: 'text', text: { body: 'hello?' } }, 'dup-1');
  await hook(BUYER, { type: 'text', text: { body: 'hello?' } }, 'dup-1');
  await out(1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.length - before, 1);
});

test("a question the assistant can't answer reaches the owner, and the owner's answer reaches the customer", async () => {
  turns.push({ tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'ask_owner', arguments: JSON.stringify({ question: 'Do you sell 20L oil in bulk?' }) } }] });
  turns.push({ content: "I've asked Bupe — she'll reply here." });
  await text(BUYER, 'Do you have 20 litre oil for my restaurant?');
  const asked = await out(2);
  const toOwner = asked.find((s) => s.to === OWNER)!;
  assert.match(textOf(toOwner), /Do you sell 20L oil in bulk\?/);
  assert.deepEqual(buttonIds(toOwner), [`answer:${BUYER}`]);

  await tap(OWNER, `answer:${BUYER}`, '↩️ Answer them');
  await out(1);
  await text(OWNER, 'Yes, K1,050 per 20L. Come tomorrow.');
  const relayed = await out(2);
  assert.match(textOf(relayed.find((s) => s.to === BUYER)!), /\*Bana Bupe Groceries\*: Yes, K1,050 per 20L/);
  assert.match(textOf(relayed.find((s) => s.to === OWNER)!), /Sent/);
});

test('every model call is traced for the control room', async () => {
  const state = await (await fetch(`http://localhost:${APP}/api/state`)).json();
  const tasks = state.traces.map((t: any) => t.task);
  for (const want of ['voice note → text', 'owner voice → shop profile', 'photo → product list', 'cut-outs → names + prices', 'owner words → catalog edits', 'customer chat', 'order decision → customer message'])
    assert.ok(tasks.includes(want), `missing trace ${want}`);
  assert.ok(state.messages.some((m: any) => m.direction === 'in' && m.kind === 'voice'));
});
