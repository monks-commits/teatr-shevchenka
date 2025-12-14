// admin/admin.js

let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};
let CURRENT_SUBJECT = '';

const LS_KEY_STATE = 'shev_admin_state_v1';

let hallSchema = null;
const seatState = new Map(); // key -> 'free'|'sold'|'reserved'
const seatMeta  = new Map(); // key -> {status, subject, ts, price, zone, row, seat}
let basket = [];

async function loadSettings() {
  if (SETTINGS) return SETTINGS;

  try {
    const res = await fetch('../data/settings.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    SETTINGS = await res.json();

    if (SETTINGS.theatre && SETTINGS.theatre.currency) CURRENCY = SETTINGS.theatre.currency;
    if (SETTINGS.pricing_defaults) PRICING_DEFAULTS = SETTINGS.pricing_defaults;
  } catch (e) {
    console.warn('Не вдалося завантажити settings.json.', e);
    SETTINGS = {};
  }
  return SETTINGS;
}

async function loadHallSchema() {
  if (hallSchema) return hallSchema;
  const res = await fetch('../data/halls/shevchenko-big.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot load hall schema: ' + res.status);
  hallSchema = await res.json();
  return hallSchema;
}

function saveStateToLS() {
  try {
    const obj = {
      currency: CURRENCY,
      currentSubject: CURRENT_SUBJECT,
      seatMeta: Array.from(seatMeta.entries()),
    };
    localStorage.setItem(LS_KEY_STATE, JSON.stringify(obj));
  } catch (e) {
    console.warn('saveStateToLS failed', e);
  }
}

function loadStateFromLS() {
  try {
    const raw = localStorage.getItem(LS_KEY_STATE);
    if (!raw) return;

    const obj = JSON.parse(raw);
    if (obj.currentSubject) CURRENT_SUBJECT = obj.currentSubject;

    if (Array.isArray(obj.seatMeta)) {
      seatMeta.clear();
      for (const [k, v] of obj.seatMeta) seatMeta.set(k, v);

      seatState.clear();
      for (const [k, v] of seatMeta.entries()) seatState.set(k, v?.status || 'free');
    }
  } catch (e) {
    console.warn('loadStateFromLS failed', e);
  }
}

function seatKey(row, seat) { return `${row}-${seat}`; }

function getPriceForRow(rowInfo) {
  const group = rowInfo.price_group;
  if (group && PRICING_DEFAULTS[group] != null) return PRICING_DEFAULTS[group];
  return 0;
}

function getZoneLabel(zone) {
  switch (zone) {
    case 'parter': return 'Партер';
    case 'amphi': return 'Амфітеатр';
    case 'balcony': return 'Балкон';
    default: return zone || '';
  }
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function openPrintQueue(items, ctx = {}) {
  const base = "/teatr-shevchenka/tickets/print-queue.html";

  const theatreName = SETTINGS?.theatre?.name || "Театр ім. Т. Г. Шевченка";
  const theatreTagline = SETTINGS?.theatre?.tagline || "Офіційний онлайн-продаж квитків";

  const payload = {
    theatre: { name: theatreName, tagline: theatreTagline },
    show: {
      title: ctx.title || "НАЗВА ВИСТАВИ",
      subtitle: ctx.subtitle || "Велика сцена",
      date: ctx.date || new Date().toLocaleString("uk-UA")
    },
    channel: ctx.channel || "Каса",
    currency: CURRENCY || "грн",
    orderPrefix: ctx.orderPrefix || "ORD",
    items: items.map(it => ({
      row: it.row,
      seat: it.seat,
      zone: getZoneLabel(it.zone),
      price: Number(it.price || 0),
    }))
  };

  const encoded = b64EncodeUnicode(JSON.stringify(payload));
  const url = base + "?data=" + encodeURIComponent(encoded);
  window.open(url, "_blank");
}

function createSeatElement(rowInfo, rowNumber, seatNumber, zone, pos) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'seat';
  btn.textContent = seatNumber;

  const price = getPriceForRow(rowInfo);

  btn.dataset.row = String(rowNumber);
  btn.dataset.seat = String(seatNumber);
  btn.dataset.zone = zone;
  btn.dataset.price = String(price);

  if (zone === 'parter') {
    if (rowNumber <= 6) btn.classList.add('seat--parter-front');
    else if (rowNumber <= 12) btn.classList.add('seat--parter-mid');
    else btn.classList.add('seat--parter-back');
  } else if (zone === 'amphi') {
    btn.classList.add('seat--amphi');
  } else if (zone === 'balcony') {
    btn.classList.add('seat--balcony');
  }

  if (rowInfo.zone === 'parter' && rowInfo.aisle_after && pos === rowInfo.aisle_after) {
    btn.classList.add('seat--gap-right');
  }

  const key = seatKey(rowNumber, seatNumber);
  const status = seatState.get(key) || 'free';
  if (status === 'sold') btn.classList.add('seat--sold');
  if (status === 'reserved') btn.classList.add('seat--reserved');

  btn.addEventListener('click', () => {
    const row = Number(btn.dataset.row);
    const seat = Number(btn.dataset.seat);
    const k = seatKey(row, seat);

    const st = seatState.get(k) || 'free';
    if (st === 'sold') return;

    const inBasketIndex = basket.findIndex(i => i.key === k);
    if (inBasketIndex >= 0) {
      basket.splice(inBasketIndex, 1);
      btn.classList.remove('seat--selected');
    } else {
      const label = `${row} ряд, місце ${seat} (${getZoneLabel(zone)})`;
      basket.push({
        key: k,
        row,
        seat,
        zone,
        price: Number(btn.dataset.price || 0),
        label
      });
      btn.classList.add('seat--selected');
    }
    updateBasketUI();
  });

  return btn;
}

function renderParter(container, rows) {
  const section = document.createElement('section');
  section.className = 'hall-section';
  section.appendChild(Object.assign(document.createElement('div'), { className:'hall-section-title', textContent:'Партер' }));

  const wrap = document.createElement('div');
  wrap.className = 'parter-wrap';

  const lodgeB = document.createElement('div');
  lodgeB.className = 'hall-lodge';
  lodgeB.appendChild(Object.assign(document.createElement('div'), { className:'hall-lodge-label', textContent:'Ложа Б' }));
  const lodgeBSeats = document.createElement('div');
  lodgeBSeats.className = 'hall-lodge-seats';
  for (let i = 1; i <= 18; i++) {
    const b = document.createElement('div');
    b.className = 'seat seat--lodge';
    b.textContent = i;
    lodgeBSeats.appendChild(b);
  }
  lodgeB.appendChild(lodgeBSeats);

  const center = document.createElement('div');
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';
    for (let i = 1; i <= (r.seats || 0); i++) sr.appendChild(createSeatElement(r, r.row, i, 'parter', i));

    line.appendChild(sr);
    center.appendChild(line);
  }

  const lodgeA = document.createElement('div');
  lodgeA.className = 'hall-lodge';
  lodgeA.appendChild(Object.assign(document.createElement('div'), { className:'hall-lodge-label', textContent:'Ложа А' }));
  const lodgeASeats = document.createElement('div');
  lodgeASeats.className = 'hall-lodge-seats';
  for (let i = 1; i <= 18; i++) {
    const b = document.createElement('div');
    b.className = 'seat seat--lodge';
    b.textContent = i;
    lodgeASeats.appendChild(b);
  }
  lodgeA.appendChild(lodgeASeats);

  wrap.appendChild(lodgeB);
  wrap.appendChild(center);
  wrap.appendChild(lodgeA);

  section.appendChild(wrap);
  container.appendChild(section);
}

