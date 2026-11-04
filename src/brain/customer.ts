import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type OpenAI from 'openai';
import { mediaDir } from '../config.ts';
import { db, kwacha, person, productsOf, updatePerson, type Order, type Product, type Shop } from '../db.ts';
import { imagePart } from '../meta/muse.ts';
import { models } from '../meta/models.ts';
import { productCard } from '../meta/sam.ts';
import { sendButtons, sendText, uploadMedia } from '../whatsapp/cloud.ts';
import type { Inbound } from '../whatsapp/inbound.ts';
import { heard, photo, publicMedia } from './media.ts';
import { notifyOwner } from './owner.ts';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type CartLine = { product_id: number; qty: number };

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: {
    name: 'show_products',
    description: 'Send the customer photos of up to 3 products (each with name, price and an "Add to order" button). Use whenever they ask what you have or ask about a product.',
    parameters: { type: 'object', required: ['product_ids'], properties: { product_ids: { type: 'array', items: { type: 'integer' }, maxItems: 3 } } },
  } },
  { type: 'function', function: {
    name: 'set_cart',
    description: 'Set the quantity of a product in the cart (0 removes it).',
    parameters: { type: 'object', required: ['product_id', 'qty'], properties: { product_id: { type: 'integer' }, qty: { type: 'integer', minimum: 0 } } },
  } },
  { type: 'function', function: {
    name: 'place_order',
    description: 'Place the order for what is in the cart once the customer has confirmed it and said pickup or delivery (with where). Sends it to the shop owner.',
    parameters: { type: 'object', required: ['customer_name', 'fulfilment'], properties: { customer_name: { type: 'string' }, fulfilment: { type: 'string', description: 'e.g. "Pickup today 5pm" or "Deliver to Chelstone, near the clinic"' } } },
  } },
  { type: 'function', function: {
    name: 'ask_owner',
    description: 'Forward a question you cannot answer from the shop facts (e.g. bulk discount, a product not listed) to the owner.',
    parameters: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } },
  } },
];

function system(shop: Shop, products: Product[], cart: CartLine[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  return `You are the WhatsApp shop assistant for "${shop.name}" in Zambia, talking to a customer.
Shop: ${shop.about}. Location: ${shop.location || 'ask the owner'}. Hours: ${shop.hours || 'ask the owner'}. Payment: ${shop.payments || 'cash'}. Delivery: ${shop.delivery || 'ask the owner'}.

Catalog (id · name · price · note):
${products.map((p) => `${p.id} · ${p.name} · ${kwacha(p.price_ngwee)} · ${p.description}`).join('\n') || '(empty)'}

Cart: ${cart.length ? cart.map((l) => `${l.qty} × ${byId.get(l.product_id)?.name ?? '?'}`).join(', ') : 'empty'}

Rules:
- Reply in the customer's language (English, Bemba, Nyanja, Tonga, Lozi… match them). Short WhatsApp messages, like a friendly shopkeeper.
- Only sell what is in the catalog at those prices. Never invent stock, prices, discounts or delivery promises.
- If they send a photo, work out which catalog product it is (or the closest one) and show it.
- Show products with show_products rather than describing them in text.
- Before place_order, read back the items and total and get a clear yes, plus pickup or delivery.
- After a tool call, say one short line; do not repeat what the photos already show.`;
}

async function showProducts(to: string, ids: number[], products: Product[]) {
  for (const p of products.filter((x) => ids.includes(x.id)).slice(0, 3)) {
    const caption = `*${p.name}* — ${kwacha(p.price_ngwee)}\n${p.description}`;
    if (p.image) {
      const card = await productCard(await readFile(path.join(mediaDir, p.image)));
      const imageId = await uploadMedia(card, 'image/jpeg', `${p.id}.jpg`);
      await sendButtons(to, caption, [{ id: `add:${p.id}`, title: '➕ Add to order' }], { imageId, imageUrl: publicMedia(p.image) });
    } else {
      await sendButtons(to, caption, [{ id: `add:${p.id}`, title: '➕ Add to order' }]);
    }
  }
}

function placeOrder(shop: Shop, phone: string, cart: CartLine[], products: Product[], name: string, fulfilment: string): Order | undefined {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = cart.map((l) => ({ ...l, p: byId.get(l.product_id) })).filter((l) => l.p && l.qty > 0);
  if (!lines.length) return undefined;
  const items = lines.map((l) => ({ name: l.p!.name, qty: l.qty, price_ngwee: l.p!.price_ngwee }));
  const total = items.reduce((s, i) => s + i.qty * i.price_ngwee, 0);
  const info = db.prepare('INSERT INTO orders (shop_id, customer_phone, customer_name, items, total_ngwee, fulfilment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(shop.id, phone, name, JSON.stringify(items), total, fulfilment, Date.now());
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid)) as Order;
}

