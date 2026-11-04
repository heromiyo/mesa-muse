const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kwacha = (n) => `K${(n / 100).toFixed(n % 100 ? 2 : 0)}`;
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const wa = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
const phone = (p) => `+${String(p).replace(/^(\d{3})(\d{2})(\d{3})(\d+)$/, '$1 $2 $3 $4')}`;

const MODELS = {
  spark: { label: 'Muse Spark', icon: 'i-spark' },
  voice: { label: 'Muse Voice Transcribe', icon: 'i-mic' },
  sam: { label: 'SAM 3.1', icon: 'i-cut' },
};
const family = (model) => (model.startsWith('sam') ? 'sam' : model.includes('voice') ? 'voice' : 'spark');

let state = { shops: [], messages: [], traces: [], totals: [] };
let selected = null;
const seenTraces = new Set();
let firstLoad = true;

function meters() {
  const by = Object.fromEntries(Object.keys(MODELS).map((k) => [k, { n: 0, ms: 0 }]));
  for (const t of state.totals) { const f = by[family(t.model)]; f.n += t.n; f.ms = t.avg_ms; }
  const colors = { spark: '#5fd38d', voice: '#f2c14e', sam: '#e99a80' };
  $('#meters').innerHTML = Object.entries(MODELS).map(([k, m]) =>
    `<li><span class="dot" style="background:${colors[k]}"></span>${m.label} <b>${by[k].n}</b>${by[k].n ? `<span>· ${(by[k].ms / 1000).toFixed(1)}s avg</span>` : ''}</li>`).join('');
}

function roleOf(p) {
  if (state.shops.some((s) => s.owner_phone === p)) return 'owner';
  return 'customer';
}

function chats() {
  const phones = [...new Set(state.messages.map((m) => m.phone))].reverse();
  if (!selected || !phones.includes(selected)) selected = phones[0] ?? null;
  $('#tabs').innerHTML = phones.map((p) => {
    const shop = state.shops.find((s) => s.owner_phone === p);
    return `<button role="tab" aria-selected="${p === selected}" data-p="${p}">${esc(shop?.name || phone(p))}<span class="role">${roleOf(p)}</span></button>`;
  }).join('');
  const thread = state.messages.filter((m) => m.phone === selected);
  $('#thread').innerHTML = thread.length ? thread.map(bubble).join('') :
    `<li class="empty"><strong>No conversations yet</strong>Message the shop number on WhatsApp — a voice note, a photo or just “hi” — and it appears here live.</li>`;
  const el = $('#thread'); el.scrollTop = el.scrollHeight;
}

function bubble(m) {
  let body = wa(m.body);
  let chips = '';
  if (m.kind === 'buttons') {
    const lines = m.body.split('\n');
    const last = lines.pop();
    body = wa(lines.join('\n'));
    chips = `<div class="chips">${[...last.matchAll(/\[([^\]]+)\]/g)].map((x) => `<span>${esc(x[1])}</span>`).join('')}</div>`;
  }
  if (m.kind === 'voice') body = `<span class="kind"><svg class="ic"><use href="#i-mic"/></svg>Voice note</span>`;
  const img = m.media ? `<img src="${esc(m.media)}" alt="" loading="lazy">` : '';
  return `<li class="msg ${m.direction}">${img}${body}${chips}<time>${time(m.created_at)}</time></li>`;
}

function preview(t) {
  const d = t.detail || {};
  if (!t.ok) return `Failed: ${esc(d.error)}`;
  if (d.transcript !== undefined) return `<q>${esc(d.transcript)}</q>`;
  if (d.masks !== undefined) return `${d.masks} object${d.masks === 1 ? '' : 's'} cut out along their pixel masks`;
  if (d.tools?.length) return `Calls ${d.tools.map((x) => `<code>${esc(x.name)}</code>`).join(' ')}${d.reply ? ` · <q>${esc(d.reply)}</q>` : ''}`;
  if (d.reply) return `<q>${esc(d.reply)}</q>`;
  const o = d.output || {};
  if (o.products) return `Found: ${o.products.map((p) => `${esc(p.phrase)} ×${p.count}`).join(', ')}`;
  if (o.items) return `<ul>${o.items.map((i) => `<li>${esc(i.name)} — <b>K${esc(i.price_kwacha)}</b></li>`).join('')}</ul>`;
  if (o.ops) return `${o.ops.length ? o.ops.map((x) => `<code>${esc(x.op)} #${x.number}${x.value ? ` ${esc(x.value)}` : ''}</code>`).join(' ') : 'No changes'} · <q>${esc(o.reply)}</q>`;
  if (o.name !== undefined) return `<b>${esc(o.name)}</b> · ${esc(o.language)} · ${esc([o.location, o.hours, o.payments].filter(Boolean).join(' · '))}`;
  if (o.message) return `<q>${esc(o.message)}</q>`;
  return '';
}

