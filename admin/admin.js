// admin/admin.js

// ===== Глобальні налаштування =====
let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};

// Поточний сеанс
let CURRENT_SESSION = null; // { id, show, title, date, time, stage, hall_id }
let hallSchema = null;

// Стан місць (для поточного сеансу)
const seatState = new Map();  // key "row-seat-zone" -> { status:'free|sold|reserved', subject?:string, price:number, zone:string, row:number, seat:number }
let basket = [];              // [{key,row,seat,zone,price,label}]

// Реєстр броней поточного сеансу
let reservations = [];        // [{id, subject, items:[{row,seat,zone,price,key,label}], total, ts, status:'reserved'}]

// ===== Хелпери ключів =====
function sessionKey(sess){
  // щоб у localStorage не було проблем зі слешами
  const safe = (v) => String(v || '').replace(/\s+/g,' ').trim();
  return [
    safe(sess?.show),
    safe(sess?.date),
    safe(sess?.time),
    safe(sess?.stage)
  ].join(' | ');
}

function lsKeySeats(sess){ return 'shev_admin_seats_v1::' + sessionKey(sess); }
function lsKeyReservations(sess){ return 'shev_admin_reservations_v1::' + sessionKey(sess); }

// ключ місця
function seatKey(row, seat, zone){ return `${row}-${seat}-${zone}`; }

function getZoneLabel(zone) {
  switch (zone) {
    case 'parter': return 'Партер';
    case 'amphi': return 'Амфітеатр';
    case 'balcony': return 'Балкон';
    case 'lodgeA': return 'Ложа А';
    case 'lodgeB': return 'Ложа Б';
    default: return zone;
  }
}

