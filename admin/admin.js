// admin/admin.js

// ----- НАСТРОЙКИ -----
const HALL_CONFIG_URL = "../data/halls/shevchenko-big.json";

// здесь можно дописать ещё сеансы
const SEANCES = [
  {
    id: "visim-2025-12-28",
    label: "«Вісім люблячих жінок» — 28.12.2025 16:00",
    url: "../data/seances/visim-2025-12-28.json",
  },
];

// ----- СОСТОЯНИЕ -----
let hallDef = null;        // конфиг зала
let currentSeance = null;  // объект сеанса (prices + places)
let places = {};           // ссылка на currentSeance.places
let selectedKeys = new Set();
let offlineMode = false;

// ----- ЭЛЕМЕНТЫ DOM -----
const hallContainer = document.getElementById("hallContainer");
const seanceSelect = document.getElementById("seanceSelect");
const sideShowTitle = document.getElementById("sideShowTitle");
const sideShowTime = document.getElementById("sideShowTime");
const basketBody = document.getElementById("basketBody");
const basketCount = document.getElementById("basketCount");
const sumCount = document.getElementById("sumCount");
const sumAmount = document.getElementById("sumAmount");
const offlineBadge = document.getElementById("offlineBadge");

const btnSell = document.getElementById("btnSell");
const btnReserve = document.getElementById("btnReserve");
const btnClear = document.getElementById("btnClear");
const btnModeOnline = document.getElementById("btnModeOnline");
const btnModeOffline = document.getElementById("btnModeOffline");

// ----- ИНИЦИАЛИЗАЦИЯ -----
init().catch((err) => console.error(err));

async function init() {
  // загрузка конфигурации зала
  hallDef = await fetchJson(HALL_CONFIG_URL);

  // заполнение селекта сеансов
  SEANCES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    seanceSelect.appendChild(opt);
  });

  seanceSelect.addEventListener("change", onSeanceChange);

  btnSell.addEventListener("click", () => applyStatusToSelection("sold"));
  btnReserve.addEventListener("click", () => applyStatusToSelection("reserved"));
  btnClear.addEventListener("click", clearSelection);

  btnModeOnline.addEventListener("click", () => setOfflineMode(false));
  btnModeOffline.addEventListener("click", () => setOfflineMode(true));

  // по умолчанию первый сеанс
  if (SEANCES.length) {
    await loadSeance(SEANCES[0]);
    seanceSelect.value = SEANCES[0].id;
  }

  setOfflineMode(false);
}

// ----- ЗАГРУЗКА СЕАНСА -----
async function loadSeance(meta) {
  const data = await fetchJson(meta.url);
  // дополним идентификатором для localStorage
  data._id = meta.id;
  currentSeance = data;

  // нормализуем структуру places
  if (!currentSeance.places) currentSeance.places = {};
  places = currentSeance.places;

  // подтянем локальные офлайн-изменения, если есть
  restoreFromLocalStorage();

  selectedKeys.clear();
  updateHeaderInfo();
  renderHall();
  renderBasket();
}

function onSeanceChange() {
  const id = seanceSelect.value;
  const meta = SEANCES.find((s) => s.id === id);
  if (meta) {
    loadSeance(meta).catch(console.error);
  }
}

// ----- ОТРИСОВКА ЗАЛА -----
function renderHall() {
  if (!hallDef || !currentSeance) return;

  const seancePlaces = places || {};
  hallContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "hall-layout";

  // партер
  const parterBlock = document.createElement("div");
  parterBlock.className = "hall-block";
  parterBlock.appendChild(caption("Партер"));

  hallDef.rows
    .filter((r) => r.zone === "parter")
    .forEach((rowDef) => {
      parterBlock.appendChild(renderRow(rowDef, seancePlaces));
    });

  // ложи
  if (hallDef.boxes && hallDef.boxes.length) {
    parterBlock.appendChild(renderBoxes(hallDef.boxes, seancePlaces));
  }

  layout.appendChild(parterBlock);

  // амфитеатр
  const amphiBlock = document.createElement("div");
  amphiBlock.className = "hall-block";
  amphiBlock.appendChild(caption("Амфітеатр"));

  hallDef.rows
    .filter((r) => r.zone === "amphi")
    .forEach((rowDef) => {
      amphiBlock.appendChild(renderRow(rowDef, seancePlaces));
    });

  layout.appendChild(amphiBlock);

  // балкон
  const balconyBlock = document.createElement("div");
  balconyBlock.className = "hall-block";
  balconyBlock.appendChild(caption("Балкон"));

  hallDef.rows
    .filter((r) => r.zone === "balcony")
    .forEach((rowDef) => {
      balconyBlock.appendChild(renderRow(rowDef, seancePlaces));
    });

  layout.appendChild(balconyBlock);

  hallContainer.appendChild(layout);
}

