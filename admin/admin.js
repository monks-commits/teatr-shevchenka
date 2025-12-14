// admin/admin.js (совместимая версия: работает и со старым admin.html, и с новым)

// === Глобальні налаштування ===
let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};

const LS_PREFIX = 'shev_admin_v2'; // общий префикс localStorage

// Структуры в памяти
let hallSchema = null;         // shevchenko-big.json
const seatState = new Map();   // "row-seat" -> 'free' | 'sold' | 'reserved'
let basket = [];               // [{key,row,seat,zone,price,label,subject?}]

let AFISHA = [];
let CURRENT_SESSION_ID = null;
let CURRENT_SESSION = null;
let CURRENT_SUBJECT = '';

// ========= helpers (безопасные DOM) =========
function $(id) { return document.getElementById(id); }
function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
function setHTML(id, html) { const el = $(id); if (el) el.innerHTML = html; }

function lsKeyForSession(sessionId) {
  return `${LS_PREFIX}:session:${sessionId}`;
}

function nowUk() {
  return new Date().toLocaleString('uk-UA');
}

// === Завантаження settings.json ===
async function loadSettings() {
  if (SETTINGS) return SETTINGS;

  try {
    const res = await fetch('../data/settings.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    SETTINGS = await res.json();

    if (SETTINGS.theatre && SETTINGS.theatre.currency) {
      CURRENCY = SETTINGS.theatre.currency;
    }
    if (SETTINGS.pricing_defaults) {
      PRICING_DEFAULTS = SETTINGS.pricing_defaults;
    }
  } catch (e) {
    console.warn('Не вдалося завантажити settings.json, використаємо значення за замовчуванням.', e);
    SETTINGS = {};
  }
  return SETTINGS;
}

// === Афіша (сеанси) ===
async function loadAfisha() {
  try {
    const res = await fetch('../data/afisha.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    AFISHA = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Не вдалося завантажити afisha.json', e);
    AFISHA = [];
  }
  return AFISHA;
}

function prettySessionLabel(ev) {
  // "Вісім... — 28.12.2025 16:00 (Велика сцена)"
  const dt = `${ev.date || ''} ${ev.time || ''}`.trim();
  const stage = ev.stage ? ` (${ev.stage})` : '';
  return `${ev.title || ev.id || 'Подія'} — ${dt}${stage}`;
}

function getSessionFromAfisha(id) {
  return AFISHA.find(x => x.id === id) || null;
}

function initSessionSelectIfExists() {
  const sel = $('sessionSelect');
  if (!sel) return; // старый HTML — нет селекта, не падаем

  // заполняем options
  sel.innerHTML = '';
  if (!AFISHA.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Немає подій (afisha.json порожній)';
    sel.appendChild(opt);
    return;
  }

  for (const ev of AFISHA) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = prettySessionLabel(ev);
    sel.appendChild(opt);
  }

  // выбрать текущий или первый
  const saved = localStorage.getItem(`${LS_PREFIX}:currentSession`);
  const initial = (saved && getSessionFromAfisha(saved)) ? saved : AFISHA[0].id;
  sel.value = initial;
  setCurrentSession(initial);

  sel.addEventListener('change', () => {
    setCurrentSession(sel.value);
    // перерисовать/перечитать состояние
    loadSessionStateToMemory();
    applySeatStateToDOM();
    updateBasketUI();
    renderReservationsIfExists();
  });
}

function setCurrentSession(sessionId) {
  CURRENT_SESSION_ID = sessionId || null;
  CURRENT_SESSION = sessionId ? getSessionFromAfisha(sessionId) : null;
  if (CURRENT_SESSION_ID) {
    localStorage.setItem(`${LS_PREFIX}:currentSession`, CURRENT_SESSION_ID);
  }

  // Шапка
  if (CURRENT_SESSION) {
    setText('admin-current-show', `Сеанс: ${CURRENT_SESSION.title} — ${CURRENT_SESSION.date}, ${CURRENT_SESSION.time}`);
  } else {
    // если селекта нет — покажем "(не обрано)"
    setText('admin-current-show', 'Сеанс: (не обрано)');
  }
}

