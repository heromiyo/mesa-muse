# 3-minute demo video — shot list

Rule from the organisers: show only what was built during the hackathon. Everything below is Mesa Muse.

Record the screen at 1600×900. Show two phones (WhatsApp Web windows, or phone screen mirrors) on the left and the control room on the right. Use real numbers that are verified on the test WhatsApp number.

| Time | Screen | Say (voice-over) |
|---|---|---|
| 0:00–0:15 | A market stall photo, then the control room, empty | "In Zambia, most small shops sell on WhatsApp but never get their stock online. Mesa Muse opens a WhatsApp shop from one voice note and one photo, all on Meta's models." |
| 0:15–0:45 | Owner phone: "hi" → *Open my shop* → a voice note in Bemba/Nyanja. Control room: **Muse Voice Transcribe** step shows the words, then the **Muse Spark** profile step | "Bupe talks, in her own language. Muse Voice Transcribe hears her and Muse Spark builds the shop profile. She confirms with one tap." |
| 0:45–1:25 | Owner sends a shelf photo. Control room: Muse Spark lists the products → **SAM 3.1** segment steps → Muse Spark prices. Owner phone: numbered contact sheet with prices | "One photo. Muse Spark names what's on the table, SAM 3.1 cuts out every product along its pixel mask, and Muse Spark prices each cut-out in kwacha." |
| 1:25–1:45 | Owner voice note: "number 2 is K90". The catalogue comes back corrected. Tap *Open my shop*, and the QR and link arrive | "She fixes prices by voice. One tap and the shop is open, with a QR code for her stall." |
| 1:45–2:30 | Customer phone opens the link. Product cards with cut-outs arrive. Customer sends a photo of a bottle and gets the matching product. Taps *Add to order*, says name and pickup time. Control room: Muse Spark tool calls `show_products` → `place_order` | "Customers shop in their language: text, voice or a photo of what they want. Muse Spark finds the product, shows it and takes the order." |
| 2:30–2:45 | Owner phone: order card with Accept. Tap it, and the customer gets the confirmation | "The owner approves every order with one tap." |
| 2:45–3:00 | Control room, full view: model counters, every step | "Every step runs on Meta's models and the official WhatsApp Cloud API. Mesa Muse, by Zambrite: built for our world." |

Before recording: run `npm run doctor` (all ✔), clear `data/`, and pre-verify both phones as test recipients.