// ===== Завантаження settings.json =====
async function loadSettings() {
  if (SETTINGS) return SETTINGS;

  try {
    const res = await fetch('../data/settings.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    SETTINGS = await res.json();

    if (SETTINGS?.theatre?.currency) CURRENCY = SETTINGS.theatre.currency;
    if (SETTINGS?.pricing_defaults) PRICING_DEFAULTS = SETTINGS.pricing_defaults;
  } catch (e) {
    console.warn('Не вдалося завантажити settings.json, використаємо значення за замовчуванням.', e);
    SETTINGS = {};
  }
  return SETTINGS;
}

// ===== Завантаження афіші для вибору сеансу =====
async function loadSessionsList() {
  // очікуємо масив елементів: {show,title,date,time,stage,city,theatre,hall_id,...}
  const res = await fetch('../data/afisha.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot load afisha.json: ' + res.status);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

// ===== Завантаження схеми залу =====
async function loadHallSchema(hallId) {
  // зараз фіксуємо shevchenko-big.json, але закладаємося на hallId
  const file = hallId ? `../data/halls/${hallId}.json` : '../data/halls/shevchenko-big.json';
  const res = await fetch(file, { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot load hall schema: ' + res.status + ' (' + file + ')');
  hallSchema = await res.json();
  return hallSchema;
}

// ===== Ціни =====
function getPriceForRow(rowInfo) {
  const group = rowInfo.price_group;
  if (group && PRICING_DEFAULTS[group] != null) return PRICING_DEFAULTS[group];
  return 0;
}

// ===== localStorage: Seats =====
function saveSeatStateToLS(){
  if (!CURRENT_SESSION) return;
  const obj = {};
  for (const [k, v] of seatState.entries()) obj[k] = v;
  localStorage.setItem(lsKeySeats(CURRENT_SESSION), JSON.stringify(obj));
}

function loadSeatStateFromLS(){
  seatState.clear();
  if (!CURRENT_SESSION) return;

  const raw = localStorage.getItem(lsKeySeats(CURRENT_SESSION));
  if (!raw) return;

  try{
    const obj = JSON.parse(raw);
    for (const k of Object.keys(obj || {})) seatState.set(k, obj[k]);
  }catch(e){
    console.warn('Seat state parse failed', e);
  }
}

// ===== localStorage: Reservations =====
function saveReservationsToLS(){
  if (!CURRENT_SESSION) return;
  localStorage.setItem(lsKeyReservations(CURRENT_SESSION), JSON.stringify(reservations));
}

function loadReservationsFromLS(){
  reservations = [];
  if (!CURRENT_SESSION) return;

  const raw = localStorage.getItem(lsKeyReservations(CURRENT_SESSION));
  if (!raw) return;

  try{
    const arr = JSON.parse(raw);
    reservations = Array.isArray(arr) ? arr : [];
  }catch(e){
    console.warn('Reservations parse failed', e);
  }
}

// ===== ДРУК КВИТКА (каса) =====
function openTicketPrintPage(item) {
  // item: {row, seat, zone, price, ...}
  // Під себе: якщо шлях інший — зміниш тут один рядок
  const base = "../tickets/ticket.html";

  const title = CURRENT_SESSION?.title || "НАЗВА ВИСТАВИ";
  const subtitle = CURRENT_SESSION?.stage || "Велика сцена";
  const dateText = [CURRENT_SESSION?.date, CURRENT_SESSION?.time].filter(Boolean).join(", ");

  const params = new URLSearchParams({
    title,
    subtitle,
    date: dateText || new Date().toLocaleString("uk-UA"),
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

// ===== Робота з DOM (схема) =====
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

  // колір за зоною/рядом
  if (zone === 'parter') {
    if (rowNumber <= 6) btn.classList.add('seat--parter-front');
    else if (rowNumber <= 12) btn.classList.add('seat--parter-mid');
    else btn.classList.add('seat--parter-back');
  } else if (zone === 'amphi') {
    btn.classList.add('seat--amphi');
  } else if (zone === 'balcony') {
    btn.classList.add('seat--balcony');
  } else if (zone === 'lodgeA' || zone === 'lodgeB') {
    btn.classList.add('seat--lodge');
  }

  // прохід у партері/балконі (якщо заданий)
  if (rowInfo.zone === 'parter' && rowInfo.aisle_after && pos === rowInfo.aisle_after) {
    btn.classList.add('seat--gap-right');
  }
  if (rowInfo.zone === 'balcony' && rowInfo.aisle_after && pos === rowInfo.aisle_after) {
    btn.classList.add('seat--gap-right');
  }

  // статус із пам'яті
  const key = seatKey(rowNumber, seatNumber, zone);
  const st = seatState.get(key);
  if (st?.status === 'sold') btn.classList.add('seat--sold');
  if (st?.status === 'reserved') btn.classList.add('seat--reserved');

  // клік
  btn.addEventListener('click', () => {
    const row = Number(btn.dataset.row);
    const seat = Number(btn.dataset.seat);
    const z = btn.dataset.zone;
    const k = seatKey(row, seat, z);

    const state = seatState.get(k);
    if (state?.status === 'sold') return; // продане — не чіпаємо

    const inBasketIndex = basket.findIndex(i => i.key === k);
    if (inBasketIndex >= 0) {
      basket.splice(inBasketIndex, 1);
      btn.classList.remove('seat--selected');
    } else {
      const zoneLabel = getZoneLabel(z);
      const label = `${zoneLabel}: ${row} ряд, місце ${seat}`;
      basket.push({ key:k, row, seat, zone:z, price:Number(btn.dataset.price||0), label });
      btn.classList.add('seat--selected');
    }

    updateBasketUI();
  });

  return btn;
}

function renderParter(container, rows) {
  const section = document.createElement('section');
  section.className = 'hall-section';
  section.innerHTML = `<div class="hall-section-title">Партер</div>`;

  const wrap = document.createElement('div');
  wrap.className = 'parter-wrap';

  // Ложа Б (ліва)
  const lodgeB = document.createElement('div');
  lodgeB.className = 'hall-lodge';
  lodgeB.innerHTML = `<div class="hall-lodge-label">Ложа Б</div>`;
  const lodgeBSeats = document.createElement('div');
  lodgeBSeats.className = 'hall-lodge-seats';
  for (let i = 1; i <= 18; i++) {
    const fakeRow = i; // вертикальна нумерація як ряд
    const seatEl = createSeatElement({ zone:'lodgeB', price_group: rows?.[0]?.price_group }, fakeRow, 1, 'lodgeB', 1);
    seatEl.textContent = i;
    seatEl.dataset.row = String(i);
    seatEl.dataset.seat = "1";
    seatEl.dataset.zone = "lodgeB";
    lodgeBSeats.appendChild(seatEl);
  }
  lodgeB.appendChild(lodgeBSeats);

  // Центр (ряди)
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

  // Ложа А (права)
  const lodgeA = document.createElement('div');
  lodgeA.className = 'hall-lodge';
  lodgeA.innerHTML = `<div class="hall-lodge-label">Ложа А</div>`;
  const lodgeASeats = document.createElement('div');
  lodgeASeats.className = 'hall-lodge-seats';
  for (let i = 1; i <= 18; i++) {
    const fakeRow = i;
    const seatEl = createSeatElement({ zone:'lodgeA', price_group: rows?.[0]?.price_group }, fakeRow, 1, 'lodgeA', 1);
    seatEl.textContent = i;
    seatEl.dataset.row = String(i);
    seatEl.dataset.seat = "1";
    seatEl.dataset.zone = "lodgeA";
    lodgeASeats.appendChild(seatEl);
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
  section.innerHTML = `<div class="hall-section-title">Амфітеатр</div>`;

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
  section.innerHTML = `<div class="hall-section-title">Балкон</div>`;

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

// ===== Кошик =====
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

function findSeatButton(row, seat, zone) {
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    if (Number(b.dataset.row) === row && Number(b.dataset.seat) === seat && String(b.dataset.zone) === String(zone)) {
      return b;
    }
  }
  return null;
}

// ===== Реєстр броней =====
function renderReservations(){
  const box = document.getElementById('reservations-list');
  const empty = document.getElementById('reservations-empty');
  if (!box || !empty) return;

  box.innerHTML = '';
  if (!reservations.length){
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const r of reservations.slice().sort((a,b)=> (b.ts||0)-(a.ts||0))) {
    const div = document.createElement('div');
    div.className = 'reserv-item';

    const seatsText = r.items.map(i => `${getZoneLabel(i.zone)} ${i.row}р-${i.seat}м`).join(', ');
    const when = new Date(r.ts || Date.now()).toLocaleString('uk-UA');

    div.innerHTML = `
      <div class="reserv-head">
        <div>
          <div><b>${escapeHtml(r.subject || '—')}</b></div>
          <div class="mini">${when}</div>
        </div>
        <div style="text-align:right">
          <div><b>${r.total || 0} ${CURRENCY}</b></div>
          <div class="mini">${r.items.length} квит.</div>
        </div>
      </div>
      <div class="mini">${escapeHtml(seatsText)}</div>
      <div class="reserv-actions">
        <button class="btnx secondary" data-act="sell" data-id="${r.id}">Продати та друк</button>
        <button class="btnx ghost" data-act="cancel" data-id="${r.id}">Скасувати бронь</button>
      </div>
    `;

    div.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === 'cancel') cancelReservation(id);
        if (act === 'sell') sellReservation(id);
      });
    });

    box.appendChild(div);
  }
}

function cancelReservation(resId){
  const idx = reservations.findIndex(x => x.id === resId);
  if (idx < 0) return;
  const r = reservations[idx];

  // знімаємо бронь з місць
  for (const it of r.items) {
    const k = seatKey(it.row, it.seat, it.zone);
    const st = seatState.get(k);
    if (st?.status === 'reserved') {
      seatState.set(k, { ...st, status:'free', subject: '' });
      const btn = findSeatButton(it.row, it.seat, it.zone);
      if (btn) btn.classList.remove('seat--reserved', 'seat--selected');
    }
  }

  reservations.splice(idx, 1);
  saveSeatStateToLS();
  saveReservationsToLS();
  renderReservations();
}

function sellReservation(resId){
  const r = reservations.find(x => x.id === resId);
  if (!r) return;

  // продаємо і друкуємо по кожному місцю
  for (const it of r.items) {
    const k = seatKey(it.row, it.seat, it.zone);
    const cur = seatState.get(k) || {};
    seatState.set(k, { ...cur, status:'sold', subject: r.subject, price: it.price, zone: it.zone, row: it.row, seat: it.seat });
    const btn = findSeatButton(it.row, it.seat, it.zone);
    if (btn) {
      btn.classList.remove('seat--reserved', 'seat--selected');
      btn.classList.add('seat--sold');
    }
    openTicketPrintPage(it);
  }

  // видаляємо бронь з реєстру
  reservations = reservations.filter(x => x.id !== resId);
  saveSeatStateToLS();
  saveReservationsToLS();
  renderReservations();
  clearBasketOnly();
}

// ===== Кнопки дій =====
function applySell() {
  if (!basket.length) return;

  for (const item of basket) {
    const k = item.key;
    seatState.set(k, { status:'sold', subject:'', price:item.price, zone:item.zone, row:item.row, seat:item.seat });

    const btn = findSeatButton(item.row, item.seat, item.zone);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--reserved');
      btn.classList.add('seat--sold');
    }

    openTicketPrintPage(item);
  }

  basket = [];
  saveSeatStateToLS();
  updateBasketUI();
}

function applyReserve() {
  if (!basket.length) return;

  const subject = (document.getElementById('subjectInput')?.value || '').trim();
  if (!subject){
    alert('Вкажіть «Суб’єкт броні» (ПІБ / телефон).');
    return;
  }

  // ставимо статус reserved
  for (const item of basket) {
    const k = item.key;
    seatState.set(k, { status:'reserved', subject, price:item.price, zone:item.zone, row:item.row, seat:item.seat });

    const btn = findSeatButton(item.row, item.seat, item.zone);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--sold');
      btn.classList.add('seat--reserved');
    }
  }

  // створюємо запис у реєстрі броней
  const reservId = 'R' + Date.now() + '-' + Math.floor(Math.random()*1000);
  const itemsCopy = basket.map(x => ({...x}));
  const total = itemsCopy.reduce((s,i)=>s+(i.price||0),0);

  reservations.push({
    id: reservId,
    subject,
    items: itemsCopy,
    total,
    ts: Date.now(),
    status: 'reserved'
  });

  basket = [];
  saveSeatStateToLS();
  saveReservationsToLS();
  updateBasketUI();
  renderReservations();
}