function caption(text) {
  const el = document.createElement("div");
  el.className = "hall-caption";
  el.textContent = text;
  return el;
}

function renderRow(rowDef, seancePlaces) {
  const rowEl = document.createElement("div");
  rowEl.className = "hall-row";

  const label = document.createElement("div");
  label.className = "hall-row-label";
  label.textContent = rowDef.row;
  rowEl.appendChild(label);

  const seatsWrap = document.createElement("div");
  seatsWrap.className = "hall-row-seats";

  // считаем количество мест и позицию прохода
  let totalSeats = 0;
  let aisleAfter = null;

  if (typeof rowDef.seats === "number") {
    totalSeats = rowDef.seats;
    aisleAfter = rowDef.aisle_after || null;
  } else {
    const left = rowDef.seats_left || 0;
    const right = rowDef.seats_right || 0;
    totalSeats = left + right;
    aisleAfter = left || null; // проход между левым и правым блоком
  }

  for (let seatNo = 1; seatNo <= totalSeats; seatNo++) {
    if (aisleAfter && seatNo === aisleAfter + 1) {
      const gap = document.createElement("div");
      gap.className = "hall-aisle";
      seatsWrap.appendChild(gap);
    }

    const key = `${rowDef.row}-${seatNo}`;
    const place = seancePlaces[key];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seat";
    btn.textContent = seatNo;
    btn.dataset.key = key;
    btn.dataset.row = String(rowDef.row);
    btn.dataset.seat = String(seatNo);
    btn.dataset.zone = rowDef.zone;
    btn.dataset.priceGroup = rowDef.price_group || "";

    applySeatClasses(btn, place);

    btn.addEventListener("click", onSeatClick);

    seatsWrap.appendChild(btn);
  }

  rowEl.appendChild(seatsWrap);
  return rowEl;
}

function renderBoxes(boxes, seancePlaces) {
  const wrap = document.createElement("div");
  wrap.className = "hall-boxes";

  const leftCol = document.createElement("div");
  const rightCol = document.createElement("div");
  leftCol.className = "hall-box";
  rightCol.className = "hall-box";

  const boxLeft = boxes.find((b) => (b.side || "").toLowerCase() === "left") || boxes[0];
  const boxRight =
    boxes.find((b) => (b.side || "").toLowerCase() === "right") ||
    boxes.find((b) => b !== boxLeft) ||
    null;

  if (boxLeft) {
    leftCol.appendChild(boxTitle(boxLeft.label || "Ложа A"));
    leftCol.appendChild(renderBoxColumn(boxLeft, seancePlaces));
  }
  if (boxRight) {
    rightCol.appendChild(boxTitle(boxRight.label || "Ложа B"));
    rightCol.appendChild(renderBoxColumn(boxRight, seancePlaces));
  }

  wrap.appendChild(leftCol);
  wrap.appendChild(rightCol);
  return wrap;
}

function boxTitle(text) {
  const el = document.createElement("div");
  el.className = "hall-box-title";
  el.textContent = text;
  return el;
}

function renderBoxColumn(boxDef, seancePlaces) {
  const col = document.createElement("div");
  col.className = "hall-box-col";
  const seats = boxDef.seats || 18;

  for (let i = 1; i <= seats; i++) {
    const key = `${boxDef.id}-${i}`;
    const place = seancePlaces[key];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seat";
    btn.textContent = i;
    btn.dataset.key = key;
    btn.dataset.zone = "boxes";
    btn.dataset.boxId = boxDef.id;
    btn.dataset.priceGroup = boxDef.price_group || "";

    applySeatClasses(btn, place);

    btn.addEventListener("click", onSeatClick);

    col.appendChild(btn);
  }

  return col;
}

function applySeatClasses(btn, place) {
  btn.classList.remove("seat--selected", "seat--sold", "seat--reserved", "seat--blocked");

  const key = btn.dataset.key;
  if (selectedKeys.has(key)) {
    btn.classList.add("seat--selected");
  }

  if (!place || !place.status || place.status === "free") return;

  switch (place.status) {
    case "sold":
      btn.classList.add("seat--sold");
      break;
    case "reserved":
      btn.classList.add("seat--reserved");
      break;
    case "blocked":
      btn.classList.add("seat--blocked");
      break;
  }
}

// ----- ОБРАБОТКА КЛИКОВ ПО МЕСТАМ -----
function onSeatClick(e) {
  const btn = e.currentTarget;
  const key = btn.dataset.key;
  const place = places[key];

  // нельзя трогать проданные / заблокированные
  if (place && (place.status === "sold" || place.status === "blocked")) {
    return;
  }

  if (selectedKeys.has(key)) {
    selectedKeys.delete(key);
  } else {
    selectedKeys.add(key);
  }

  renderHall();
  renderBasket();
}

