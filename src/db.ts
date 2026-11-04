import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.ts';

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(config.dataDir, 'muse.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  owner_phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  payments TEXT NOT NULL DEFAULT '',
  delivery TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'English',
  stage TEXT NOT NULL DEFAULT 'profile',
  draft TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_ngwee INTEGER NOT NULL,
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'unknown',
  shop_id INTEGER,
  history TEXT NOT NULL DEFAULT '[]',
  cart TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,
  total_ngwee INTEGER NOT NULL,
  fulfilment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  wa_id TEXT UNIQUE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS traces (
  id INTEGER PRIMARY KEY,
  phone TEXT,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
`);

export type Shop = {
  id: number; code: string; owner_phone: string; name: string; about: string; location: string;
  hours: string; payments: string; delivery: string; language: string; stage: string; draft: string | null;
};
export type Product = { id: number; shop_id: number; name: string; description: string; price_ngwee: number; image: string | null; available: number };
export type Person = { phone: string; name: string; role: string; shop_id: number | null; history: string; cart: string };
export type Order = { id: number; shop_id: number; customer_phone: string; customer_name: string; items: string; total_ngwee: number; fulfilment: string; status: string; created_at: number };

export const kwacha = (ngwee: number) => `K${(ngwee / 100).toFixed(ngwee % 100 ? 2 : 0)}`;

export function person(phone: string): Person {
  db.prepare('INSERT OR IGNORE INTO people (phone, updated_at) VALUES (?, ?)').run(phone, Date.now());
  return db.prepare('SELECT * FROM people WHERE phone = ?').get(phone) as Person;
}

export function updatePerson(phone: string, patch: Partial<Omit<Person, 'phone'>>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE people SET ${sets}, updated_at = ? WHERE phone = ?`).run(
    ...keys.map((k) => (patch as Record<string, string | number | null>)[k]), Date.now(), phone);
}

export const shopById = (id: number) => db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as Shop | undefined;
export const shopByOwner = (phone: string) => db.prepare('SELECT * FROM shops WHERE owner_phone = ?').get(phone) as Shop | undefined;
export const shopByCode = (code: string) => db.prepare('SELECT * FROM shops WHERE code = ? COLLATE NOCASE').get(code) as Shop | undefined;
export const productsOf = (shopId: number) =>
  db.prepare('SELECT * FROM products WHERE shop_id = ? AND available = 1 ORDER BY id').all(shopId) as Product[];

export function createShop(ownerPhone: string): Shop {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (shopByCode(code));
  db.prepare('INSERT INTO shops (code, owner_phone, created_at) VALUES (?, ?, ?)').run(code, ownerPhone, Date.now());
  return shopByOwner(ownerPhone)!;
}

export function updateShop(id: number, patch: Partial<Omit<Shop, 'id' | 'code' | 'owner_phone'>>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE shops SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (patch as Record<string, string | null>)[k]), id);
}
