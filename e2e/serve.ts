/**
 * Starts Mesa Muse on a throwaway database filled with a sample shop, for the
 * control-room browser tests. Nothing here touches real data or real APIs.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(path.join(tmpdir(), 'muse-e2e-'));
Object.assign(process.env, { DATA_DIR: dir, DB_PATH: path.join(dir, 'e2e.db'), PORT: process.env.PORT ?? '8797', PUBLIC_URL: `http://127.0.0.1:${process.env.PORT ?? '8797'}` });

const { db } = await import('../src/db.ts');
const { mediaDir } = await import('../src/config.ts');
const now = Date.now();
for (const [file, color] of [['e2e-a.png', '#c0392b'], ['e2e-b.png', '#f1c40f']]) {
  await sharp(Buffer.from(`<svg width="220" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="60" y="20" width="100" height="260" rx="30" fill="${color}"/></svg>`)).png().toFile(path.join(mediaDir, file));
}
db.prepare("INSERT INTO shops (code, owner_phone, name, about, location, hours, payments, delivery, language, stage, created_at) VALUES ('TEST', '260970000001', 'Sample Stall', 'drinks and cooking oil', 'Soweto market', '06:00-19:00', 'Cash, MTN', 'Matero', 'Bemba', 'live', ?)").run(now);
const product = db.prepare('INSERT INTO products (shop_id, name, description, price_ngwee, image, created_at) VALUES (1, ?, ?, ?, ?, ?)');
product.run('Orange drink 2L', 'Family size', 4500, 'e2e-a.png', now);
product.run('Cooking oil 2.5L', 'Sunflower', 9000, 'e2e-b.png', now);
const msg = db.prepare('INSERT INTO messages (phone, direction, kind, body, created_at) VALUES (?, ?, ?, ?, ?)');
msg.run('260970000001', 'in', 'voice', 'voice note', now);
msg.run('260970000001', 'out', 'buttons', '*Sample Stall*\nSoweto market\n[✅ That is right] [🎙️ Say it again]', now + 1);
msg.run('260970000002', 'in', 'text', 'Hi Sample Stall! #TEST', now + 2);
msg.run('260970000002', 'out', 'text', 'Welcome to *Sample Stall*!', now + 3);
const trace = db.prepare('INSERT INTO traces (phone, model, task, ms, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
trace.run('260970000001', 'muse-voice-transcribe-1.0', 'voice note → text', 1800, 1, JSON.stringify({ transcript: 'my stall sells drinks and oil' }), now);
trace.run('260970000001', 'sam-3.1', 'segment “orange drink bottle”', 2600, 1, JSON.stringify({ outcome: 'completed', masks: 2 }), now + 1);
trace.run('260970000002', 'muse-spark-1.3', 'customer chat', 1500, 0, JSON.stringify({ error: 'sample failure' }), now + 2);
db.prepare("INSERT INTO orders (shop_id, customer_phone, customer_name, items, total_ngwee, fulfilment, status, created_at) VALUES (1, '260970000002', 'Test Buyer', ?, 9000, 'Pickup 5pm', 'new', ?)").run(JSON.stringify([{ name: 'Orange drink 2L', qty: 2, price_ngwee: 4500 }]), now);

await import('../src/server.ts');