// ----- КОРЗИНА -----
function renderBasket() {
  basketBody.innerHTML = "";
  let total = 0;

  const keys = Array.from(selectedKeys);

  keys.sort((a, b) => a.localeCompare(b, "uk"));

  keys.forEach((key, index) => {
    const meta = getSeatMeta(key);
    if (!meta) return;
    total += meta.price;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${meta.zoneLabel}</td>
      <td>${meta.rowLabel}</td>
      <td>${meta.seatLabel}</td>
      <td>${meta.price}</td>
    `;
    basketBody.appendChild(tr);
  });

  basketCount.textContent = String(keys.length);
  sumCount.textContent = String(keys.length);
  sumAmount.textContent = String(total);
}

function clearSelection() {
  selectedKeys.clear();
  renderHall();
  renderBasket();
}

// ----- ПРИМЕНЕНИЕ СТАТУСОВ -----
function applyStatusToSelection(status) {
  if (!selectedKeys.size) {
    alert("Спочатку оберіть хоча б одне місце.");
    return;
  }

  selectedKeys.forEach((key) => {
    if (!places[key]) places[key] = {};
    const place = places[key];

    // если уже продано/заблокировано — пропускаем
    if (place.status === "sold" || place.status === "blocked") return;

    place.status = status; // sold / reserved
    place.channel = "boxoffice";
  });

  // сохраняем офлайн-копию
  saveToLocalStorage();

  selectedKeys.clear();
  renderHall();
  renderBasket();

  const msg =
    status === "sold"
      ? "Місця відмічені як продані (каса)."
      : "Місця поставлені на бронь.";
  alert(msg);
}

// ----- МЕТАДАННЫЕ МЕСТА -----
function getSeatMeta(key) {
  // ложи
  if (key.startsWith("box")) {
    const [boxId, seatStr] = key.split("-");
    const seatNo = Number(seatStr);
    const box = hallDef.boxes.find(
      (b) => b.id.toLowerCase() === boxId.toLowerCase()
    );
    if (!box) return null;
    const priceGroup = box.price_group;
    const price = (currentSeance.prices && currentSeance.prices[priceGroup]) || 0;

    return {
      zone: "boxes",
      zoneLabel: "Ложа",
      rowLabel: box.label || box.id,
      seatLabel: seatNo,
      price,
    };
  }

  // обычное место: "ряд-місце"
  const [rowStr, seatStr] = key.split("-");
  const row = Number(rowStr);
  const seatNo = Number(seatStr);
  const rowDef = hallDef.rows.find((r) => Number(r.row) === row);
  if (!rowDef) return null;

  const priceGroup = rowDef.price_group;
  const price = (currentSeance.prices && currentSeance.prices[priceGroup]) || 0;
  const zone = rowDef.zone;

  const zoneLabel =
    zone === "parter"
      ? "Партер"
      : zone === "amphi"
      ? "Амфітеатр"
      : zone === "balcony"
      ? "Балкон"
      : "Зал";

  return {
    zone,
    zoneLabel,
    rowLabel: `Ряд ${row}`,
    seatLabel: seatNo,
    price,
  };
}

// ----- ИНФО В ПРАВОМ БЛОКЕ -----
function updateHeaderInfo() {
  sideShowTitle.textContent = currentSeance.title || "—";
  sideShowTime.textContent = currentSeance.datetime || "—";
}

// ----- ОФЛАЙН-РЕЖИМ -----
function setOfflineMode(flag) {
  offlineMode = !!flag;

  if (offlineMode) {
    offlineBadge.textContent = "Офлайн";
    offlineBadge.classList.remove("badge--online");
    offlineBadge.classList.add("badge--offline");
    btnModeOffline.classList.add("btn--primary");
    btnModeOnline.classList.remove("btn--primary");
  } else {
    offlineBadge.textContent = "Онлайн";
    offlineBadge.classList.remove("badge--offline");
    offlineBadge.classList.add("badge--online");
    btnModeOnline.classList.add("btn--primary");
    btnModeOffline.classList.remove("btn--primary");
  }
}

// сохраняем только локальную копию состояний мест
function saveToLocalStorage() {
  if (!currentSeance || !currentSeance._id) return;
  try {
    const key = "shevchenko-seance-" + currentSeance._id;
    localStorage.setItem(key, JSON.stringify(places));
  } catch (e) {
    console.warn("localStorage error:", e);
  }
}

function restoreFromLocalStorage() {
  if (!currentSeance || !currentSeance._id) return;
  try {
    const key = "shevchenko-seance-" + currentSeance._id;
    const s = localStorage.getItem(key);
    if (!s) return;
    const saved = JSON.parse(s);
    currentSeance.places = Object.assign({}, currentSeance.places, saved);
    places = currentSeance.places;
  } catch (e) {
    console.warn("localStorage restore error:", e);
  }
}

// ----- УТИЛИТА ДЛЯ ЗАГРУЗКИ JSON -----
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("HTTP " + res.status + " for " + url);
  }
  return await res.json();
}
