// admin/admin.js

// === Глобальні налаштування ===
let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};

let hallSchema = null;         // shevchenko-big.json
const seatState = new Map();   // key -> 'free' | 'sold' | 'reserved'
let basket = [];               // [{key,row,seat,zone,price,label}]

let AFISHA = [];
let CURRENT_SHOW = null;       // {id,title,date,time,stage,...}

// localStorage keys
const LS_PREFIX = 'shev_admin_v2';
const LS_KEY_PRINT = `${LS_PREFIX}_print_payload`; // для друку пачкою

function showKey(show) {
  if (!show) return 'none';
  return `${show.id}-${show.date}`; // ex: visim-2025-12-28
}

function lsKeySeats(show) { return `${LS_PREFIX}_seats_${showKey(show)}`; }
function lsKeyRes(show)   { return `${LS_PREFIX}_reservations_${showKey(show)}`; }

// === Завантаження settings.json ===
async function loadSettings() {
  if (SETTINGS) return SETTINGS;

  try {
    const res = await fetch('../data/settings.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    SETTINGS = await res.json();

    if (SETTINGS.theatre?.currency) CURRENCY = SETTINGS.theatre.currency;
    if (SETTINGS.pricing_defaults) PRICING_DEFAULTS = SETTINGS.pricing_defaults;
  } catch (e) {
    console.warn('Не вдалося завантажити settings.json, використаємо значення за замовчуванням.', e);
    SETTINGS = {};
  }
  return SETTINGS;
}

// === Афіша / список сеансів ===
async function loadAfisha() {
  const res = await fetch('../data/afisha.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot load afisha.json: ' + res.status);
  AFISHA = await res.json();
  return AFISHA;
}

function fillShowSelect() {
  const sel = document.getElementById('show-select');
  if (!sel) return;

  sel.innerHTML = '<option value="">(не обрано)</option>';

  for (const ev of AFISHA) {
    const opt = document.createElement('option');
    opt.value = `${ev.id}::${ev.date}`;
    opt.textContent = `${ev.title} — ${ev.date}, ${ev.time}`;
    sel.appendChild(opt);
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

// === Завантаження статусів місць з data/seances/... (якщо є) ===
async function tryLoadSeancePlaces(show) {
  if (!show) return null;

  // очікуваний файл: data/seances/visim-2025-12-28.json
  const url = `../data/seances/${showKey(show)}.json`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json; // { places: {...}, prices: {...} ... }
  } catch {
    return null;
  }
}

// === Допоміжні ===
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

// === Стан: збереження/відновлення ===
function saveSeatsToLS() {
  if (!CURRENT_SHOW) return;
  const obj = {};
  for (const [k, v] of seatState.entries()) obj[k] = v;
  localStorage.setItem(lsKeySeats(CURRENT_SHOW), JSON.stringify(obj));
}

function loadSeatsFromLS() {
  seatState.clear();
  if (!CURRENT_SHOW) return;

  const raw = localStorage.getItem(lsKeySeats(CURRENT_SHOW));
  if (!raw) return;

  try {
    const obj = JSON.parse(raw);
    for (const k of Object.keys(obj)) seatState.set(k, obj[k]);
  } catch {}
}

function loadReservations() {
  if (!CURRENT_SHOW) return [];
  const raw = localStorage.getItem(lsKeyRes(CURRENT_SHOW));
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

function saveReservations(list) {
  if (!CURRENT_SHOW) return;
  localStorage.setItem(lsKeyRes(CURRENT_SHOW), JSON.stringify(list || []));
}

// === ДРУК ПАЧКОЮ (1 вкладка) ===
function openBatchPrintPage(items, show) {
  // items: [{row,seat,zone,price,label}]
  const payload = {
    theatre: SETTINGS?.theatre?.name || 'Театр ім. Т. Г. Шевченка',
    tagline: 'Офіційний онлайн-продаж квитків',
    showTitle: show?.title || 'Назва вистави',
    stage: show?.stage || '',
    dateTime: show ? `${show.date}, ${show.time}` : new Date().toLocaleString('uk-UA'),
    currency: CURRENCY || 'грн',
    channel: 'Каса',
    items: items.map(i => ({
      row: i.row,
      seat: i.seat,
      zone: getZoneLabel(i.zone),
      price: i.price ?? 0,
      order: 'ORD-' + Date.now() + '-' + i.row + '-' + i.seat
    }))
  };

  localStorage.setItem(LS_KEY_PRINT, JSON.stringify(payload));
  window.open('../tickets/print-batch.html?autoPrint=1', '_blank');
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

  // застосувати статус з seatState
  applySeatVisual(btn);

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

function applySeatVisual(btn) {
  const row = Number(btn.dataset.row);
  const seat = Number(btn.dataset.seat);
  const key = seatKey(row, seat);
  const st = seatState.get(key) || 'free';

  btn.classList.remove('seat--sold', 'seat--reserved');
  if (st === 'sold') btn.classList.add('seat--sold');
  if (st === 'reserved') btn.classList.add('seat--reserved');
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
  const root = document.getElementById('hall-root');
  if (!root) return;

  root.innerHTML = '';

  const rowsParter = schema.rows.filter(r => r.zone === 'parter');
  const rowsAmphi = schema.rows.filter(r => r.zone === 'amphi');
  const rowsBalcony = schema.rows.filter(r => r.zone === 'balcony');

  renderParter(root, rowsParter);
  renderAmphi(root, rowsAmphi);
  renderBalcony(root, rowsBalcony);
}

// === Кошик ===
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

  const total = basket.reduce((sum, i) => sum + (i.price || 0), 0);
  totalEl.textContent = String(total);
  if (curEl) curEl.textContent = CURRENCY;
}

// === Реєстр броней ===
function renderReservations() {
  const empty = document.getElementById('reservations-empty');
  const table = document.getElementById('reservations-table');
  const body = document.getElementById('reservations-body');
  if (!empty || !table || !body) return;

  const list = loadReservations();

  if (!list.length) {
    empty.style.display = '';
    table.style.display = 'none';
    body.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  table.style.display = '';
  body.innerHTML = '';

  for (const r of list) {
    const tr = document.createElement('tr');

    const tdWho = document.createElement('td');
    tdWho.textContent = r.subject || '—';

    const tdCnt = document.createElement('td');
    tdCnt.textContent = String(r.items?.length || 0);

    const tdSeats = document.createElement('td');
    tdSeats.textContent = (r.items || [])
      .map(i => `${i.row}-${i.seat}`)
      .join(', ');

    const tdSum = document.createElement('td');
    tdSum.textContent = `${r.total || 0} ${CURRENCY}`;

    const tdAct = document.createElement('td');
    const act = document.createElement('div');
    act.className = 'res-actions';

    const btnSellPrint = document.createElement('button');
    btnSellPrint.className = 'mini primary';
    btnSellPrint.textContent = 'Продати + друк';
    btnSellPrint.addEventListener('click', () => {
      sellReservation(r.id);
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'mini';
    btnCancel.textContent = 'Скасувати бронь';
    btnCancel.addEventListener('click', () => {
      cancelReservation(r.id);
    });

    act.appendChild(btnSellPrint);
    act.appendChild(btnCancel);
    tdAct.appendChild(act);

    tr.appendChild(tdWho);
    tr.appendChild(tdCnt);
    tr.appendChild(tdSeats);
    tr.appendChild(tdSum);
    tr.appendChild(tdAct);
    body.appendChild(tr);
  }
}

function sellReservation(resId) {
  const list = loadReservations();
  const r = list.find(x => x.id === resId);
  if (!r) return;

  // 1) помітити місця sold
  for (const it of r.items) {
    seatState.set(seatKey(it.row, it.seat), 'sold');
  }
  saveSeatsToLS();

  // 2) видалити бронь
  const next = list.filter(x => x.id !== resId);
  saveReservations(next);

  // 3) перемалювати зал/таблиці
  refreshSeatVisuals();
  renderReservations();

  // 4) друк пачкою
  openBatchPrintPage(
    r.items.map(i => ({
      key: seatKey(i.row, i.seat),
      row: i.row, seat: i.seat, zone: i.zone_raw || i.zone, price: i.price,
      label: `${i.row} ряд, місце ${i.seat} (${i.zone})`
    })),
    CURRENT_SHOW
  );
}

function cancelReservation(resId) {
  const list = loadReservations();
  const r = list.find(x => x.id === resId);
  if (!r) return;

  // зняти бронь -> free (тільки якщо зараз reserved)
  for (const it of r.items) {
    const k = seatKey(it.row, it.seat);
    if ((seatState.get(k) || 'free') === 'reserved') seatState.set(k, 'free');
  }
  saveSeatsToLS();

  const next = list.filter(x => x.id !== resId);
  saveReservations(next);

  refreshSeatVisuals();
  renderReservations();
}

function refreshSeatVisuals() {
  document.querySelectorAll('.seat').forEach(btn => {
    if (btn.dataset?.row && btn.dataset?.seat) applySeatVisual(btn);
  });
}

// === Кнопки дій (кошик) ===
function applySell() {
  if (!CURRENT_SHOW) {
    alert('Спочатку оберіть сеанс.');
    return;
  }
  if (!basket.length) return;

  // продати
  const itemsToPrint = [];
  for (const item of basket) {
    seatState.set(item.key, 'sold');
    itemsToPrint.push(item);

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--reserved');
      btn.classList.add('seat--sold');
    }
  }

  saveSeatsToLS();

  // друк пачкою (одна вкладка)
  openBatchPrintPage(itemsToPrint, CURRENT_SHOW);

  basket = [];
  updateBasketUI();
}

function applyReserve() {
  if (!CURRENT_SHOW) {
    alert('Спочатку оберіть сеанс.');
    return;
  }
  if (!basket.length) return;

  const subject = prompt('Хто бронює? (ПІБ / Організація)');
  if (!subject) return;

  const items = [];
  for (const item of basket) {
    seatState.set(item.key, 'reserved');

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--sold');
      btn.classList.add('seat--reserved');
    }

    items.push({
      row: item.row,
      seat: item.seat,
      zone: getZoneLabel(item.zone),
      zone_raw: item.zone,
      price: item.price
    });
  }

  saveSeatsToLS();

  const total = items.reduce((s, i) => s + (i.price || 0), 0);
  const list = loadReservations();
  list.push({
    id: 'RES-' + Date.now(),
    subject,
    createdAt: new Date().toISOString(),
    items,
    total
  });
  saveReservations(list);
  renderReservations();

  basket = [];
  updateBasketUI();
}

function applyUnreserve() {
  if (!CURRENT_SHOW) {
    alert('Спочатку оберіть сеанс.');
    return;
  }
  if (!basket.length) return;

  for (const item of basket) {
    const status = seatState.get(item.key) || 'free';
    if (status === 'reserved') {
      seatState.set(item.key, 'free');
      const btn = findSeatButton(item.row, item.seat);
      if (btn) btn.classList.remove('seat--selected', 'seat--reserved', 'seat--sold');
    }
  }

  saveSeatsToLS();
  // також прибрати з реєстру броней ті місця (якщо бронь була записана)
  cleanupReservationsBySeats();
  renderReservations();

  basket = [];
  updateBasketUI();
}

function cleanupReservationsBySeats() {
  // простий варіант: пройти всі броні і прибрати місця, які вже не reserved
  const list = loadReservations();
  const next = [];
  for (const r of list) {
    const items = (r.items || []).filter(it => (seatState.get(seatKey(it.row, it.seat)) || 'free') === 'reserved');
    if (items.length) {
      next.push({
        ...r,
        items,
        total: items.reduce((s, i) => s + (i.price || 0), 0)
      });
    }
  }
  saveReservations(next);
}

function clearBasketOnly() {
  for (const item of basket) {
    const btn = findSeatButton(item.row, item.seat);
    if (btn) btn.classList.remove('seat--selected');
  }
  basket = [];
  updateBasketUI();
}

function findSeatButton(row, seat) {
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    if (Number(b.dataset.row) === row && Number(b.dataset.seat) === seat) return b;
  }
  return null;
}

// === Вибір сеансу ===
async function setCurrentShowByValue(val) {
  if (!val) {
    CURRENT_SHOW = null;
    basket = [];
    seatState.clear();
    updateBasketUI();
    renderReservations();
    return;
  }

  const [id, date] = val.split('::');
  CURRENT_SHOW = AFISHA.find(x => x.id === id && x.date === date) || null;

  basket = [];

  // 1) seats from localStorage
  loadSeatsFromLS();

  // 2) try apply from seances file (if exists) ONLY if LS is empty
  if (seatState.size === 0) {
    const seance = await tryLoadSeancePlaces(CURRENT_SHOW);
    if (seance?.places) {
      for (const k of Object.keys(seance.places)) {
        const st = seance.places[k]?.status;
        if (st === 'sold') seatState.set(k, 'sold');
        if (st === 'reserved') seatState.set(k, 'reserved');
      }
      saveSeatsToLS();
    }
  }

  // redraw
  const schema = await loadHallSchema();
  renderHall(schema);
  updateBasketUI();
  renderReservations();
}

// === Ініціалізація ===
async function initAdminPage() {
  await loadSettings();
  await loadHallSchema();
  await loadAfisha();

  // Назва театру
  const nameEl = document.getElementById('admin-theatre-name');
  if (nameEl && SETTINGS?.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  // дата/час
  const dateEl = document.getElementById('admin-current-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleString('uk-UA');

  // select
  fillShowSelect();
  const sel = document.getElementById('show-select');
  if (sel) {
    sel.addEventListener('change', () => setCurrentShowByValue(sel.value));
  }

  // початково: нічого не обрано
  renderHall(await loadHallSchema());
  updateBasketUI();
  renderReservations();

  // кнопки
  document.getElementById('btn-sell')?.addEventListener('click', applySell);
  document.getElementById('btn-reserve')?.addEventListener('click', applyReserve);
  document.getElementById('btn-unreserve')?.addEventListener('click', applyUnreserve);
  document.getElementById('btn-clear')?.addEventListener('click', clearBasketOnly);
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage().catch(err => console.error('Помилка ініціалізації адмінки', err));
});