function renderAmphi(container, rows) {
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';

    const leftCount = r.seats_left || 0;
    for (let i = 1; i <= leftCount; i++) sr.appendChild(createSeatElement(r, r.row, i, 'amphi', i));

    const gap = document.createElement('div');
    gap.className = 'amphi-gap';
    sr.appendChild(gap);

    const rightCount = r.seats_right || 0;
    for (let i = 1; i <= rightCount; i++) {
      const seatNumber = leftCount + i;
      sr.appendChild(createSeatElement(r, r.row, seatNumber, 'amphi', seatNumber));
    }

    line.appendChild(sr);
    container.appendChild(line);
  }
}

function renderBalcony(container, rows) {
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';

    if (r.seats_left != null && r.seats_right != null) {
      for (let i = 1; i <= r.seats_left; i++) sr.appendChild(createSeatElement(r, r.row, i, 'balcony', i));

      const gap = document.createElement('div');
      gap.className = 'amphi-gap';
      sr.appendChild(gap);

      for (let i = 1; i <= r.seats_right; i++) {
        const seatNumber = r.seats_left + i;
        sr.appendChild(createSeatElement(r, r.row, seatNumber, 'balcony', seatNumber));
      }
    } else {
      for (let i = 1; i <= (r.seats || 0); i++) {
        const seatEl = createSeatElement(r, r.row, i, 'balcony', i);
        if (r.aisle_after && i === r.aisle_after) seatEl.classList.add('seat--gap-right');
        sr.appendChild(seatEl);
      }
    }

    line.appendChild(sr);
    container.appendChild(line);
  }
}

