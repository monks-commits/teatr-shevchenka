// admin/admin.js

// ================= БАЗОВЫЕ НАСТРОЙКИ =================

const HALL_CONFIG_URL = "/teatr-shevchenka/data/halls/shevchenko-big.json";

// Для демо-режима: локальный "сеанс" и localStorage ключ
const DEMO_SEANCE_ID = "visim-2025-12-28";
const LS_KEY = "teatr_shevchenka_admin_demo_places";

// ================= СОСТОЯНИЕ ПРИЛОЖЕНИЯ =================

/**
 * hallConfig.rows -> массив строк схемы
 * prices -> словарь групп цен
 */
let hallConfig = null;

/**
 * placesState: объект
 *   ключ: seatId (формат "row-seat" или "boxA-5")
 *   значение: { status, channel?, order_id?, comment?, agent? }
 *
 * В демо мы храним это ТОЛЬКО в localStorage.
 * В реальной интеграции это будет прилетать с Supabase.
 */
let placesState = {};

/**
 * cart: выбранные места в текущей сессии кассира
 *   массив seatId: ["1-5","1-6", ...]
 */
let cart = [];

/**
 * offline / online режим.
 * Пока вся логика — офлайн; флаг просто для интерфейса.
 */
let isOffline = true;

// ================= УТИЛИТЫ =================

function qs(selector, root = document) {
  return root.querySelector(selector);
}
function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error("LS parse error", e);
    return {};
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(placesState));
  } catch (e) {
    console.error("LS save error", e);
  }
}

/**
 * Цена для места по row / zone / price_group
 */
function getSeatPrice(rowNum, zone, priceGroupKey) {
  if (!hallConfig || !hallConfig.prices) return 0;

  // price_group уже лежит в строке, но можно переопределить логикой,
  // если театр захочет другую модель
  const groupKey = priceGroupKey;

  const v = hallConfig.prices[groupKey];
  return typeof v === "number" ? v : 0;
}

/**
 * Читает состояние места с учетом дефолта.
 * Если места нет в placesState -> считаем "free".
 */
function getPlaceStatus(seatId) {
  const p = placesState[seatId];
  if (!p) return { status: "free" };
  return p;
}

/**
 * Обновляет статус в памяти и (в демо) сразу в localStorage.
 */
function setPlaceStatus(seatId, nextStatusObj) {
  placesState[seatId] = {
    ...(placesState[seatId] || {}),
    ...nextStatusObj,
  };
}

// ================= ОТРИСОВКА ЗАЛА =================

/**
 * Создает DOM-элемент "кружок" для конкретного места
 */
function createSeatElement(rowConfig, seatIndex, rowIndex) {
  const zone = rowConfig.zone; // parter / amphi / balcony / box
  const rowNum = rowConfig.row; // номер ряда (1..N)
  const seatsCount = rowConfig.seats;

  // seatIndex: 0..(seatsCount-1)
  const seatNumber = seatIndex + 1;

  let seatId = `${rowNum}-${seatNumber}`;
  if (zone === "boxA") {
    seatId = `boxA-${seatNumber}`;
  } else if (zone === "boxB") {
    seatId = `boxB-${seatNumber}`;
  }

  const seat = document.createElement("button");
  seat.type = "button";
  seat.className = "seat";
  seat.dataset.seatId = seatId;
  seat.dataset.zone = zone;
  seat.dataset.row = String(rowNum);
  seat.dataset.number = String(seatNumber);

  seat.textContent = String(seatNumber);

  // статус и класс
  const state = getPlaceStatus(seatId);
  updateSeatClasses(seat, state.status);

  // обработчик клика — добавляем / убираем seatId в cart
  seat.addEventListener("click", () => handleSeatClick(seat));

  return seat;
}

/**
 * Обновление CSS-классов для seat-элемента
 */
function updateSeatClasses(el, status) {
  el.classList.remove(
    "seat--free",
    "seat--in-cart",
    "seat--sold",
    "seat--reserved",
    "seat--blocked"
  );

  switch (status) {
    case "sold":
      el.classList.add("seat--sold");
      el.disabled = true;
      break;
    case "reserved":
      el.classList.add("seat--reserved");
      el.disabled = false;
      break;
    case "blocked":
      el.classList.add("seat--blocked");
      el.disabled = true;
      break;
    default:
      // free
      el.classList.add("seat--free");
      el.disabled = false;
  }
}

/**
 * Основной рендер зала
 */
