import { readFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { config, mediaDir } from '../config.ts';
import { db, kwacha, productsOf, updateShop, type Order, type Shop } from '../db.ts';
import { models } from '../meta/models.ts';
import { productCard } from '../meta/sam.ts';
import { sendButtons, sendImage, sendText, uploadMedia } from '../whatsapp/cloud.ts';
import type { Inbound } from '../whatsapp/inbound.ts';
import { applyEdits, editsFromWords, photoToProducts, type DraftItem } from './catalog.ts';
import { contactSheet, heard, photo, publicMedia, saveMedia } from './media.ts';

type Profile = { name: string; about: string; location: string; hours: string; payments: string; delivery: string; language: string; reply: string };

export function shopLink(shop: Shop) {
  const text = encodeURIComponent(`Hi ${shop.name}! #${shop.code}`);
  return `https://wa.me/${config.wa.displayNumber}?text=${text}`;
}

const draftOf = (shop: Shop): DraftItem[] => (shop.draft ? JSON.parse(shop.draft) : []);

/** Everything the owner says, whatever the format, becomes words first. */
async function words(m: Inbound, shop: Shop): Promise<string> {
  if (m.kind === 'voice') return heard(m, [shop.name, 'kwacha', 'Kalingalinga', 'Soweto market'].filter(Boolean));
  return m.text;
}

export async function welcomeOwner(to: string) {
  await sendText(to,
    "Let's open your shop on WhatsApp. 🎙️ Send me a voice note — in any language you like — telling me:\n\n" +
    '• your shop name\n• what you sell\n• where you are\n• your hours\n• how customers pay (cash, MTN, Airtel…)\n• if you deliver\n\nTalk the way you would to a friend.');
}

async function readProfile(m: Inbound, shop: Shop) {
  const said = await words(m, shop);
  if (!said.trim()) return sendText(m.from, "I couldn't hear that one. Could you send the voice note again?");
  const p = await models.museJson<Profile>({
    task: 'owner voice → shop profile', phone: m.from,
    system: 'A trader in Zambia is describing their shop so we can open it on WhatsApp. Extract the shop profile. ' +
      'Keep their own words for the shop name. Leave a field empty if they did not say it. ' +
      '"language" is the language they spoke (e.g. "Bemba", "Nyanja", "English"). ' +
      '"reply" is a warm two-line summary for them to confirm, in their language, written like a WhatsApp message.',
    user: said,
    schemaName: 'shop_profile',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['name', 'about', 'location', 'hours', 'payments', 'delivery', 'language', 'reply'],
      properties: Object.fromEntries(['name', 'about', 'location', 'hours', 'payments', 'delivery', 'language', 'reply'].map((k) => [k, { type: 'string' }])),
    },
    effort: 'low',
  });
  const { reply, ...profile } = p;
  updateShop(shop.id, { ...profile, name: profile.name || 'My shop', stage: 'confirm_profile' });
  const card = [
    `*${profile.name || 'My shop'}*`,
    profile.about && `🛍️ ${profile.about}`,
    profile.location && `📍 ${profile.location}`,
    profile.hours && `🕒 ${profile.hours}`,
    profile.payments && `💳 ${profile.payments}`,
    profile.delivery && `🛵 ${profile.delivery}`,
  ].filter(Boolean).join('\n');
  await sendButtons(m.from, `${reply}\n\n${card}`, [{ id: 'profile:ok', title: '✅ That is right' }, { id: 'profile:redo', title: '🎙️ Say it again' }]);
}

async function readStock(m: Inbound, shop: Shop) {
  await sendText(m.from, '📸 Got it. Finding each product and cutting it out… (about 20 seconds)');
  const pic = await photo(m);
  const fresh = await photoToProducts(pic, shop, m.from);
  if (!fresh.length) return sendText(m.from, "I couldn't pick out products in that photo. Try one with the items spread out and good light.");
  const items = [...draftOf(shop), ...fresh].slice(0, 20);
  // A live shop stays open while the owner reviews new stock; only a new shop moves to review.
  updateShop(shop.id, { draft: JSON.stringify(items), stage: shop.stage === 'live' ? 'live' : 'review' });
  await showDraft(m.from, { ...shop, draft: JSON.stringify(items) });
}

