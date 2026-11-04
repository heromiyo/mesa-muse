import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import path from 'node:path';
import { config } from './config.ts';
import { bus } from './bus.ts';
import { db, type Order, type Product, type Shop } from './db.ts';
import { enqueue } from './brain/router.ts';
import { shopLink } from './brain/owner.ts';
import { parseWebhook } from './whatsapp/inbound.ts';
import { validSignature } from './whatsapp/cloud.ts';

const app = new Hono();

// Meta's one-time webhook verification handshake.
app.get('/webhook', (c) => {
  const q = c.req.query();
  if (q['hub.mode'] === 'subscribe' && config.wa.verifyToken && q['hub.verify_token'] === config.wa.verifyToken) return c.text(q['hub.challenge'] ?? '');
  return c.text('forbidden', 403);
});

// Inbound messages: acknowledge at once, think afterwards (WhatsApp retries slow webhooks).
app.post('/webhook', async (c) => {
  const raw = await c.req.text();
  if (!validSignature(raw, c.req.header('x-hub-signature-256'))) return c.text('bad signature', 401);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return c.text('bad json', 400); }
  for (const m of parseWebhook(body)) enqueue(m);
  return c.text('ok');
});

// Control room data.
app.get('/api/state', (c) => {
  const shops = (db.prepare('SELECT * FROM shops ORDER BY id DESC').all() as Shop[]).map((s) => ({
    ...s, link: s.stage === 'live' ? shopLink(s) : null,
    products: db.prepare('SELECT * FROM products WHERE shop_id = ? AND available = 1 ORDER BY id').all(s.id) as Product[],
    draft: s.draft ? JSON.parse(s.draft) : [],
    orders: db.prepare('SELECT * FROM orders WHERE shop_id = ? ORDER BY id DESC LIMIT 20').all(s.id) as Order[],
  }));
  const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 120').all().reverse();
  const traces = db.prepare('SELECT * FROM traces ORDER BY id DESC LIMIT 120').all().reverse()
    .map((t) => ({ ...(t as Record<string, unknown>), detail: JSON.parse((t as { detail: string }).detail) }));
  const totals = db.prepare('SELECT model, COUNT(*) n, ROUND(AVG(ms)) avg_ms, SUM(ok) ok FROM traces GROUP BY model').all();
  return c.json({ shops, messages, traces, totals });
});

app.get('/api/events', (c) => streamSSE(c, async (stream) => {
  const send = (e: unknown) => void stream.writeSSE({ data: JSON.stringify(e) });
  bus.on('event', send);
  const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 20_000);
  await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
  clearInterval(ping);
  bus.off('event', send);
}));

app.get('/health', (c) => c.json({ ok: true, meta: !!config.meta.apiKey, whatsapp: !!config.wa.token && !!config.wa.phoneNumberId }));

app.use('/media/*', serveStatic({ root: path.relative(process.cwd(), config.dataDir) }));
app.use('/*', serveStatic({ root: 'public' }));

serve({ fetch: app.fetch, port: config.port }, () => console.log(`Mesa Muse on :${config.port} — control room ${config.publicUrl}`));
