import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.DATA_DIR = `${process.env.TMPDIR ?? '/tmp'}/mesa-muse-test`;
process.env.WA_APP_SECRET = 'shh';

const { parseWebhook } = await import('../src/whatsapp/inbound.ts');
const { applyEdits } = await import('../src/brain/catalog.ts');
const { validSignature } = await import('../src/whatsapp/cloud.ts');
const { shopCodeIn } = await import('../src/brain/router.ts');
const { createShop, shopByCode, kwacha } = await import('../src/db.ts');

const hook = (messages: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '260970000001', profile: { name: 'Bupe' } }], messages } }] }],
});

test('parses text, voice, image, button and list replies', () => {
  const out = parseWebhook(hook([
    { id: 'a', from: '260970000001', type: 'text', text: { body: 'Hi #ABCD' } },
    { id: 'b', from: '260970000001', type: 'audio', audio: { id: 'm1', mime_type: 'audio/ogg; codecs=opus', voice: true } },
    { id: 'c', from: '260970000001', type: 'image', image: { id: 'm2', caption: 'this one?' } },
    { id: 'd', from: '260970000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'add:3', title: 'Add' } } },
    { id: 'e', from: '260970000001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'shop:1', title: 'Bupe' } } },
    { id: 'f', from: '260970000001', type: 'sticker', sticker: {} },
  ]));
  assert.deepEqual(out.map((m) => [m.kind, m.replyId ?? m.mediaId ?? m.text]), [
    ['text', 'Hi #ABCD'], ['voice', 'm1'], ['image', 'm2'], ['reply', 'add:3'], ['reply', 'shop:1'], ['other', ''],
  ]);
  assert.equal(out[0]!.name, 'Bupe');
});

test('ignores status-only webhooks', () => {
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] }), []);
  assert.deepEqual(parseWebhook(null), []);
});

test('edits use the numbers the owner saw, removals applied last', () => {
  const items = [
    { name: 'Mazoe 2L', description: '', price_ngwee: 4000 },
    { name: 'Sugar 2kg', description: '', price_ngwee: 5500 },
    { name: 'Soap', description: '', price_ngwee: 1500 },
  ];
  const out = applyEdits(items, [
    { op: 'remove', number: 1, value: '' },
    { op: 'set_price', number: 2, value: 'K60' },
    { op: 'rename', number: 3, value: 'Boom bar soap' },
    { op: 'set_price', number: 9, value: '10' },
  ]);
  assert.deepEqual(out.map((i) => [i.name, i.price_ngwee]), [['Sugar 2kg', 6000], ['Boom bar soap', 1500]]);
  assert.equal(items[1]!.price_ngwee, 5500, 'input is not mutated');
});

test('webhook signature must match the app secret', () => {
  const body = '{"a":1}';
  const sig = 'sha256=' + createHmac('sha256', 'shh').update(body).digest('hex');
  assert.equal(validSignature(body, sig), true);
  assert.equal(validSignature(body + ' ', sig), false);
  assert.equal(validSignature(body, undefined), false);
});

test('shop codes are found in a wa.me first message and resolve case-insensitively', () => {
  const shop = createShop('260970000002');
  assert.equal(shopCodeIn(`Hi Bupe's shop! #${shop.code}`), shop.code);
  assert.equal(shopCodeIn('hello there'), undefined);
  assert.equal(shopByCode(shop.code.toLowerCase())?.id, shop.id);
});

test('kwacha formatting', () => {
  assert.equal(kwacha(4500), 'K45');
  assert.equal(kwacha(4550), 'K45.50');
});
