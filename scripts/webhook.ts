/**
 * npm run webhook — point the WhatsApp webhook at PUBLIC_URL/webhook and subscribe
 * the WhatsApp Business Account to this app. Needs WA_APP_ID, WA_APP_SECRET,
 * WA_WABA_ID, WA_TOKEN, WA_VERIFY_TOKEN and a server already answering at PUBLIC_URL.
 */
import { config } from '../src/config.ts';

const appId = process.env.WA_APP_ID, waba = process.env.WA_WABA_ID;
const missing = Object.entries({ WA_APP_ID: appId, WA_APP_SECRET: config.wa.appSecret, WA_WABA_ID: waba, WA_TOKEN: config.wa.token, WA_VERIFY_TOKEN: config.wa.verifyToken })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Set ${missing.join(', ')} in .env first.`); process.exit(1); }
if (!config.publicUrl.startsWith('https://')) { console.error('PUBLIC_URL must be the public https URL (run npm run tunnel).'); process.exit(1); }

async function post(path: string, params: Record<string, string>, token: string) {
  const res = await fetch(`${config.wa.graph}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams(params) });
  const body = await res.json() as { error?: { message: string } };
  if (!res.ok) throw new Error(`${path}: ${body.error?.message ?? res.status}`);
  return body;
}

const callback = `${config.publicUrl}/webhook`;
await post(`${appId}/subscriptions`, { object: 'whatsapp_business_account', callback_url: callback, verify_token: config.wa.verifyToken, fields: 'messages' }, `${appId}|${config.wa.appSecret}`);
console.log(`✔ webhook → ${callback} (field: messages)`);
await post(`${waba}/subscribed_apps`, {}, config.wa.token);
console.log(`✔ WABA ${waba} subscribed to app ${appId}`);
