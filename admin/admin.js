// admin/admin.js
// Простая офлайн-панель кассира для великої сцени Театру Шевченка

(() => {
  const HALL_JSON = '../data/halls/shevchenko-big.json';
  const SEANCE_JSON = '../data/seances/visim-2025-12-28.json';
  const LS_KEY = 'tshev_admin_demo_places_visim_2025_12_28';

  const STATUS = {
    FREE: 'free',
    SOLD: 'sold',
    HOLD: 'hold',
    SERVICE: 'service',
  };

  /** Текущее состояние */
  const state = {
    hall: null,          // конфиг зала
    prices: {},          // группы цен -> грн
    placeStatus: {},     // { "row-seat": { status, channel?, comment? } }
    basket: {},          // выбранные места: key -> info
  };

  // Утилиты
  const keyFor = (row, seat) => `${row}-${seat}`;

  const hallInner = () => document.getElementById('hall-inner');
  const basketBody = () => document.getElementById('basket-body');
  const basketCountEl = () => document.getElementById('basket-count');
  const basketAmountEl = () => document.getElementById('basket-amount');

  // ============= Загрузка данных =============

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  async function loadData() {
    const [hall, seance] = await Promise.allSettled([
      loadJSON(HALL_JSON),
      loadJSON(SEANCE_JSON),
    ]);

    if (hall.status === 'fulfilled') {
      state.hall = hall.value;
    } else {
      console.error('Не вдалося завантажити конфіг залу', hall.reason);
    }

    if (seance.status === 'fulfilled') {
      state.prices = seance.value.prices || {};
      state.placeStatus = seance.value.places || {};
    } else {
      console.warn('Не вдалося завантажити дані сеансу, йдемо з пустими статусами');
      state.prices = {};
      state.placeStatus = {};
    }

    // Применяем локальное сохранение (офлайн-режим)
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const fromLs = JSON.parse(raw);
        Object.assign(state.placeStatus, fromLs);
      }
    } catch (e) {
      console.warn('Помилка читання localStorage', e);
    }
  }

  // ============= Рендер схемы зала =============

  function renderHall() {
    const root = hallInner();
    if (!root || !state.hall) return;

    root.innerHTML = '';

    const rows = state.hall.rows || [];
    const zonesOrder = ['parter', 'amphi', 'balcony'];

    const zoneLabels = {
      parter: 'Партер',
      amphi: 'Амфітеатр',
      balcony: 'Балкон',
    };

    const zoneContainers = {};

    zonesOrder.forEach(zone => {
      const section = document.createElement('section');
      section.className = 'hall-section';

      const title = document.createElement('div');
      title.className = 'hall-section-title';
      title.textContent = zoneLabels[zone] || zone;

      const body = document.createElement('div');

      // Амфітеатр і балкон центруємо, як у глядацькій схемі
      if (zone === 'amphi' || zone === 'balcony') {
        body.classList.add('hall-center');
      }

      section.appendChild(title);
      section.appendChild(body);

      root.appendChild(section);
      zoneContainers[zone] = body;
    });

    // Отдельно создадим ложи
    const parterSection = document.createElement('section');
    parterSection.className = 'hall-section';
    const parterTitle = document.createElement('div');
    parterTitle.className = 'hall-section-title';
    parterTitle.textContent = 'Партер та ложі';
    parterSection.appendChild(parterTitle);

    const parterWrap = document.createElement('div');
    parterWrap.className = 'parter-wrap';

    const lodgeAL = createLodgeColumn('Ложа А', 'A');
    const lodgeBL = createLodgeColumn('Ложа Б', 'B');

    const parterBody = document.createElement('div');
    parterWrap.appendChild(lodgeAL);
    parterWrap.appendChild(parterBody);
    parterWrap.appendChild(lodgeBL);
    parterSection.appendChild(parterWrap);

    // Заменяем стандартную "Партер" на наш составной блок
    const parterContainer = zoneContainers['parter'];
    if (parterContainer?.parentElement) {
      parterContainer.parentElement.replaceWith(parterSection);
      zoneContainers['parter'] = parterBody;
    } else {
      root.prepend(parterSection);
      zoneContainers['parter'] = parterBody;
    }

    // Рисуем ряды
    for (const rowCfg of rows) {
      const zone = rowCfg.zone;
      const zoneEl = zoneContainers[zone];
      if (!zoneEl) continue;

      const rowLine = document.createElement('div');
      rowLine.className = 'row-line';

      const label = document.createElement('div');
      label.className = 'row-label';
      label.textContent = rowCfg.row;
      rowLine.appendChild(label);

      const seatsRow = document.createElement('div');
      seatsRow.className = 'seats-row';

      if (typeof rowCfg.seats === 'number') {
        for (let s = 1; s <= rowCfg.seats; s++) {
          const seatEl = makeSeat(zone, rowCfg.row, s, rowCfg);
          if (rowCfg.aisle_after && s === rowCfg.aisle_after) {
            seatEl.classList.add('seat--gap-right');
          }
          seatsRow.appendChild(seatEl);
        }
      } else if (
        typeof rowCfg.seats_left === 'number' &&
        typeof rowCfg.seats_right === 'number'
      ) {
        const total = rowCfg.seats_left + rowCfg.seats_right;
        for (let s = 1; s <= total; s++) {
          const seatEl = makeSeat(zone, rowCfg.row, s, rowCfg);
          if (s === rowCfg.seats_left) {
            seatEl.classList.add('seat--gap-right');
          }
          seatsRow.appendChild(seatEl);
        }
      }

      rowLine.appendChild(seatsRow);
      zoneEl.appendChild(rowLine);
    }

    // Ложі — просто 18 вертикальних місць зліва/справа
    fillLodgeSeats(lodgeAL.querySelector('.hall-lodge-seats'), 'boxA');
    fillLodgeSeats(lodgeBL.querySelector('.hall-lodge-seats'), 'boxB');
  }

  function createLodgeColumn(labelText, side) {
    const wrapper = document.createElement('div');
    wrapper.className = 'hall-lodge';

    const label = document.createElement('div');
    label.className = 'hall-lodge-label';
    label.textContent = labelText;
    wrapper.appendChild(label);

    const list = document.createElement('div');
    list.className = 'hall-lodge-seats';
    wrapper.appendChild(list);

    return wrapper;
  }

  function fillLodgeSeats(container, boxKey) {
    if (!container) return;
    for (let i = 1; i <= 18; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seat seat--lodge';
      btn.textContent = i;
      btn.dataset.zone = 'boxes';
      btn.dataset.box = boxKey;
      btn.dataset.row = boxKey;
      btn.dataset.seat = i;
      attachSeatHandlers(btn);
      applySeatVisual(btn);
      container.appendChild(btn);
    }
  }

  function makeSeat(zone, row, seat, rowCfg) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seat';
    btn.textContent = seat;
    btn.dataset.zone = zone;
    btn.dataset.row = row;
    btn.dataset.seat = seat;

    // Раскраска по зонам/рядах
    if (zone === 'parter') {
      if (row >= 1 && row <= 6) btn.classList.add('seat--parter-front');
      else if (row >= 7 && row <= 12) btn.classList.add('seat--parter-mid');
      else btn.classList.add('seat--parter-back');
    } else if (zone === 'amphi') {
      btn.classList.add('seat--amphi');
    } else if (zone === 'balcony') {
      btn.classList.add('seat--balcony');
    }

    attachSeatHandlers(btn);
    applySeatVisual(btn);
    return btn;
  }

  // ============= Статусы и корзина =============

  function getStatusForSeat(row, seat, boxKey) {
    if (boxKey) {
      const k = `${boxKey}-${seat}`;
      return state.placeStatus[k]?.status || STATUS.FREE;
    }
    const k = keyFor(row, seat);
    return state.placeStatus[k]?.status || STATUS.FREE;
  }

  function setStatusForSeat(row, seat, status, extra = {}) {
    const k = keyFor(row, seat);
    if (!state.placeStatus[k]) state.placeStatus[k] = {};
    state.placeStatus[k].status = status;
    Object.assign(state.placeStatus[k], extra);
  }

  function attachSeatHandlers(btn) {
    btn.addEventListener('click', () => {
      const row = btn.dataset.row;
      const seat = btn.dataset.seat;
      const zone = btn.dataset.zone;
      const box = btn.dataset.box || null;

      const s = getStatusForSeat(row, seat, box);
      if (s === STATUS.SOLD || s === STATUS.SERVICE) {
        return; // недоступні
      }

      const key = box ? `${box}-${seat}` : keyFor(row, seat);
      if (state.basket[key]) {
        delete state.basket[key];
      } else {
        state.basket[key] = {
          row,
          seat,
          zone,
          box,
          price: calcSeatPrice(zone, row),
        };
      }

      redrawAllSeats();
      renderBasket();
    });
  }

  function applySeatVisual(btn) {
    btn.classList.remove('seat--sold', 'seat--hold', 'seat--service', 'seat--basket');

    const row = btn.dataset.row;
    const seat = btn.dataset.seat;
    const box = btn.dataset.box || null;
    const status = getStatusForSeat(row, seat, box);

    const key = box ? `${box}-${seat}` : keyFor(row, seat);
    if (state.basket[key]) {
      btn.classList.add('seat--basket');
    }

    if (status === STATUS.SOLD) btn.classList.add('seat--sold');
    else if (status === STATUS.HOLD) btn.classList.add('seat--hold');
    else if (status === STATUS.SERVICE) btn.classList.add('seat--service');
  }

  function redrawAllSeats() {
    document.querySelectorAll('.seat').forEach(applySeatVisual);
  }

  function calcSeatPrice(zone, row) {
    // По зонам + рядам -> группа
    let group = null;
    if (zone === 'parter') {
      if (row >= 1 && row <= 6) group = 'p_parter_1_6';
      else if (row >= 7 && row <= 12) group = 'p_parter_7_12';
      else group = 'p_parter_13_18';
    } else if (zone === 'amphi') {
      group = 'p_amphi_all';
    } else if (zone === 'balcony') {
      if (row === 6) group = 'p_balcony_6';
      else group = 'p_balcony_1_5';
    } else if (zone === 'boxes') {
      group = 'p_boxes';
    }
    return state.prices[group] || 0;
  }

  function renderBasket() {
    const tbody = basketBody();
    tbody.innerHTML = '';

    const items = Object.values(state.basket);
    let total = 0;
    items.forEach((item, idx) => {
      total += item.price || 0;
      const tr = document.createElement('tr');

      const zoneLabel =
        item.zone === 'parter' ? 'Партер' :
        item.zone === 'amphi' ? 'Амфітеатр' :
        item.zone === 'balcony' ? 'Балкон' :
        'Ложа';

      const rowOrBox = item.box ? item.box.toUpperCase() : item.row;

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${zoneLabel}</td>
        <td>${rowOrBox}</td>
        <td>${item.seat}</td>
        <td>${item.price || 0}</td>
      `;
      tbody.appendChild(tr);
    });

    basketCountEl().textContent = items.length;
    basketAmountEl().textContent = total;

    const disabled = items.length === 0;
    document.getElementById('btn-sell').disabled = disabled;
    document.getElementById('btn-hold').disabled = disabled;
    document.getElementById('btn-unhold').disabled = disabled;
  }

  function persistToLocalStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.placeStatus));
    } catch (e) {
      console.warn('Не вдалося зберегти у localStorage', e);
    }
  }

  // ============= Обработчики кнопок =============

  function setupButtons() {
    const btnSell = document.getElementById('btn-sell');
    const btnHold = document.getElementById('btn-hold');
    const btnUnhold = document.getElementById('btn-unhold');
    const btnClear = document.getElementById('btn-clear');

    btnSell.addEventListener('click', () => {
      const items = Object.values(state.basket);
      items.forEach(it => {
        if (it.box) {
          // ложі отдельным ключом не храним, просто отметим как sold в placeStatus по псевдо-ключу
          const k = `${it.box}-${it.seat}`;
          state.placeStatus[k] = { status: STATUS.SOLD, channel: 'boxoffice' };
        } else {
          setStatusForSeat(it.row, it.seat, STATUS.SOLD, { channel: 'boxoffice' });
        }
      });
      state.basket = {};
      persistToLocalStorage();
      redrawAllSeats();
      renderBasket();
    });

    btnHold.addEventListener('click', () => {
      const items = Object.values(state.basket);
      items.forEach(it => {
        if (it.box) {
          const k = `${it.box}-${it.seat}`;
          state.placeStatus[k] = { status: STATUS.HOLD, comment: 'бронь (каса)' };
        } else {
          setStatusForSeat(it.row, it.seat, STATUS.HOLD, { comment: 'бронь (каса)' });
        }
      });
      state.basket = {};
      persistToLocalStorage();
      redrawAllSeats();
      renderBasket();
    });

    btnUnhold.addEventListener('click', () => {
      const items = Object.values(state.basket);
      items.forEach(it => {
        if (it.box) {
          const k = `${it.box}-${it.seat}`;
          if (state.placeStatus[k]?.status === STATUS.HOLD) {
            delete state.placeStatus[k];
          }
        } else {
          const k = keyFor(it.row, it.seat);
          if (state.placeStatus[k]?.status === STATUS.HOLD) {
            delete state.placeStatus[k];
          }
        }
      });
      state.basket = {};
      persistToLocalStorage();
      redrawAllSeats();
      renderBasket();
    });

    btnClear.addEventListener('click', () => {
      state.basket = {};
      renderBasket();
      redrawAllSeats();
    });
  }

  // ============= Инициализация =============

  async function init() {
    try {
      await loadData();
      renderHall();
      setupButtons();
      renderBasket();
    } catch (e) {
      console.error('Помилка ініціалізації адмінки', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