async function showDraft(to: string, shop: Shop) {
  const items = draftOf(shop);
  const sheet = await contactSheet(await Promise.all(items.map((it) => readFile(path.join(mediaDir, it.image)))));
  const file = await saveMedia(`sheet-${shop.id}-${Date.now()}.jpg`, sheet);
  const id = await uploadMedia(sheet, 'image/jpeg', 'catalog.jpg');
  await sendImage(to, id, items.map((it, i) => `${i + 1}. *${it.name}* — ${kwacha(it.price_ngwee)}\n   ${it.description}`).join('\n'), publicMedia(file));
  if (shop.stage === 'live') {
    return sendButtons(to,
      'This is *new stock* — your shop stays open meanwhile. Fix it by voice or text (e.g. "number 2 is K30"). Your messages change this new stock until you add or discard it.',
      [{ id: 'catalog:publish', title: '✅ Add to my shop' }, { id: 'catalog:discard', title: '🗑️ Discard new stock' }, { id: 'catalog:more', title: '📸 Add more' }]);
  }
  await sendButtons(to,
    'Fix anything by voice or text — e.g. "number 2 is K30, remove 4". Send another photo to add more.',
    [{ id: 'catalog:publish', title: '🚀 Open my shop' }, { id: 'catalog:more', title: '📸 Add more' }]);
}

async function publish(to: string, shop: Shop) {
  const items = draftOf(shop);
  if (!items.length) return sendText(to, '📸 Your catalog is empty — send a photo of your products first.');
  const now = Date.now();
  const insert = db.prepare('INSERT INTO products (shop_id, name, description, price_ngwee, image, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const it of items) insert.run(shop.id, it.name, it.description, it.price_ngwee, it.image, now);
  const wasLive = shop.stage === 'live';
  updateShop(shop.id, { draft: null, stage: 'live' });
  if (wasLive) return sendText(to, `✅ Added ${items.length} product${items.length === 1 ? '' : 's'} to *${shop.name}*. Customers see them now.`);
  const link = shopLink(shop);
  const qr = await QRCode.toBuffer(link, { width: 640, margin: 2, color: { dark: '#1f3a2e', light: '#f6f1e7' } });
  const file = await saveMedia(`qr-${shop.code}.png`, qr);
  await sendImage(to, await uploadMedia(qr, 'image/png', 'shop-qr.png'),
    `🎉 *${shop.name} is open!*\n\nPrint this QR for your stall, or share your link:\n${link}\n\nI'll answer customers for you and send every order here.`, publicMedia(file));
  await sendText(to, `Forward this to your customers 👇\n\n🛍️ *${shop.name}* is now on WhatsApp! See what's in stock and order in your own language — text, voice note or a photo of what you want.\n${link}`);
}

/** Spoken or typed corrections to the draft catalog. */
async function editDraft(m: Inbound, shop: Shop) {
  const said = await words(m, shop);
  const items = draftOf(shop);
  const { ops, reply } = await editsFromWords(said, items, shop, m.from);
  const next = applyEdits(items, ops);
  if (!next.length) {
    updateShop(shop.id, { draft: null, stage: shop.stage === 'live' ? 'live' : 'stock' });
    return sendText(m.from, `${reply}\n\n📸 Nothing left in the draft — send a new photo when you're ready.`);
  }
  updateShop(shop.id, { draft: JSON.stringify(next) });
  await sendText(m.from, shop.stage === 'live' ? `🆕 New stock: ${reply}` : reply);
  if (ops.length) return showDraft(m.from, { ...shop, draft: JSON.stringify(next) });
}

/** The owner's answer to a customer's question goes straight to that customer. */
async function relayAnswer(m: Inbound, shop: Shop) {
  const to = shop.answering!;
  updateShop(shop.id, { answering: null });
  const said = await words(m, shop);
  await sendText(to, `💬 *${shop.name}*: ${said}`);
  await sendText(m.from, '✅ Sent.');
}

/** After launch: the owner can keep talking to their shop. */
async function liveOwner(m: Inbound, shop: Shop) {
  if (m.kind === 'image') return readStock(m, shop);
  if (draftOf(shop).length && (m.kind === 'voice' || m.kind === 'text')) return editDraft(m, shop);
  const said = await words(m, shop);
  const products = productsOf(shop.id);
  const today = db.prepare('SELECT * FROM orders WHERE shop_id = ? AND created_at > ? ORDER BY id').all(shop.id, Date.now() - 86_400_000) as Order[];
  const { ops, reply } = await editsFromWords(
    `${said}\n\n(Orders in the last 24h: ${today.map((o) => `#${o.id} ${o.customer_name || o.customer_phone} ${kwacha(o.total_ngwee)} ${o.status}`).join('; ') || 'none'})`,
    products, shop, m.from);
  if (ops.length) {
    const next = applyEdits(products, ops);
    const kept = new Set(next.map((p) => p.id));
    for (const p of products) if (!kept.has(p.id)) db.prepare('UPDATE products SET available = 0 WHERE id = ?').run(p.id);
    for (const p of next) db.prepare('UPDATE products SET name = ?, description = ?, price_ngwee = ? WHERE id = ?').run(p.name, p.description, p.price_ngwee, p.id);
  }
  await sendText(m.from, reply);
}

export async function onOrderDecision(to: string, shop: Shop, orderId: number, accept: boolean) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND shop_id = ?').get(orderId, shop.id) as Order | undefined;
  if (!order) return sendText(to, `I can't find order #${orderId}.`);
  if (order.status !== 'new') return sendText(to, 'That order was already handled.');
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', orderId);
  const note = await models.museJson<{ message: string }>({
    task: 'order decision → customer message', phone: order.customer_phone,
    system: `Write one short WhatsApp message from ${shop.name} to a customer. Use the language the customer has been using in the order notes. Be warm, specific, no emojis spam.`,
    user: `Order #${order.id}: ${order.items}. Total ${kwacha(order.total_ngwee)}. Fulfilment: ${order.fulfilment}. The shop ${accept ? 'ACCEPTED it. Tell them how payment works: ' + shop.payments : 'cannot do it right now. Apologise and invite them to try again later.'}`,
    schemaName: 'note', schema: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } },
    effort: 'minimal',
  });
  await sendText(order.customer_phone, note.message);
  await sendText(to, accept ? `✅ Order #${order.id} accepted — customer told.` : `Order #${order.id} declined — customer told.`);
}