// === Завантаження схеми залу ===
async function loadHallSchema() {
  if (hallSchema) return hallSchema;
  const res = await fetch('../data/halls/shevchenko-big.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot load hall schema: ' + res.status);
  hallSchema = await res.json();
  return hallSchema;
}

// === Допоміжні ===
function seatKey(row, seat) {
  return `${row}-${seat}`;
}

function getPriceForRow(rowInfo) {
  const group = rowInfo.price_group;
  if (group && PRICING_DEFAULTS[group] != null) {
    return PRICING_DEFAULTS[group];
  }
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

// === ДРУК КВИТКА (каса) ===
function openTicketPrintPage(item) {
  // важно: ticket.html лежит в /teatr-shevchenka/tickets/ticket.html на GitHub Pages
  // если у тебя репо именно "teatr-shevchenka", то путь такой:
  const base = "/teatr-shevchenka/tickets/ticket.html";

  const title = (CURRENT_SESSION && CURRENT_SESSION.title) ? CURRENT_SESSION.title : "Назва вистави";
  const subtitle = (CURRENT_SESSION && CURRENT_SESSION.stage) ? CURRENT_SESSION.stage : "Велика сцена";
  const dateStr = (CURRENT_SESSION && CURRENT_SESSION.date && CURRENT_SESSION.time)
    ? `${CURRENT_SESSION.date}, ${CURRENT_SESSION.time}`
    : nowUk();

  const params = new URLSearchParams({
    title,
    subtitle,
    date: dateStr,
    zone: getZoneLabel(item.zone || ""),
    row: String(item.row),
    seat: String(item.seat),
    price: String(item.price ?? 0),
    curr: CURRENCY || "грн",
    channel: "Каса",
    order: "ORD-" + Date.now(),
    autoPrint: "1"
  });

  const url = base + "?" + params.toString();
  window.open(url, "_blank");
}

// === localStorage: состояние сеанса (продано/бронь + реестр) ===
function loadSessionStateToMemory() {
  seatState.clear();

  // если сеанс не выбран (старый HTML) — используем общий ключ
  const sid = CURRENT_SESSION_ID || 'NO_SESSION';
  const key = lsKeyForSession(sid);

  const raw = localStorage.getItem(key);
  if (!raw) return;

  try {
    const obj = JSON.parse(raw);
    if (obj && obj.seats) {
      for (const [k, v] of Object.entries(obj.seats)) {
        seatState.set(k, v);
      }
    }
  } catch (e) {
    console.warn('Bad localStorage session state', e);
  }
}

function saveSessionStateFromMemory() {
  const sid = CURRENT_SESSION_ID || 'NO_SESSION';
  const key = lsKeyForSession(sid);

  const seatsObj = {};
  for (const [k, v] of seatState.entries()) seatsObj[k] = v;

  const payload = {
    seats: seatsObj,
    reservations: loadReservationsRaw(), // сохраним то, что есть
    updatedAt: Date.now()
  };

  localStorage.setItem(key, JSON.stringify(payload));
}

function loadReservationsRaw() {
  const sid = CURRENT_SESSION_ID || 'NO_SESSION';
  const key = lsKeyForSession(sid);
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Array.isArray(obj?.reservations) ? obj.reservations : [];
  } catch { return []; }
}

function saveReservationsRaw(list) {
  const sid = CURRENT_SESSION_ID || 'NO_SESSION';
  const key = lsKeyForSession(sid);

  // сохраним seats + reservations вместе
  const seatsObj = {};
  for (const [k, v] of seatState.entries()) seatsObj[k] = v;

  const payload = {
    seats: seatsObj,
    reservations: Array.isArray(list) ? list : [],
    updatedAt: Date.now()
  };

  localStorage.setItem(key, JSON.stringify(payload));
}

