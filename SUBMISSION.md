# Submission draft — Meta Global AI Developer Hackathon

Paste-ready answers. Fill the bracketed items once the live demo and video exist.

**Project name:** Mesa Muse

**Track:** Startups (Zambrite Management Enterprise Limited, Lusaka, Zambia)

**Theme:** Build for Your World

**One-liner:** A shop on WhatsApp from one voice note and one photo, built for market traders in Zambia.

**GitHub (public):** https://github.com/heromiyo/mesa-muse

**Demo video (3 min):** [link]

**Live product:** [public URL of the control room] · WhatsApp: [test number]

## The problem

Most small traders in Zambia sell from a market stall, a table by the road or a corner shop, and run their business from WhatsApp. Customers message, the trader answers when they can, and sales are lost while they serve someone in person. Putting stock online means typing names and prices into an app, in English, on a small phone. Most traders never do it.

## What it does

1. **The owner talks.** They send a voice note in Bemba, Nyanja or English describing the shop. Muse Voice Transcribe hears it and Muse Spark turns it into a shop profile: name, what they sell, where, hours, how people pay, and delivery. The profile comes back as a WhatsApp message with one-tap confirm buttons.
2. **The owner sends one photo.** Muse Spark looks at the table or shelf and names each kind of product. SAM 3.1 cuts every one out along its pixel mask. Muse Spark then looks at the numbered cut-outs and writes a name, a one-line pitch and a kwacha price for each.
3. **The owner corrects by voice.** "Number 2 is K30, take out the soap." Muse Spark turns that into edit operations, and the catalogue is resent.
4. **One tap opens the shop.** The owner gets a QR code for the stall and a wa.me link to forward to customers.
5. **Customers shop in their own language.** They can type, send a voice note, or send a photo of what they want. A Muse Spark tool-calling assistant replies with product cut-out cards and "Add to order" buttons, builds the cart, reads the order back and places it.
6. **The owner stays in charge.** Every order reaches the owner on WhatsApp with Accept and Can't-do-it buttons, and the customer is told either way. When a customer asks something the shop facts don't cover, the owner gets an "Answer them" button and their voice note goes straight to that customer.

A live control room shows every WhatsApp message and every Meta model call (task, latency, output) as it happens.

## How we used Meta's models

| Model | Where |
|---|---|
| Muse Voice Transcribe (`/v1/asr/transcribe`) | Owner and customer voice notes (WhatsApp OGG/Opus → 24 kHz WAV), with keyword bias toward the shop's product names |
| Muse Spark 1.3, structured output | Voice → shop profile; photo → product phrases for SAM; cut-outs → catalogue with prices; spoken corrections → edit ops; order decision → customer message |
| Muse Spark 1.3, vision | Reads the shelf photo, the numbered cut-outs, and customers' "do you have this?" photos |
| Muse Spark 1.3, tool calling | Customer assistant: `show_products`, `set_cart`, `place_order`, `ask_owner` |
| SAM 3.1 (Responses API + `@meta-sam/parser`) | Pixel-mask cut-outs of each product from one photo. These become the product images customers see |

The pipeline is a model chain built for this one job: Muse Spark plans the noun phrases, SAM 3.1 segments them, and Muse Spark prices what SAM found. Neither model could build the catalogue alone.

All messaging uses the **WhatsApp Business Cloud API** only: interactive reply buttons, list messages, image headers, media upload and download, typing indicators, and HMAC-signed webhooks.

## What we built during the hackathon

Everything in the repository. It was written from scratch on Nov 4, 2026, and `git log` shows the timeline. It reuses no code from Zambrite's existing products. From our Mesa WhatsApp product we carried over two ideas: the menu-and-order shape of a WhatsApp shop, and the rule that the owner approves every order.

## Technical notes

- Node 24 (native TypeScript), Hono, `node:sqlite`, `sharp` for masks and cut-outs, ffmpeg for audio.
- Per-sender message queues: one customer's turn never blocks another's. WhatsApp webhook retries are de-duplicated by message id.
- 13 automated tests, including a full owner-and-customer journey through the real webhook against fake Graph and Meta API servers.
- `npm run doctor` smoke-tests each Meta model and the WhatsApp number with live keys.

## Challenges

- SAM returns masks in the pixel space of the image it was sent, so we send it exactly the downscaled image we later crop from.
- WhatsApp voice notes are Opus in OGG; Muse Voice Transcribe wants mono 16-bit WAV, so we transcode on the fly.
- WhatsApp interactive messages cap button titles at 20 characters and lists at 10 rows, which shaped how we present catalogues.

## What's next

Paid ordering through mobile money (MTN MoMo and Airtel Money), plus re-stock reminders. Then rollout to Mesa's existing WhatsApp business customers in Zambia.

## Team

Francis Miyoba, founder, Zambrite Management Enterprise Limited.
