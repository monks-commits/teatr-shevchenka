// admin/admin.js

// === Глобальні налаштування ===
let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};

// Ключі для localStorage (якщо захочеш зберігати стан між оновленнями)
const LS_KEY_STATE = 'shev_admin_state_v1';

// Структури в пам'яті
let hallSchema = null;         // shevchenko-big.json
const seatState = new Map();   // "row-seat" -> 'free' | 'sold' | 'reserved'
let basket = [];               // [{key,row,seat,zone,price,label}]

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
    default: return zone;
  }
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
    if (status === 'sold') {
      return; // продане — не чіпаємо
    }

    // якщо було вибрано — прибираємо з кошика
    const inBasketIndex = basket.findIndex(i => i.key === key);
    if (inBasketIndex >= 0) {
      basket.splice(inBasketIndex, 1);
      btn.classList.remove('seat--selected');
    } else {
      // додаємо до кошика, якщо місце вільне або в броні
      const label = `${row} ряд, місце ${seat} (${getZoneLabel(zone)})`;
      basket.push({
        key,
        row,
        seat,
        zone,
        price,
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

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Партер';
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

    // ліва половина
    const leftCount = r.seats_left || 0;
    for (let i = 1; i <= leftCount; i++) {
      const seatEl = createSeatElement(r, r.row, i, 'amphi', i);
      sr.appendChild(seatEl);
    }

    // проміжок
    const gap = document.createElement('div');
    gap.className = 'amphi-gap';
    sr.appendChild(gap);

    // права половина (якщо є)
    const rightCount = r.seats_right || 0;
    for (let i = 1; i <= rightCount; i++) {
      const seatNumber = leftCount + i;
      const seatEl = createSeatElement(r, r.row, seatNumber, 'amphi', seatNumber);
      sr.appendChild(seatEl);
    }

    line.appendChild(sr);
    container.appendChild(line);
  }

  return container;
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
      // 6-й ряд: 10 + прохід + 10
      const leftCount = r.seats_left;
      const rightCount = r.seats_right;

      for (let i = 1; i <= leftCount; i++) {
        const seatEl = createSeatElement(r, r.row, i, 'balcony', i);
        sr.appendChild(seatEl);
      }

      const gap = document.createElement('div');
      gap.className = 'amphi-gap';
      sr.appendChild(gap);

      for (let i = 1; i <= rightCount; i++) {
        const seatNumber = leftCount + i;
        const seatEl = createSeatElement(r, r.row, seatNumber, 'balcony', seatNumber);
        sr.appendChild(seatEl);
      }
    } else {
      // звичайні ряди 1–5: 28 місць, прохід після 14
      const seatsCount = r.seats || 0;
      for (let i = 1; i <= seatsCount; i++) {
        const seatEl = createSeatElement(r, r.row, i, 'balcony', i);
        if (r.aisle_after && i === r.aisle_after) {
          seatEl.classList.add('seat--gap-right');
        }
        sr.appendChild(seatEl);
      }
    }

    line.appendChild(sr);
    container.appendChild(line);
  }

  section.appendChild(container);
  return section;
}

function renderHall(schema) {
  const root = document.getElementById('hall-root');
  if (!root) return;
  root.innerHTML = '';

  const rowsParter = schema.rows.filter(r => r.zone === 'parter');
  const rowsAmphi = schema.rows.filter(r => r.zone === 'amphi');
  const rowsBalcony = schema.rows.filter(r => r.zone === 'balcony');

  // Партер
  renderParter(root, rowsParter);

  // Амфітеатр
  const amphiWrap = document.createElement('div');
  renderAmphi(amphiWrap, rowsAmphi);
  const amphiSection = document.createElement('section');
  amphiSection.className = 'hall-section';
  const amphiTitle = document.createElement('div');
  amphiTitle.className = 'hall-section-title';
  amphiTitle.textContent = 'Амфітеатр';
  amphiSection.appendChild(amphiTitle);
  amphiSection.appendChild(amphiWrap);
  root.appendChild(amphiSection);

  // Балкон
  const balconyWrap = document.createElement('div');
  const balconySection = renderBalcony(balconyWrap, rowsBalcony);
  root.appendChild(balconySection);
}

// === Оновлення UI кошика ===
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

  if (curEl) {
    curEl.textContent = CURRENCY;
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
  }
  basket = [];
  updateBasketUI();
}

function applyReserve() {
  if (!basket.length) return;
  for (const item of basket) {
    const key = item.key;
    seatState.set(key, 'reserved');

    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected', 'seat--sold');
      btn.classList.add('seat--reserved');
    }
  }
  basket = [];
  updateBasketUI();
}

function applyUnreserve() {
  if (!basket.length) return;
  // Тільки знімаємо бронь, продані не чіпаємо
  for (const item of basket) {
    const key = item.key;
    const status = seatState.get(key);
    if (status === 'reserved') {
      seatState.set(key, 'free');
      const btn = findSeatButton(item.row, item.seat);
      if (btn) {
        btn.classList.remove('seat--selected', 'seat--reserved', 'seat--sold');
      }
    }
  }
  basket = [];
  updateBasketUI();
}

function clearBasketOnly() {
  // Лише очищаємо вибір, статуси місць не чіпаємо
  for (const item of basket) {
    const btn = findSeatButton(item.row, item.seat);
    if (btn) {
      btn.classList.remove('seat--selected');
    }
  }
  basket = [];
  updateBasketUI();
}

function findSeatButton(row, seat) {
  const buttons = document.querySelectorAll('.seat');
  for (const b of buttons) {
    if (Number(b.dataset.row) === row && Number(b.dataset.seat) === seat) {
      return b;
    }
  }
  return null;
}

// === Ініціалізація ===
async function initAdminPage() {
  await loadSettings();
  const schema = await loadHallSchema();

  // Назва театру / валюта в шапці
  const nameEl = document.getElementById('admin-theatre-name');
  if (nameEl && SETTINGS.theatre && SETTINGS.theatre.name) {
    nameEl.textContent = SETTINGS.theatre.name;
  }
  const subEl = document.getElementById('admin-theatre-subtitle');
  if (subEl) {
    subEl.textContent = 'Панель касира / адміністратора';
  }

  // Можемо в майбутньому підтягувати конкретний сеанс з URL (?show=...&date=...)
  const showEl = document.getElementById('admin-current-show');
  if (showEl) {
    showEl.textContent = 'Сеанс: демо-режим (тільки каса)';
  }
  const dateEl = document.getElementById('admin-current-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleString('uk-UA');
  }

  // Малюємо схему
  renderHall(schema);

  // Вішаємо обробники на кнопки
  const btnSell = document.getElementById('btn-sell');
  const btnReserve = document.getElementById('btn-reserve');
  const btnUnreserve = document.getElementById('btn-unreserve');
  const btnClear = document.getElementById('btn-clear');

  if (btnSell) btnSell.addEventListener('click', applySell);
  if (btnReserve) btnReserve.addEventListener('click', applyReserve);
  if (btnUnreserve) btnUnreserve.addEventListener('click', applyUnreserve);
  if (btnClear) btnClear.addEventListener('click', clearBasketOnly);

  updateBasketUI();
}

// Старт після завантаження DOM
document.addEventListener('DOMContentLoaded', () => {
  initAdminPage().catch(err => {
    console.error('Помилка ініціалізації адмінки', err);
  });
});
