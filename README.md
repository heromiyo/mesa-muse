# Mesa Muse

**A shop on WhatsApp from one voice note and one photo.**

A market trader in Lusaka messages Mesa Muse on WhatsApp. They describe their shop in a voice note, in Bemba, Nyanja or English, and send one photo of their table or shelf. A few seconds later they have a priced catalogue with every product cut out of the photo, a shop link and a QR code for their stall. From then on an assistant answers customers in their own language, shows them product photos, takes orders and sends each order back to the owner on WhatsApp for one-tap approval.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), track: Startups, theme: *Build for Your World*.

## Meta models used

| Step | Model | What it does |
|---|---|---|
| Owner's voice note → words | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, `/v1/asr/transcribe`) | Transcribes WhatsApp voice notes (OGG/Opus → 24 kHz WAV), biased toward the shop's product names |
| Words → shop profile | **Muse Spark** (`muse-spark-1.3`, structured output) | Name, what they sell, location, hours, payment, delivery and the language they spoke |
| Shelf photo → product list | **Muse Spark** vision | Names each distinct product as a short noun phrase a segmentation model can find |
| Product list → cut-outs | **SAM 3.1** (`sam-3.1`, Responses API + `@meta-sam/parser`) | Pixel masks for every instance of each phrase; we cut each product out as a transparent PNG |
| Cut-outs → catalogue | **Muse Spark** vision | Reads the numbered cut-outs and writes a name, a one-line pitch and a kwacha price |
| "Number 2 is K30, remove 4" | **Muse Spark** structured output | Turns the owner's spoken or typed corrections into edit operations |
| Customer chat | **Muse Spark** tool calling | Understands text, voice notes and photos ("do you have this?"), calls `show_products`, `set_cart`, `place_order`, `ask_owner` |

All messaging uses the **WhatsApp Business Cloud API** (official API only): reply buttons, list messages, image upload, typing indicators and signed webhooks.

## How it fits together

```
WhatsApp ──webhook──▶ src/server.ts ──▶ src/brain/router.ts
                                        ├─ owner.ts    voice → profile → photo → catalogue → publish → orders
                                        └─ customer.ts Muse Spark tool loop over the catalogue
            src/meta/{muse,voice,sam}.ts   Meta Model API clients (every call traced)
            src/whatsapp/cloud.ts          Cloud API: send, upload, download, signature check
            public/                        Control room: live chats, model calls, shops
```

## Run it

Needs Node 24 and ffmpeg (or use the Dockerfile).

```bash
cp .env.example .env   # MODEL_API_KEY + WhatsApp Cloud API values
npm install
npm run doctor         # live check: Muse Spark, Muse Voice Transcribe, SAM 3.1, WhatsApp number
npm start              # control room on http://localhost:8787
npm run tunnel         # public https URL → put it in .env as PUBLIC_URL, restart
npm run webhook        # registers PUBLIC_URL/webhook with Meta and subscribes the WABA
npm test               # 17 tests, including a full owner + customer journey against fake Graph/Meta APIs
```

## What was built during the hackathon

This whole repository was written during the hackathon, starting on Nov 4, 2026. See `git log` for the timeline. It reuses no code from Zambrite's other products. Ideas carried over from our Mesa WhatsApp product are the menu-and-order shape of a WhatsApp shop and the owner-approves-every-order rule.

Third-party code: Meta's `@meta-sam/parser` and the stream-normalisation pattern from Meta's `meta-model-cookbook` SAM recipe (credited in `src/meta/sam.ts`).

## License

MIT
