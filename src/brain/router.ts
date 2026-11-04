import { bus } from '../bus.ts';
import { createShop, db, person, shopById, shopByCode, shopByOwner, updatePerson, updateShop, type Shop } from '../db.ts';
import { markReadTyping, sendButtons, sendList, sendText } from '../whatsapp/cloud.ts';
import type { Inbound } from '../whatsapp/inbound.ts';
import { customerTurn, greetCustomer } from './customer.ts';
import { ownerTurn, welcomeOwner } from './owner.ts';

/** Shop links put "#CODE" in the first message, so a customer lands in the right shop. */
export const shopCodeIn = (text: string) => text.match(/#([A-Z2-9]{4})\b/i)?.[1]?.toUpperCase();

/** Store the inbound message once; WhatsApp retries webhooks, so duplicates are dropped. */
function record(m: Inbound): boolean {
  const body = m.kind === 'voice' ? '🎙️ voice note' : m.kind === 'image' ? `📷 ${m.text}`.trim() : m.text;
  const info = db.prepare('INSERT OR IGNORE INTO messages (wa_id, phone, direction, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m.id, m.from, 'in', m.kind, body, Date.now());
  if (!info.changes) return false;
  bus.emit('event', { type: 'message', id: Number(info.lastInsertRowid), phone: m.from, direction: 'in', kind: m.kind, body, created_at: Date.now() });
  return true;
}

const liveShops = () => db.prepare("SELECT * FROM shops WHERE stage = 'live' ORDER BY id DESC LIMIT 10").all() as Shop[];

async function chooseRole(m: Inbound) {
  await sendButtons(m.from,
    `Muli shani${m.name ? ` ${m.name.split(' ')[0]}` : ''}! 👋 I'm *Mesa Muse*. I put small shops on WhatsApp in two minutes — from one voice note and one photo.\n\nWhat would you like to do?`,
    [{ id: 'role:sell', title: '🏪 Open my shop' }, { id: 'role:buy', title: '🛍️ Shop nearby' }]);
}

async function becomeCustomer(phone: string, shop: Shop) {
  // An owner who leaves for another shop drops any answer they had not sent.
  const owned = shopByOwner(phone);
  if (owned?.answering && owned.id !== shop.id) updateShop(owned.id, { answering: null });
  updatePerson(phone, { role: 'customer', shop_id: shop.id, history: '[]', cart: '[]' });
  await greetCustomer(phone, shop);
}

export async function handle(m: Inbound) {
  if (!record(m)) return;
  void markReadTyping(m.id);
  const me = person(m.from);
  if (m.name && !me.name) updatePerson(m.from, { name: m.name });
  const owned = shopByOwner(m.from);

  // A shop link always wins: it is how customers (and owners testing their own shop) arrive.
  const code = m.kind === 'text' ? shopCodeIn(m.text) : undefined;
  const linked = code ? shopByCode(code) : undefined;
  if (linked && linked.stage === 'live') return becomeCustomer(m.from, linked);

  if (m.replyId === 'role:sell' || (owned && m.kind === 'text' && m.text.trim().toLowerCase() === 'my shop')) {
    const shop = owned ?? createShop(m.from);
    if (shop.answering) updateShop(shop.id, { answering: null });
    updatePerson(m.from, { role: 'owner', shop_id: shop.id });
    if (shop.stage === 'live') return sendText(m.from, `You're managing *${shop.name}*. Send a photo to add stock, or tell me what changed.`);
    return welcomeOwner(m.from);
  }
  if (m.replyId === 'role:buy') {
    const shops = liveShops();
    if (!shops.length) return sendText(m.from, 'No shops are open yet — be the first! Tap "Open my shop".');
    return sendList(m.from, 'Pick a shop:', 'See shops', shops.map((s) => ({ id: `shop:${s.id}`, title: s.name, description: [s.about, s.location].filter(Boolean).join(' · ') })), 'Open now');
  }
  if (m.replyId?.startsWith('shop:')) {
    const shop = shopById(Number(m.replyId.slice(5)));
    if (shop) return becomeCustomer(m.from, shop);
  }

  if (me.role === 'owner' && owned) return ownerTurn(m, owned);
  // Tapping "Answer them" from anywhere puts the owner back in their own shop to answer.
  if (owned && m.replyId?.startsWith('answer:') && me.shop_id !== owned.id) {
    updatePerson(m.from, { role: 'owner', shop_id: owned.id });
    me.shop_id = owned.id;
  }
  // Order and answer buttons (and the answer that follows) reach the owner even while they browse their own shop as a customer.
  if (owned && (m.replyId?.startsWith('order:') || m.replyId?.startsWith('answer:') || (owned.answering && me.shop_id === owned.id && (m.kind === 'text' || m.kind === 'voice'))))
    return ownerTurn(m, owned);
  if (me.role === 'customer' && me.shop_id) {
    const shop = shopById(me.shop_id);
    if (shop) return customerTurn(m, shop);
  }
  return chooseRole(m);
}

/** Run each sender's messages in order, different senders in parallel. */
const queues = new Map<string, Promise<void>>();
export function enqueue(m: Inbound) {
  const prev = queues.get(m.from) ?? Promise.resolve();
  const next = prev.then(() => handle(m)).catch(async (err) => {
    console.error('turn failed', m.from, err);
    await sendText(m.from, 'Sorry — something went wrong on my side. Please try that again.').catch(() => {});
  });
  queues.set(m.from, next);
  void next.finally(() => { if (queues.get(m.from) === next) queues.delete(m.from); });
}
