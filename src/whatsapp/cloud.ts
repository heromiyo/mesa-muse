import { createHmac, timingSafeEqual } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, mediaDir } from '../config.ts';
import { bus } from '../bus.ts';
import { db } from '../db.ts';

const wa = config.wa;

async function graph<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${wa.graph}/${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${wa.token}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function logOut(to: string, kind: string, body: string, media?: string) {
  const row = { phone: to, direction: 'out', kind, body, media: media ?? null, created_at: Date.now() };
  const info = db.prepare('INSERT INTO messages (phone, direction, kind, body, media, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.phone, row.direction, row.kind, row.body, row.media, row.created_at);
  bus.emit('event', { type: 'message', id: Number(info.lastInsertRowid), ...row });
}

async function send(to: string, payload: Record<string, unknown>) {
  return graph<{ messages?: { id: string }[] }>(`${wa.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
  });
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function sendText(to: string, text: string) {
  await send(to, { type: 'text', text: { body: clip(text, 4096), preview_url: true } });
  logOut(to, 'text', text);
}

export type Button = { id: string; title: string };

/** Up to three reply buttons; WhatsApp caps titles at 20 characters. */
export async function sendButtons(to: string, body: string, buttons: Button[], header?: { imageId: string; imageUrl?: string }) {
  await send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'image', image: { id: header.imageId } } } : {}),
      body: { text: clip(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  });
  logOut(to, 'buttons', `${body}\n${buttons.map((b) => `[${b.title}]`).join(' ')}`, header?.imageUrl);
}

export type Row = { id: string; title: string; description?: string };

/** A list message: one button opening up to ten rows. */
export async function sendList(to: string, body: string, button: string, rows: Row[], sectionTitle = 'Choose') {
  await send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, 1024) },
      action: {
        button: clip(button, 20),
        sections: [{ title: clip(sectionTitle, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })) }],
      },
    },
  });
  logOut(to, 'list', `${body}\n${rows.map((r) => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`).join('\n')}`);
}

/** Upload bytes to WhatsApp once and get a media id we can reuse in later messages. */
export async function uploadMedia(bytes: Buffer, mime: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  const out = await graph<{ id: string }>(`${wa.phoneNumberId}/media`, { method: 'POST', body: form });
  return out.id;
}

export async function sendImage(to: string, mediaId: string, caption: string, publicUrl?: string) {
  await send(to, { type: 'image', image: { id: mediaId, caption: clip(caption, 1024) } });
  logOut(to, 'image', caption, publicUrl);
}

/** Blue ticks plus the "typing…" bubble while Muse works. */
export async function markReadTyping(messageId: string) {
  await graph(`${wa.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
  }).catch(() => {});
}

/** Fetch an inbound photo or voice note and keep a copy for the control room. */
export async function downloadMedia(mediaId: string, ext: string): Promise<{ file: string; bytes: Buffer }> {
  const info = await graph<{ url: string }>(mediaId);
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${wa.token}` } });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = path.join(mediaDir, `${mediaId}.${ext}`);
  await writeFile(file, bytes);
  return { file, bytes };
}

/** Meta signs every webhook POST with the app secret (X-Hub-Signature-256). */
export function validSignature(raw: string, header: string | undefined): boolean {
  if (!wa.appSecret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', wa.appSecret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}