// === Робота з DOM (схема) ===
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

  // Колір за зоною / діапазоном
  if (zone === 'parter') {
    if (rowNumber <= 6) btn.classList.add('seat--parter-front');
    else if (rowNumber <= 12) btn.classList.add('seat--parter-mid');
    else btn.classList.add('seat--parter-back');
  } else if (zone === 'amphi') {
    btn.classList.add('seat--amphi');
  } else if (zone === 'balcony') {
    btn.classList.add('seat--balcony');
  }

  // Вертикальний прохід (партер)
  if (rowInfo.zone === 'parter' && rowInfo.aisle_after && pos === rowInfo.aisle_after) {
    btn.classList.add('seat--gap-right');
  }

  // Клік по місцю
  btn.addEventListener('click', () => {
    const row = Number(btn.dataset.row);
    const seat = Number(btn.dataset.seat);
    const key = seatKey(row, seat);

    const status = seatState.get(key) || 'free';
    if (status === 'sold') return; // продане — не чіпаємо

    const inBasketIndex = basket.findIndex(i => i.key === key);
    if (inBasketIndex >= 0) {
      basket.splice(inBasketIndex, 1);
      btn.classList.remove('seat--selected');
    } else {
      const label = `${row} ряд, місце ${seat} (${getZoneLabel(zone)})`;
      basket.push({ key, row, seat, zone, price, label });
      btn.classList.add('seat--selected');
    }

    updateBasketUI();
  });

  return btn;
}

function renderParter(container, rows) {
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Партер та ложі';
  section.appendChild(title);

  const wrap = document.createElement('div');
  wrap.className = 'parter-wrap';

  // Ложа Б (зліва)
  const lodgeB = document.createElement('div');
  lodgeB.className = 'hall-lodge';
  const lodgeBLabel = document.createElement('div');
  lodgeBLabel.className = 'hall-lodge-label';
  lodgeBLabel.textContent = 'Ложа Б';
  lodgeB.appendChild(lodgeBLabel);

  const lodgeBSeats = document.createElement('div');
  lodgeBSeats.className = 'hall-lodge-seats';
  for (let i = 1; i <= 18; i++) {
    const b = document.createElement('div');
    b.className = 'seat seat--lodge';
    b.textContent = i;
    lodgeBSeats.appendChild(b);
  }
  lodgeB.appendChild(lodgeBSeats);

  // Центральні ряди
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
    const seatsCount = r.seats || 0;

    for (let i = 1; i <= seatsCount; i++) {
      const seatEl = createSeatElement(r, r.row, i, 'parter', i);
      sr.appendChild(seatEl);
    }

    line.appendChild(sr);
    center.appendChild(line);
  }

  // Ложа А (справа)
  const lodgeA = document.createElement('div');
  lodgeA.className = 'hall-lodge';
  const lodgeALabel = document.createElement('div');
  lodgeALabel.className = 'hall-lodge-label';
  lodgeALabel.textContent = 'Ложа А';
  lodgeA.appendChild(lodgeALabel);

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
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Амфітеатр';
  section.appendChild(title);

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
    for (let i = 1; i <= leftCount; i++) {
      sr.appendChild(createSeatElement(r, r.row, i, 'amphi', i));
    }

    const gap = document.createElement('div');
    gap.className = 'amphi-gap';
    sr.appendChild(gap);

    const rightCount = r.seats_right || 0;
    for (let i = 1; i <= rightCount; i++) {
      const seatNumber = leftCount + i;
      sr.appendChild(createSeatElement(r, r.row, seatNumber, 'amphi', seatNumber));
    }

    line.appendChild(sr);
    section.appendChild(line);
  }

  container.appendChild(section);
}

function renderBalcony(container, rows) {
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Балкон';
  section.appendChild(title);

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
      const leftCount = r.seats_left;
      const rightCount = r.seats_right;

      for (let i = 1; i <= leftCount; i++) sr.appendChild(createSeatElement(r, r.row, i, 'balcony', i));

      const gap = document.createElement('div');
      gap.className = 'amphi-gap';
      sr.appendChild(gap);

      for (let i = 1; i <= rightCount; i++) {
        const seatNumber = leftCount + i;
        sr.appendChild(createSeatElement(r, r.row, seatNumber, 'balcony', seatNumber));
      }
    } else {
      const seatsCount = r.seats || 0;
      for (let i = 1; i <= seatsCount; i++) {
        const seatEl = createSeatElement(r, r.row, i, 'balcony', i);
        if (r.aisle_after && i === r.aisle_after) seatEl.classList.add('seat--gap-right');
        sr.appendChild(seatEl);
      }
    }

    line.appendChild(sr);
    section.appendChild(line);
  }

  container.appendChild(section);
}