function renderHall(schema) {
  const root = document.getElementById('hall-root');
  if (!root) return;
  root.innerHTML = '';

  const rowsParter  = schema.rows.filter(r => r.zone === 'parter');
  const rowsAmphi   = schema.rows.filter(r => r.zone === 'amphi');
  const rowsBalcony = schema.rows.filter(r => r.zone === 'balcony');

  renderParter(root, rowsParter);

  const amphiSection = document.createElement('section');
  amphiSection.className = 'hall-section';
  amphiSection.appendChild(Object.assign(document.createElement('div'), { className:'hall-section-title', textContent:'Амфітеатр' }));
  const amphiWrap = document.createElement('div');
  renderAmphi(amphiWrap, rowsAmphi);
  amphiSection.appendChild(amphiWrap);
  root.appendChild(amphiSection);

  const balconySection = document.createElement('section');
  balconySection.className = 'hall-section';
  balconySection.appendChild(Object.assign(document.createElement('div'), { className:'hall-section-title', textContent:'Балкон' }));
  const balconyWrap = document.createElement('div');
  renderBalcony(balconyWrap, rowsBalcony);
  balconySection.appendChild(balconyWrap);
  root.appendChild(balconySection);
}

function updateBasketUI() {
  const listEl = document.getElementById('basket-list');
  const totalEl = document.getElementById('basket-total');
  const curEl = document.getElementById('basket-currency');

  if (!listEl || !totalEl) return;

  if (basket.length === 0) {
    listEl.innerHTML = '<div class="basket-empty">Поки що нічого не обрано.</div>';
  } else {
    const ul = document.createElement('ul');
    ul.style.paddingLeft = '18px';
    ul.style.margin = '4px 0';

    for (const item of basket) {
      const li = document.createElement('li');
      li.textContent = `${item.label} — ${item.price} ${CURRENCY}`;
      ul.appendChild(li);
    }
    listEl.innerHTML = '';
    listEl.appendChild(ul);
  }

  totalEl.textContent = String(basket.reduce((sum, i) => sum + (i.price || 0), 0));
  if (curEl) curEl.textContent = CURRENCY;
}

function findSeatButton(row, seat) {
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    if (Number(b.dataset.row) === row && Number(b.dataset.seat) === seat) return b;
  }
  return null;
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;');}

function buildReserveRegistry() {
  const groups = new Map();
  for (const [key, meta] of seatMeta.entries()) {
    if (!meta || meta.status !== 'reserved') continue;
    const subject = meta.subject || 'Без суб’єкта';
    if (!groups.has(subject)) groups.set(subject, { subject, seats: [], total: 0, count: 0 });
    const g = groups.get(subject);
    g.seats.push(meta);
    g.count += 1;
    g.total += Number(meta.price || 0);
  }
  return Array.from(groups.values()).sort((a,b) => b.count - a.count);
}

