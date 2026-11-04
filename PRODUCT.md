# Product
<!-- impeccable:product-schema 1 -->

> Written from the owner's brief on 2026-11-04 without an interview (hackathon deadline the same night). Items marked *(inferred)* were not confirmed.

## Platform
web (control room) + WhatsApp (the product people actually use)

## Stack
delegated: Node 24 with TypeScript type-stripping, Hono, node:sqlite; static HTML/CSS/vanilla JS for the control room. Chosen for zero build step under deadline.

## Users
- Small traders in Zambia — market stalls, tuntemba, salaula sellers, corner shops — who run their business from a phone and WhatsApp. *(inferred from Zambrite's Mesa customers)*
- Their customers, who would rather send a voice note or a photo than type.
- Hackathon judges watching the control room in a 3-minute demo video.

## Product Purpose
Open a working WhatsApp shop from one voice note and one photo, then let an assistant sell for the owner in the customer's own language and hand every order back to the owner on WhatsApp.

## Positioning
Every step runs on Meta's own stack end to end: Muse Voice Transcribe hears the owner, Muse Spark understands and prices, SAM 3.1 cuts each product out of a shelf photo, and the WhatsApp Business Cloud API carries every message.

## Operating Context
- Owners talk in Bemba, Nyanja, English or a mix, often by voice note.
- Prices are in kwacha (K). Payment is cash, MTN MoMo or Airtel Money.
- The control room is a projector/laptop view for demos and for the operator; nobody types into it.

## Capabilities and Constraints
- WhatsApp Cloud API only (no unofficial clients). Test number limits recipients to verified numbers.
- Model calls: muse-spark-1.3, muse-voice-transcribe-1.0, sam-3.1 via https://api.meta.ai/v1.
- No payments are taken in-app; the owner confirms each order.

## Brand Commitments
- Name: Mesa Muse (a Mesa by Zambrite product).
- Colours given by the owner: deep green #1f3a2e and cream #f6f1e7. Warm, market-stall feel.

## Evidence on Hand
No customer testimonials, metrics or adoption numbers for Mesa Muse exist yet. Do not invent any.

## Product Principles
1. The phone is the product; the web page only shows what happened.
2. Speak the owner's language — literally.
3. Never invent stock, prices or promises; the owner stays in charge of every order.
4. Show the model work honestly: every call, its latency, and failures.