function renderHall(schema) {
  const root = $('hall-root');
  if (!root) return;
  root.innerHTML = '';

  const rowsParter = schema.rows.filter(r => r.zone === 'parter');
  const rowsAmphi  = schema.rows.filter(r => r.zone === 'amphi');
  const rowsBalcony= schema.rows.filter(r => r.zone === 'balcony');

  renderParter(root, rowsParter);

  const amphiWrap = document.createElement('div');
  renderAmphi(amphiWrap, rowsAmphi);
  root.appendChild(amphiWrap);

  const balcWrap = document.createElement('div');
  renderBalcony(balcWrap, rowsBalcony);
  root.appendChild(balcWrap);
}

function findSeatButton(row, seat) {
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    if (Number(b.dataset.row) === row && Number(b.dataset.seat) === seat) return b;
  }
  return null;
}

function applySeatStateToDOM() {
  // пройтись по всем seat кнопкам и назначить sold/reserved
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    const row = Number(b.dataset.row);
    const seat = Number(b.dataset.seat);
    if (!row || !seat) continue; // ложи и декоративные без data-row
    const key = seatKey(row, seat);
    const st = seatState.get(key) || 'free';

    b.classList.remove('seat--sold', 'seat--reserved');
    if (st === 'sold') b.classList.add('seat--sold');
    if (st === 'reserved') b.classList.add('seat--reserved');
  }
}