function renderHall() {
  const hallRoot = qs("[data-hall-root]");
  if (!hallRoot || !hallConfig) return;

  hallRoot.innerHTML = "";

  const rowsWrapper = document.createElement("div");
  rowsWrapper.className = "hall-admin";

  hallConfig.rows.forEach((rowConfig) => {
    const rowEl = document.createElement("div");
    rowEl.className = "hall-admin__row";

    const label = document.createElement("div");
    label.className = "hall-admin__row-label";
    label.textContent =
      rowConfig.rowLabel || `Ряд ${rowConfig.row}${zoneSuffix(rowConfig.zone)}`;

    rowEl.appendChild(label);

    // левая часть (для проходов / пустот)
    if (rowConfig.seats_left && rowConfig.seats_left > 0) {
      const leftStub = document.createElement("div");
      leftStub.className = "hall-admin__stub";
      for (let i = 0; i < rowConfig.seats_left; i++) {
        const seatStub = document.createElement("span");
        seatStub.className = "seat seat--stub";
        leftStub.appendChild(seatStub);
      }
      rowEl.appendChild(leftStub);
    }

    const seatsContainer = document.createElement("div");
    seatsContainer.className = "hall-admin__seats";

    for (let i = 0; i < rowConfig.seats; i++) {
      const seat = createSeatElement(rowConfig, i);
      seatsContainer.appendChild(seat);
    }
    rowEl.appendChild(seatsContainer);

    if (rowConfig.seats_right && rowConfig.seats_right > 0) {
      const rightStub = document.createElement("div");
      rightStub.className = "hall-admin__stub";
      for (let i = 0; i < rowConfig.seats_right; i++) {
        const seatStub = document.createElement("span");
        seatStub.className = "seat seat--stub";
        rightStub.appendChild(seatStub);
      }
      rowEl.appendChild(rightStub);
    }

    rowsWrapper.appendChild(rowEl);
  });

  hallRoot.appendChild(rowsWrapper);
}

/**
 * Надпись для ряда: " (Ложа A)" и т.п., если надо.
 */
function zoneSuffix(zone) {
  switch (zone) {
    case "parter":
      return " (Партер)";
    case "amphi":
      return " (Амфітеатр)";
    case "balcony":
      return " (Балкон)";
    case "boxA":
      return " (Ложа A)";
    case "boxB":
      return " (Ложа Б)";
    default:
      return "";
  }
}

// ================= ЛОГИКА КОРЗИНЫ =================

/**
 * При клике по месту
 */
function handleSeatClick(seatEl) {
  const seatId = seatEl.dataset.seatId;
  const current = getPlaceStatus(seatId);

  if (current.status === "sold" || current.status === "blocked") {
    // уже продано / заблокировано — кассир не может трогать
    return;
  }

  // toggle: если уже в cart -> убрать, иначе добавить
  const idx = cart.indexOf(seatId);
  if (idx >= 0) {
    cart.splice(idx, 1);
    // вернуть визуально к своему "базовому" статусу
    updateSeatClasses(seatEl, current.status);
  } else {
    cart.push(seatId);
    seatEl.classList.add("seat--in-cart");
  }

  renderCart();
}

/**
 * Пересчет корзины (табличка справа)
 */
function renderCart() {
  const tbody = qs("[data-cart-body]");
  const totalSpan = qs("[data-cart-total]");
  const countSpan = qs("[data-cart-count]");

  if (!tbody) return;

  tbody.innerHTML = "";
  let total = 0;

  cart.forEach((seatId, idx) => {
    const state = getPlaceStatus(seatId);
    const info = parseSeatId(seatId); // {row, seat, zone}
    const rowConfig = hallConfig.rows.find(
      (r) => r.row === info.row && r.zone === info.zone
    );
    if (!rowConfig) return;

    const price = getSeatPrice(rowConfig.row, info.zone, rowConfig.price_group);
    total += price;

    const tr = document.createElement("tr");

    const colIdx = document.createElement("td");
    colIdx.textContent = String(idx + 1);
    tr.appendChild(colIdx);

    const colZone = document.createElement("td");
    colZone.textContent = zoneLabel(info.zone);
    tr.appendChild(colZone);

    const colRow = document.createElement("td");
    colRow.textContent =
      info.zone === "boxA" || info.zone === "boxB"
        ? `Ложа ${info.zone === "boxA" ? "A" : "Б"}`
        : `Ряд ${info.row}`;
    tr.appendChild(colRow);

    const colSeat = document.createElement("td");
    colSeat.textContent =
      info.zone === "boxA" || info.zone === "boxB"
        ? `Місце ${info.seat}`
        : `Місце ${info.seat}`;
    tr.appendChild(colSeat);

    const colPrice = document.createElement("td");
    colPrice.textContent = `${price} грн`;
    tr.appendChild(colPrice);

    tbody.appendChild(tr);
  });

  if (totalSpan) totalSpan.textContent = String(total);
  if (countSpan) countSpan.textContent = String(cart.length);
}

/**
 * Разбор seatId вида "10-12" или "boxA-5"
 */
function parseSeatId(seatId) {
  if (seatId.startsWith("boxA-")) {
    return {
      zone: "boxA",
      row: 0,
      seat: Number(seatId.split("-")[1]),
    };
  }
  if (seatId.startsWith("boxB-")) {
    return {
      zone: "boxB",
      row: 0,
      seat: Number(seatId.split("-")[1]),
    };
  }

  const [rowStr, seatStr] = seatId.split("-");
  return {
    zone: detectZoneByRow(Number(rowStr)),
    row: Number(rowStr),
    seat: Number(seatStr),
  };
}