function applyUnreserve() {
  if (!basket.length) return;

  for (const item of basket) {
    const k = item.key;
    const st = seatState.get(k);
    if (st?.status === 'reserved') {
      seatState.set(k, { ...st, status:'free', subject:'' });

      const btn = findSeatButton(item.row, item.seat, item.zone);
      if (btn) btn.classList.remove('seat--selected', 'seat--reserved', 'seat--sold');
    }
  }

  // також чистимо реєстр броней: прибрати місця, які зняли
  for (const r of reservations) {
    r.items = r.items.filter(it => {
      const k = seatKey(it.row, it.seat, it.zone);
      return (seatState.get(k)?.status === 'reserved');
    });
  }
  reservations = reservations.filter(r => r.items.length > 0);
  for (const r of reservations) r.total = r.items.reduce((s,i)=>s+(i.price||0),0);

  basket = [];
  saveSeatStateToLS();
  saveReservationsToLS();
  updateBasketUI();
  renderReservations();
}

function clearBasketOnly() {
  for (const item of basket) {
    const btn = findSeatButton(item.row, item.seat, item.zone);
    if (btn) btn.classList.remove('seat--selected');
  }
  basket = [];
  updateBasketUI();
}

// ===== Сеанси: UI =====
function formatSessionLabel(s){
  const when = [s.date, s.time].filter(Boolean).join(' ');
  const stage = s.stage ? ` • ${s.stage}` : '';
  return `${when} • ${s.title || s.show}${stage}`;
}