function formatSeatsShort(seats) {
  const parts = seats.slice(0, 6).map(s => `${getZoneLabel(s.zone)} ${s.row}-${s.seat}`);
  const more = seats.length > 6 ? ` +${seats.length - 6}` : '';
  return parts.join(', ') + more;
}

function renderReserveRegistryUI() {
  const root = document.getElementById('reserve-registry');
  if (!root) return;

  const groups = buildReserveRegistry();
  if (!groups.length) {
    root.innerHTML = `<div style="color:#6b7280;">Поки що немає броней.</div>`;
    return;
  }

  root.innerHTML = '';
  for (const g of groups) {
    const card = document.createElement('div');
    card.style.border = '1px solid #e5e7eb';
    card.style.borderRadius = '14px';
    card.style.padding = '10px 12px';
    card.style.background = '#fff';

    card.innerHTML = `
      <div style="min-width:0;">
        <div style="font-weight:900; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${escapeHtml(g.subject)}
        </div>
        <div style="font-size:12px; color:#6b7280; margin-top:2px;">
          Квитків: <b>${g.count}</b> • Сума: <b>${g.total} ${CURRENCY}</b>
        </div>
        <div style="font-size:12px; color:#374151; margin-top:6px;">
          ${escapeHtml(formatSeatsShort(g.seats))}
        </div>

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button type="button" class="btn-reg-sell"
                  data-subject="${escapeAttr(g.subject)}"
                  style="flex:1; padding:10px 12px; border-radius:12px; border:0; background:#16a34a; color:#fff; font-weight:900;">
            Продати + друк
          </button>
          <button type="button" class="btn-reg-unreserve"
                  data-subject="${escapeAttr(g.subject)}"
                  style="flex:1; padding:10px 12px; border-radius:12px; border:1px solid #e5e7eb; background:#fff; font-weight:900;">
            Зняти бронь
          </button>
        </div>
      </div>
    `;
    root.appendChild(card);
  }

  root.querySelectorAll('.btn-reg-sell').forEach(btn => {
    btn.addEventListener('click', () => sellReservationBySubject(btn.dataset.subject || ''));
  });
  root.querySelectorAll('.btn-reg-unreserve').forEach(btn => {
    btn.addEventListener('click', () => unreserveBySubject(btn.dataset.subject || ''));
  });
}

function sellReservationBySubject(subject) {
  const itemsToPrint = [];

  for (const [key, meta] of seatMeta.entries()) {
    if (!meta || meta.status !== 'reserved') continue;
    if ((meta.subject || 'Без суб’єкта') !== subject) continue;

    meta.status = 'sold';
    meta.ts = Date.now();
    seatMeta.set(key, meta);
    seatState.set(key, 'sold');

    const btn = findSeatButton(meta.row, meta.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--reserved');
      btn.classList.add('seat--sold');
    }

    itemsToPrint.push({
      key,
      row: meta.row,
      seat: meta.seat,
      zone: meta.zone,
      price: meta.price || 0,
      label: `${meta.row} ряд, місце ${meta.seat} (${getZoneLabel(meta.zone)})`,
    });
  }

  saveStateToLS();
  renderReserveRegistryUI();

  if (itemsToPrint.length) openPrintQueue(itemsToPrint, { channel: "Каса" });
}

function unreserveBySubject(subject) {
  for (const [key, meta] of seatMeta.entries()) {
    if (!meta || meta.status !== 'reserved') continue;
    if ((meta.subject || 'Без суб’єкта') !== subject) continue;

    meta.status = 'free';
    seatMeta.set(key, meta);
    seatState.set(key, 'free');

    const btn = findSeatButton(meta.row, meta.seat);
    if (btn) btn.classList.remove('seat--reserved', 'seat--sold', 'seat--selected');
  }
  saveStateToLS();
  renderReserveRegistryUI();
}