export async function greetCustomer(to: string, shop: Shop) {
  const products = productsOf(shop.id);
  await sendText(to, `👋 Welcome to *${shop.name}*! ${shop.about ? `We sell ${shop.about}.` : ''}\n\nAsk me anything — type, send a voice note, or send a photo of what you're looking for.`);
  if (products.length) await showProducts(to, products.slice(0, 3).map((p) => p.id), products);
}

export async function customerTurn(m: Inbound, shop: Shop) {
  const me = person(m.from);
  let cart = JSON.parse(me.cart) as CartLine[];
  const products = productsOf(shop.id);
  const history = (JSON.parse(me.history) as Msg[]).slice(-16);

  // Taps that need no thinking.
  if (m.replyId?.startsWith('add:')) {
    const pid = Number(m.replyId.slice(4));
    const line = cart.find((l) => l.product_id === pid);
    if (line) line.qty += 1; else cart.push({ product_id: pid, qty: 1 });
    updatePerson(m.from, { cart: JSON.stringify(cart) });
  }

  let content: OpenAI.Chat.Completions.ChatCompletionUserMessageParam['content'];
  if (m.kind === 'voice') content = `(voice note) ${await heard(m, products.map((p) => p.name))}`;
  else if (m.kind === 'image') content = [{ type: 'text', text: `(sent a photo) ${m.text}`.trim() }, imagePart((await photo(m)).dataUrl)];
  else if (m.replyId?.startsWith('add:')) content = `(tapped "Add to order" on ${products.find((p) => p.id === Number(m.replyId!.slice(4)))?.name})`;
  else content = m.text;

  const turn: Msg[] = [{ role: 'user', content }];
  for (let step = 0; step < 4; step++) {
    const reply = await models.museTurn({
      task: 'customer chat', phone: m.from, tools,
      messages: [{ role: 'system', content: system(shop, products, cart) }, ...history, ...turn],
    });
    turn.push(reply as Msg);
    if (!reply.tool_calls?.length) {
      if (reply.content?.trim()) await sendText(m.from, reply.content.trim());
      break;
    }
    for (const call of reply.tool_calls) {
      let result = 'ok';
      const args = JSON.parse(call.function.arguments || '{}');
      if (call.function.name === 'show_products') await showProducts(m.from, args.product_ids ?? [], products);
      else if (call.function.name === 'set_cart') {
        cart = cart.filter((l) => l.product_id !== args.product_id);
        if (args.qty > 0 && products.some((p) => p.id === args.product_id)) cart.push({ product_id: args.product_id, qty: args.qty });
        updatePerson(m.from, { cart: JSON.stringify(cart) });
      } else if (call.function.name === 'place_order') {
        const order = placeOrder(shop, m.from, cart, products, args.customer_name || m.name, args.fulfilment);
        if (order) {
          cart = [];
          updatePerson(m.from, { cart: '[]', name: args.customer_name || m.name });
          await notifyOwner(shop, order);
          result = `Order #${order.id} sent to the owner, total ${kwacha(order.total_ngwee)}. Tell the customer the owner will confirm shortly.`;
        } else result = 'Cart is empty — nothing to order.';
      } else if (call.function.name === 'ask_owner') {
        await sendText(shop.owner_phone, `❓ A customer (+${m.from}) asks: ${args.question}`);
        result = 'Forwarded to the owner; they may message the customer directly.';
      }
      turn.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  // Keep text-only memory (images are not replayed).
  const memo: Msg[] = turn.flatMap((t): Msg[] => {
    if (t.role === 'user') return [{ role: 'user', content: typeof t.content === 'string' ? t.content : '(sent a photo)' }];
    if (t.role === 'assistant' && typeof t.content === 'string' && t.content.trim() && !('tool_calls' in t && t.tool_calls?.length)) return [{ role: 'assistant', content: t.content }];
    return [];
  });
  updatePerson(m.from, { history: JSON.stringify([...history, ...memo].slice(-16)) });
}