function setTopInfo(){
  const showEl = document.getElementById('admin-current-show');
  const dateEl = document.getElementById('admin-current-date');

  if (showEl){
    if (!CURRENT_SESSION) showEl.textContent = 'Сеанс: —';
    else showEl.textContent = `Сеанс: ${CURRENT_SESSION.title || CURRENT_SESSION.show} • ${CURRENT_SESSION.date || ''} ${CURRENT_SESSION.time || ''} • ${CURRENT_SESSION.stage || ''}`.trim();
  }
  if (dateEl){
    dateEl.textContent = new Date().toLocaleString('uk-UA');
  }
}

async function applySession(sess){
  CURRENT_SESSION = sess;

  // підвантажуємо схему залу (поки одна, але під hall_id)
  await loadHallSchema(sess.hall_id || 'shevchenko-big');

  // підвантажуємо дані зі сховища
  loadSeatStateFromLS();
  loadReservationsFromLS();

  // перерендер залу
  renderHall(hallSchema);

  // оновлення верхніх написів
  setTopInfo();

  // чистимо кошик
  basket = [];
  updateBasketUI();

  // реєстр броней
  renderReservations();
}

// ===== Escape =====
function escapeHtml(s){
  return String(s || '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

// ===== Ініціалізація =====
async function initAdminPage() {
  await loadSettings();

  // назва театру в шапці (якщо є)
  const nameEl = document.getElementById('admin-theatre-name');
  if (nameEl && SETTINGS?.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  // валюта
  const curEl = document.getElementById('basket-currency');
  if (curEl) curEl.textContent = CURRENCY;

  // завантажуємо список сеансів
  const sessions = await loadSessionsList();
  const select = document.getElementById('sessionSelect');

  select.innerHTML = '';
  if (!sessions.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Немає подій у afisha.json';
    select.appendChild(opt);
    return;
  }

  sessions.forEach((s, idx)=>{
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = formatSessionLabel(s);
    select.appendChild(opt);
  });

  select.addEventListener('change', async ()=>{
    const idx = Number(select.value);
    const s = sessions[idx];
    if (!s) return;

    await applySession({
      id: idx,
      show: s.show || '',
      title: s.title || s.show || '',
      date: s.date || '',
      time: s.time || '',
      stage: s.stage || '',
      hall_id: s.hall_id || 'shevchenko-big'
    });
  });

  // вибираємо перший сеанс за замовчуванням
  select.value = '0';
  await applySession({
    id: 0,
    show: sessions[0].show || '',
    title: sessions[0].title || sessions[0].show || '',
    date: sessions[0].date || '',
    time: sessions[0].time || '',
    stage: sessions[0].stage || '',
    hall_id: sessions[0].hall_id || 'shevchenko-big'
  });

  // кнопки
  document.getElementById('btn-sell')?.addEventListener('click', applySell);
  document.getElementById('btn-reserve')?.addEventListener('click', applyReserve);
  document.getElementById('btn-unreserve')?.addEventListener('click', applyUnreserve);
  document.getElementById('btn-clear')?.addEventListener('click', clearBasketOnly);

  updateBasketUI();
  renderReservations();
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminPage().catch(err => console.error('Помилка ініціалізації адмінки', err));
});