/**
 * По номеру ряда определяем зону (для подписи).
 * В идеале лучше хранить в конфиге hallConfig.rows.
 */
function detectZoneByRow(rowNum) {
  const rowCfg = hallConfig.rows.find((r) => r.row === rowNum);
  return rowCfg ? rowCfg.zone : "parter";
}

function zoneLabel(zone) {
  switch (zone) {
    case "parter":
      return "Партер";
    case "amphi":
      return "Амфітеатр";
    case "balcony":
      return "Балкон";
    case "boxA":
      return "Ложа A";
    case "boxB":
      return "Ложа Б";
    default:
      return zone;
  }
}

// ================= ДЕЙСТВИЯ КАССИРА =================

/**
 * Продажа мест (офлайн).
 * В демо меняем статус на 'sold' и пишем channel: 'boxoffice'
 */
function sellSeatsFromCart() {
  if (!cart.length) return;

  cart.forEach((seatId) => {
    setPlaceStatus(seatId, {
      status: "sold",
      channel: "boxoffice",
      // order_id можно сгенерить здесь, но для демо опустим
    });

    const btn = qs(`.seat[data-seat-id="${seatId}"]`);
    if (btn) {
      updateSeatClasses(btn, "sold");
      btn.classList.remove("seat--in-cart");
    }
  });

  saveToLocalStorage();
  cart = [];
  renderCart();
}

/**
 * Поставить выбранные места на бронь
 */
function reserveSeatsFromCart() {
  if (!cart.length) return;

  cart.forEach((seatId) => {
    setPlaceStatus(seatId, {
      status: "reserved",
      channel: "cash",
    });

    const btn = qs(`.seat[data-seat-id="${seatId}"]`);
    if (btn) {
      updateSeatClasses(btn, "reserved");
      btn.classList.remove("seat--in-cart");
    }
  });

  saveToLocalStorage();
  cart = [];
  renderCart();
}

/**
 * Снять бронь со всех мест, которые сейчас в корзине
 * (и которые реально находятся в статусе "reserved").
 */
function cancelReserveFromCart() {
  if (!cart.length) return;

  cart.forEach((seatId) => {
    const prev = getPlaceStatus(seatId);
    if (prev.status === "reserved") {
      setPlaceStatus(seatId, {
        status: "free",
        channel: null,
        order_id: null,
        comment: null,
        agent: null,
      });

      const btn = qs(`.seat[data-seat-id="${seatId}"]`);
      if (btn) {
        updateSeatClasses(btn, "free");
        btn.classList.remove("seat--in-cart");
      }
    } else {
      // если был не reserved — просто убираем из корзины, не трогая статус
      const btn = qs(`.seat[data-seat-id="${seatId}"]`);
      if (btn) {
        btn.classList.remove("seat--in-cart");
      }
    }
  });

  saveToLocalStorage();
  cart = [];
  renderCart();
}

/**
 * Очистить корзину (не меняя статусы мест)
 */
function clearCartOnly() {
  cart.forEach((seatId) => {
    const state = getPlaceStatus(seatId);
    const btn = qs(`.seat[data-seat-id="${seatId}"]`);
    if (btn) {
      updateSeatClasses(btn, state.status);
      btn.classList.remove("seat--in-cart");
    }
  });

  cart = [];
  renderCart();
}

// ================= ИНИЦИАЛИЗАЦИЯ =================

async function init() {
  // Загружаем конфиг зала
  const hallRes = await fetch(HALL_CONFIG_URL, { cache: "no-store" });
  hallConfig = await hallRes.json();

  // Загружаем состояние мест из localStorage (только демо)
  placesState = loadFromLocalStorage();

  // Рендерим зал
  renderHall();
  renderCart();

  // Кнопки действий
  const btnSell = qs("#btnSell");
  const btnReserve = qs("#btnReserve");
  const btnCancelReserve = qs("#btnCancelReserve");
  const btnClearCart = qs("#btnClearCart");

  if (btnSell) btnSell.addEventListener("click", sellSeatsFromCart);
  if (btnReserve) btnReserve.addEventListener("click", reserveSeatsFromCart);
  if (btnCancelReserve)
    btnCancelReserve.addEventListener("click", cancelReserveFromCart);
  if (btnClearCart) btnClearCart.addEventListener("click", clearCartOnly);

  // Переключатель офлайн/онлайн — пока просто визуальный
  const offlineBtn = qs("#modeOffline");
  const onlineBtn = qs("#modeOnline");

  if (offlineBtn) {
    offlineBtn.addEventListener("click", () => {
      isOffline = true;
      offlineBtn.classList.add("mode-switch--active");
      if (onlineBtn) onlineBtn.classList.remove("mode-switch--active");
    });
  }
  if (onlineBtn) {
    onlineBtn.addEventListener("click", () => {
      isOffline = false;
      onlineBtn.classList.add("mode-switch--active");
      if (offlineBtn) offlineBtn.classList.remove("mode-switch--active");
      // в будущем здесь будет sync с сервером
    });
  }
}

// Запуск
document.addEventListener("DOMContentLoaded", init);
