/** The parts of a WhatsApp Cloud API webhook we act on, flattened to one shape. */
export type Inbound = {
  id: string;
  from: string;
  name: string;
  kind: 'text' | 'voice' | 'image' | 'reply' | 'other';
  text: string;          // typed text, image caption, or the tapped button/row title
  replyId?: string;      // id of the tapped button or list row
  mediaId?: string;
  mime?: string;
};

type WaMessage = {
  id: string; from: string; type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string } };
  button?: { payload: string; text: string };
};

type WaWebhook = {
  entry?: { changes?: { field?: string; value?: { contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[] } }[] }[];
};

export function parseWebhook(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of (body as WaWebhook)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? '']));
      for (const m of value.messages) {
        const base = { id: m.id, from: m.from, name: names.get(m.from) ?? '' };
        if (m.type === 'text' && m.text) out.push({ ...base, kind: 'text', text: m.text.body });
        else if (m.type === 'image' && m.image) out.push({ ...base, kind: 'image', text: m.image.caption ?? '', mediaId: m.image.id, mime: m.image.mime_type });
        else if (m.type === 'audio' && m.audio) out.push({ ...base, kind: 'voice', text: '', mediaId: m.audio.id, mime: m.audio.mime_type });
        else if (m.type === 'interactive' && m.interactive) {
          const r = m.interactive.button_reply ?? m.interactive.list_reply;
          if (r) out.push({ ...base, kind: 'reply', text: r.title, replyId: r.id });
        } else if (m.type === 'button' && m.button) out.push({ ...base, kind: 'reply', text: m.button.text, replyId: m.button.payload });
        else out.push({ ...base, kind: 'other', text: '' });
      }
    }
  }
  return out;
}