function applySell() {
  if (!basket.length) return;

  const itemsToPrint = [];

  for (const item of basket) {
    seatState.set(item.key, 'sold');

    seatMeta.set(item.key, {
      status: 'sold',
      subject: 'Каса',
      ts: Date.now(),
      price: item.price ?? 0,
      zone: item.zone,
      row: item.row,
      seat: item.seat
    });

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--reserved');
      btn.classList.add('seat--sold');
    }

    itemsToPrint.push(item);
  }

  basket = [];
  updateBasketUI();
  saveStateToLS();
  renderReserveRegistryUI();

  openPrintQueue(itemsToPrint, { channel: "Каса" });
}

function applyReserve() {
  if (!basket.length) return;

  const subject = (CURRENT_SUBJECT || '').trim() || 'Без суб’єкта';

  for (const item of basket) {
    seatState.set(item.key, 'reserved');

    seatMeta.set(item.key, {
      status: 'reserved',
      subject,
      ts: Date.now(),
      price: item.price ?? 0,
      zone: item.zone,
      row: item.row,
      seat: item.seat
    });

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--sold');
      btn.classList.add('seat--reserved');
    }
  }

  basket = [];
  updateBasketUI();
  saveStateToLS();
  renderReserveRegistryUI();
}

function applyUnreserve() {
  if (!basket.length) return;

  for (const item of basket) {
    const status = seatState.get(item.key) || 'free';
    if (status !== 'reserved') continue;

    seatState.set(item.key, 'free');

    const meta = seatMeta.get(item.key);
    if (meta) {
      meta.status = 'free';
      seatMeta.set(item.key, meta);
    }

    const btn = findSeatButton(item.row, item.seat);
    if (btn) btn.classList.remove('seat--selected', 'seat--reserved', 'seat--sold');
  }

  basket = [];
  updateBasketUI();
  saveStateToLS();
  renderReserveRegistryUI();
}

function clearBasketOnly() {
  for (const item of basket) {
    const btn = findSeatButton(item.row, item.seat);
    if (btn) btn.classList.remove('seat--selected');
  }
  basket = [];
  updateBasketUI();
}

async function initAdminPage() {
  await loadSettings();
  loadStateFromLS();
  const schema = await loadHallSchema();

  const nameEl = document.getElementById('admin-theatre-name');
  if (nameEl && SETTINGS.theatre && SETTINGS.theatre.name) nameEl.textContent = SETTINGS.theatre.name;

  const subEl = document.getElementById('admin-theatre-subtitle');
  if (subEl) subEl.textContent = 'Панель касира / адміністратора';

  const showEl = document.getElementById('admin-current-show');
  if (showEl) showEl.textContent = 'Сеанс: демо-режим (тільки каса)';

  const dateEl = document.getElementById('admin-current-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleString('uk-UA');

  const subjInput = document.getElementById('reserve-subject');
  const subjBtn = document.getElementById('btn-set-subject');
  if (subjInput) subjInput.value = CURRENT_SUBJECT || '';
  if (subjBtn) subjBtn.addEventListener('click', () => {
    CURRENT_SUBJECT = (subjInput?.value || '').trim();
    saveStateToLS();
    renderReserveRegistryUI();
  });

  renderHall(schema);

  const btnSell = document.getElementById('btn-sell');
  const btnReserve = document.getElementById('btn-reserve');
  const btnUnreserve = document.getElementById('btn-unreserve');
  const btnClear = document.getElementById('btn-clear');

  if (btnSell) btnSell.addEventListener('click', applySell);
  if (btnReserve) btnReserve.addEventListener('click', applyReserve);
  if (btnUnreserve) btnUnreserve.addEventListener('click', applyUnreserve);
  if (btnClear) btnClear.addEventListener('click', clearBasketOnly);

  updateBasketUI();
  renderReserveRegistryUI();
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage().catch(err => console.error('Помилка ініціалізації адмінки', err));
});