// === Оновлення UI кошика ===
function updateBasketUI() {
  const listEl = $('basket-list');
  const totalEl = $('basket-total');
  const curEl = $('basket-currency');

  if (curEl) curEl.textContent = CURRENCY;

  const total = basket.reduce((sum, i) => sum + (i.price || 0), 0);
  if (totalEl) totalEl.textContent = String(total);

  if (!listEl) return; // старый HTML может не иметь списка — не падаем

  if (basket.length === 0) {
    listEl.innerHTML = '<div class="basket-empty">Поки що нічого не обрано.</div>';
    return;
  }

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

// === Реєстр броней (если блоки есть) ===
function renderReservationsIfExists() {
  const list = $('reservations-list');
  const empty = $('reservations-empty');
  if (!list || !empty) return; // старый HTML — нет реестра

  const all = loadReservationsRaw();
  if (!all.length) {
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';

  // сгруппировать по subject
  const groups = new Map();
  for (const r of all) {
    const subj = r.subject || '(без суб’єкта)';
    if (!groups.has(subj)) groups.set(subj, []);
    groups.get(subj).push(r);
  }

  for (const [subj, rows] of groups.entries()) {
    const wrap = document.createElement('div');
    wrap.className = 'reserv-item';

    const seatsText = rows.map(x => `${x.row}-${x.seat}`).join(', ');
    const sum = rows.reduce((s,x)=>s+(x.price||0),0);

    wrap.innerHTML = `
      <div class="reserv-head">
        <div><b>${subj}</b><div class="mini">${rows.length} місць • ${sum} ${CURRENCY}</div></div>
        <div class="mini">${rows[0]?.createdAt ? new Date(rows[0].createdAt).toLocaleString('uk-UA') : ''}</div>
      </div>
      <div class="mini">Місця: ${seatsText}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'reserv-actions';

    const btnSell = document.createElement('button');
    btnSell.className = 'btnx green';
    btnSell.textContent = 'Продати + друк';
    btnSell.addEventListener('click', () => {
      // продать все места этой брони
      for (const it of rows) {
        const key = seatKey(it.row, it.seat);
        seatState.set(key, 'sold');
        openTicketPrintPage(it);
      }
      // удалить бронь из реестра
      const rest = loadReservationsRaw().filter(x => (x.subject||'') !== (subj||''));
      saveReservationsRaw(rest);
      saveSessionStateFromMemory();
      applySeatStateToDOM();
      renderReservationsIfExists();
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btnx secondary';
    btnCancel.textContent = 'Скасувати бронь';
    btnCancel.addEventListener('click', () => {
      // снять бронь
      for (const it of rows) {
        const key = seatKey(it.row, it.seat);
        // если там reserved — вернуть free
        if ((seatState.get(key) || 'free') === 'reserved') seatState.set(key, 'free');
      }
      // убрать из реестра
      const rest = loadReservationsRaw().filter(x => (x.subject||'') !== (subj||''));
      saveReservationsRaw(rest);
      saveSessionStateFromMemory();
      applySeatStateToDOM();
      renderReservationsIfExists();
    });

    actions.appendChild(btnSell);
    actions.appendChild(btnCancel);
    wrap.appendChild(actions);

    list.appendChild(wrap);
  }
}

// === Кнопки дій ===
function applySell() {
  if (!basket.length) return;

  for (const item of basket) {
    const key = item.key;
    seatState.set(key, 'sold');

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--reserved');
      btn.classList.add('seat--sold');
    }

    openTicketPrintPage(item);
  }

  saveSessionStateFromMemory();
  basket = [];
  updateBasketUI();
  renderReservationsIfExists();
}

function applyReserve() {
  if (!basket.length) return;

  const subjInput = $('subjectInput');
  CURRENT_SUBJECT = subjInput ? (subjInput.value || '').trim() : '';
  if (!CURRENT_SUBJECT) CURRENT_SUBJECT = '(без суб’єкта)';

  const reservations = loadReservationsRaw();

  for (const item of basket) {
    const key = item.key;
    seatState.set(key, 'reserved');

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--sold');
      btn.classList.add('seat--reserved');
    }

    reservations.push({
      subject: CURRENT_SUBJECT,
      row: item.row,
      seat: item.seat,
      zone: item.zone,
      price: item.price,
      createdAt: Date.now()
    });
  }

  saveReservationsRaw(reservations);
  saveSessionStateFromMemory();
  basket = [];
  updateBasketUI();
  renderReservationsIfExists();
}

function applyUnreserve() {
  if (!basket.length) return;

  const reservations = loadReservationsRaw();

  for (const item of basket) {
    const key = item.key;
    const status = seatState.get(key);
    if (status === 'reserved') {
      seatState.set(key, 'free');
      const btn = findSeatButton(item.row, item.seat);
      if (btn) btn.classList.remove('seat--selected', 'seat--reserved', 'seat--sold');
    }

    // убрать из реестра
    const idx = reservations.findIndex(x => x.row === item.row && x.seat === item.seat);
    if (idx >= 0) reservations.splice(idx, 1);
  }

  saveReservationsRaw(reservations);
  saveSessionStateFromMemory();
  basket = [];
  updateBasketUI();
  renderReservationsIfExists();
}

function clearBasketOnly() {
  for (const item of basket) {
    const btn = findSeatButton(item.row, item.seat);
    if (btn) btn.classList.remove('seat--selected');
  }
  basket = [];
  updateBasketUI();
}

// === Ініціалізація ===
async function initAdminPage() {
  await loadSettings();
  await loadAfisha();

  // Назва театру / валюта в шапці
  if (SETTINGS?.theatre?.name) setText('admin-theatre-name', SETTINGS.theatre.name);
  setText('admin-theatre-subtitle', 'Панель касира / адміністратора');
  setText('admin-current-date', nowUk());

  // Сеанс: если есть select — выберем, если нет — просто оставим как есть
  initSessionSelectIfExists();

  // Если селекта нет, но афиша есть — выберем первый сеанс чтобы состояние было раздельным
  if (!CURRENT_SESSION_ID && AFISHA.length) {
    setCurrentSession(AFISHA[0].id);
  }

  // Схема
  const schema = await loadHallSchema();
  renderHall(schema);

  // подтянуть сохраненные статусы мест
  loadSessionStateToMemory();
  applySeatStateToDOM();

  // Кнопки
  const btnSell = $('btn-sell');
  const btnReserve = $('btn-reserve');
  const btnUnreserve = $('btn-unreserve');
  const btnClear = $('btn-clear');

  if (btnSell) btnSell.addEventListener('click', applySell);
  if (btnReserve) btnReserve.addEventListener('click', applyReserve);
  if (btnUnreserve) btnUnreserve.addEventListener('click', applyUnreserve);
  if (btnClear) btnClear.addEventListener('click', clearBasketOnly);

  updateBasketUI();
  renderReservationsIfExists();
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage().catch(err => {
    console.error('Помилка ініціалізації адмінки', err);
  });
});