export async function ownerTurn(m: Inbound, shop: Shop) {
  const id = m.replyId ?? '';
  if (id === 'profile:redo') { updateShop(shop.id, { stage: 'profile' }); return welcomeOwner(m.from); }
  if (id === 'profile:ok') {
    updateShop(shop.id, { stage: 'stock' });
    return sendText(m.from, `Lovely. Now 📸 send me a photo of what you sell — your table, shelf or rack. I'll cut out every product and price it for you.`);
  }
  if (id === 'catalog:publish') return publish(m.from, shop);
  if (id === 'catalog:more') return sendText(m.from, '📸 Send the next photo.');
  if (id === 'catalog:discard') {
    updateShop(shop.id, { draft: null });
    return sendText(m.from, 'New stock discarded. Your shop is unchanged.');
  }
  if (id.startsWith('answer:')) {
    updateShop(shop.id, { answering: id.slice(7) });
    return sendText(m.from, '🎙️ Send your answer — voice note or text — and I will pass it on.');
  }
  if (shop.answering && (m.kind === 'text' || m.kind === 'voice')) return relayAnswer(m, shop);
  if (id.startsWith('order:')) {
    const [, oid, verdict] = id.split(':');
    if (!/^\d+$/.test(oid ?? '')) return sendText(m.from, "I can't find that order.");
    return onOrderDecision(m.from, shop, Number(oid), verdict === 'accept');
  }

  switch (shop.stage) {
    case 'profile':
    case 'confirm_profile':
      if (m.kind === 'voice' || m.kind === 'text') return readProfile(m, shop);
      return welcomeOwner(m.from);
    case 'stock':
      if (m.kind === 'image') return readStock(m, shop);
      return sendText(m.from, '📸 Send a photo of your products and I will build your catalog.');
    case 'review':
      if (m.kind === 'image') return readStock(m, shop);
      if (m.kind === 'voice' || m.kind === 'text') return editDraft(m, shop);
      return;
    default:
      return liveOwner(m, shop);
  }
}

/** Sent to the owner the moment a customer orders. */
export async function notifyOwner(shop: Shop, order: Order) {
  const items = JSON.parse(order.items) as { name: string; qty: number; price_ngwee: number }[];
  const first = productsOf(shop.id).find((p) => p.name === items[0]?.name);
  const header = first?.image ? { imageId: await uploadMedia(await productCard(await readFile(path.join(mediaDir, first.image))), 'image/jpeg', 'order.jpg'), imageUrl: publicMedia(first.image) } : undefined;
  await sendButtons(shop.owner_phone,
    `🛒 *New order #${order.id}* from ${order.customer_name || '+' + order.customer_phone}\n\n` +
    items.map((i) => `${i.qty} × ${i.name} — ${kwacha(i.qty * i.price_ngwee)}`).join('\n') +
    `\n\n*Total ${kwacha(order.total_ngwee)}*\n${order.fulfilment}`,
    [{ id: `order:${order.id}:accept`, title: '✅ Accept' }, { id: `order:${order.id}:decline`, title: '✖️ Can’t do it' }],
    header);
}