function steps() {
  const list = state.traces.slice(-60).reverse();
  const max = Math.max(1000, ...list.map((t) => t.ms));
  $('#steps').innerHTML = list.length ? list.map((t) => {
    const f = family(t.model);
    const fresh = !firstLoad && !seenTraces.has(t.id);
    seenTraces.add(t.id);
    return `<li class="step${t.ok ? '' : ' err'}${fresh ? ' fresh' : ''}" data-m="${f}">
      <span class="badge"><svg class="ic"><use href="#${MODELS[f].icon}"/></svg></span>
      <div>
        <div class="top"><span class="model">${MODELS[f].label}</span><span class="task">${esc(t.task)}</span><span class="ms">${(t.ms / 1000).toFixed(1)}s</span></div>
        ${t.phone ? `<div class="who">${esc(phone(t.phone))} · ${time(t.created_at)}</div>` : ''}
        <div class="out">${preview(t)}</div>
        <div class="bar-ms"><i style="width:${Math.max(3, (t.ms / max) * 100)}%"></i></div>
      </div></li>`;
  }).join('') : `<li class="empty"><strong>Waiting for the first message</strong>Each Muse Spark, Muse Voice Transcribe and SAM 3.1 call shows up here with what it saw, what it returned and how long it took.</li>`;
  firstLoad = false;
}

function shops() {
  $('#shoplist').innerHTML = state.shops.length ? state.shops.map((s) => {
    const items = s.products.length ? s.products : s.draft;
    const isDraft = !s.products.length && s.draft.length;
    return `<article class="shop">
      <h3>${esc(s.name || 'New shop')} <span class="stage" data-s="${esc(s.stage)}">${stageLabel(s.stage)}</span></h3>
      ${s.about ? `<p class="about">${esc(s.about)}</p>` : ''}
      <div class="facts">${[s.location, s.hours, s.payments, s.delivery, s.language].filter(Boolean).map(esc).map((x) => `<span>${x}</span>`).join('')}</div>
      ${s.link ? `<div class="share"><img src="/media/qr-${esc(s.code)}.png" alt="QR code for ${esc(s.name)}" onerror="this.remove()"><a href="${esc(s.link)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-link"/></svg>wa.me shop link · #${esc(s.code)}</a></div>` : ''}
      ${items.length ? `<p class="label">${isDraft ? 'Draft catalog — owner reviewing' : `Catalog · ${items.length} products`}</p>
      <div class="grid">${items.map((p) => `<div class="item${isDraft ? ' draft' : ''}"><div class="pic">${p.image ? `<img src="/media/${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : ''}</div><span class="name">${esc(p.name)}</span><span class="price">${kwacha(p.price_ngwee)}</span></div>`).join('')}</div>` : ''}
      ${s.orders.length ? `<p class="label">Orders</p><ul class="orders">${s.orders.map((o) => `<li><span>#${o.id} · ${esc(o.customer_name || phone(o.customer_phone))}</span><span class="total">${kwacha(o.total_ngwee)}</span><span class="items">${JSON.parse(o.items).map((i) => `${i.qty} × ${esc(i.name)}`).join(', ')}</span><span class="st" data-s="${esc(o.status)}">${esc(o.status)}</span></li>`).join('')}</ul>` : ''}
    </article>`;
  }).join('') : `<p class="empty"><strong>No shops yet</strong>A trader taps “Open my shop” on WhatsApp, sends a voice note and a photo, and their shop builds itself here.</p>`;
}

const stageLabel = (s) => ({ profile: 'Listening', confirm_profile: 'Confirming', stock: 'Waiting for photo', review: 'Reviewing catalog', live: 'Open' })[s] ?? s;

function render() { meters(); chats(); steps(); shops(); }

async function load() {
  const res = await fetch('/api/state');
  state = await res.json();
  render();
}

let pending;
function refresh() { clearTimeout(pending); pending = setTimeout(load, 200); }

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  selected = b.dataset.p;
  chats();
});

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { $('#live').dataset.state = 'on'; $('#live').textContent = 'Live'; };
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'message' && ev.direction === 'in') selected = ev.phone;
    refresh();
  };
  es.onerror = () => { $('#live').dataset.state = 'off'; $('#live').textContent = 'Reconnecting'; };
}

load().catch(() => {});
connect();
