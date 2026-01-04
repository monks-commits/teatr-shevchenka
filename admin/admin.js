/* ============================================================================
   ADMIN (касса) — Театр Шевченка
   - Рисует схему зала из hall.json (формат: zones object + rows + boxes)
   - Бронь/продажа в localStorage
   - Экспорт CSV/JSON
   - Синхронизация кассовых продаж с сайтом (Edge Function cash-sync)
   ВАЖНО: сканер/контролёр сюда НЕ включаем, чтобы не возвращались кнопки режимов.
============================================================================ */

const PATH_SETTINGS = "../data/settings.json";
const PATH_AFISHA = "../data/afisha.json";

// если в афише не указано, какой hall брать — используем дефолт:
const DEFAULT_HALL_PATH = "../data/halls/shevchenko-big.json";

let SETTINGS = {};
let AFISHA = [];
let hallSchema = null;

let currentShowId = "";
let CURRENCY = "грн";

// ====== localStorage ======
const LS_PREFIX = "theatre_admin__";
const lsKey = (k) => LS_PREFIX + (currentShowId ? `${currentShowId}__` : "") + k;

let seatState = {}; // seatKey -> status ("free" | "basket" | "sold" | "reserved" | "blocked")
let basket = [];    // [{zone,row,seat,price,seat_label}]
let reserves = [];  // [{who, created_at, items:[...] }]
let ops = [];       // журнал операций [{id, at, type, payload, synced_at?, sync_order_id?}]

// ====== utils ======
const nowIso = () => new Date().toISOString();
const safe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
}[c]));

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function fmtDT(iso) {
  try { return new Date(iso).toLocaleString("uk-UA"); } catch { return iso; }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ====== load json ======
async function loadJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return await r.json();
}

async function loadSettings() {
  SETTINGS = await loadJson(PATH_SETTINGS);
  CURRENCY = SETTINGS?.theatre?.currency || "грн";
}

async function loadAfisha() {
  AFISHA = await loadJson(PATH_AFISHA);
  if (!Array.isArray(AFISHA)) AFISHA = [];
}

function getShowById(id) {
  return AFISHA.find((x) => x.id === id) || null;
}

function fillShowSelect() {
  const sel = document.getElementById("admin-show-select");
  if (!sel) return;

  sel.innerHTML = `<option value="">— обрати —</option>` +
    AFISHA.map((s) => {
      const label = `${s.title} • ${s.date} ${s.time}`;
      return `<option value="${safe(s.id)}">${safe(label)}</option>`;
    }).join("");

  // выберем первый по умолчанию
  if (!currentShowId && AFISHA.length) currentShowId = AFISHA[0].id;
  sel.value = currentShowId || "";

  sel.addEventListener("change", async () => {
    currentShowId = sel.value || "";
    setCurrentShowHeader();
    loadStateForShow();
    // перерисуем
    renderHall(hallSchema);
    renderPriceLegend();
    updateBasketUI();
    renderRegistry();
    refreshSyncHint();
  });
}

function setCurrentShowHeader() {
  const el = document.getElementById("admin-current-show");
  if (!el) return;
  const s = getShowById(currentShowId);
  if (!s) { el.textContent = "Сеанс: (не обрано)"; return; }
  el.textContent = `Сеанс: ${s.title} — ${s.date}, ${s.time}`;
}

async function loadHallSchema() {
  // если в афише будет поле hall / hall_path — можно будет подхватить.
  // сейчас — дефолт.
  hallSchema = await loadJson(DEFAULT_HALL_PATH);
  hallSchema = normalizeHallSchema(hallSchema);
  return hallSchema;
}

/* ============================================================================
   НОРМАЛИЗАЦИЯ hall.json (под твой формат)
   Вход (пример):
   {
     id,title,
     zones:{ parter:{label}, ... },
     price_groups:{ ...labels... },
     rows:[ {row,zone,seats,aisle_after,price_group} ...,
            {row,zone,seats_left,seats_right,price_group} ... ],
     boxes:[ {id,label,side,seats,price_group} ... ]
   }
   Выход:
   {
     id,title,
     zonesObj, priceGroupsObj,
     zonesArray:[ { id,label, rows:[rowInfo...] } ... ],
     boxes:[...]
   }
============================================================================ */
function normalizeHallSchema(raw) {
  const schema = raw || {};
  schema.zonesObj = schema.zones && typeof schema.zones === "object" ? schema.zones : {};
  schema.priceGroupsObj = schema.price_groups && typeof schema.price_groups === "object" ? schema.price_groups : {};
  const rows = Array.isArray(schema.rows) ? schema.rows : [];

  // group rows by zone
  const byZone = new Map();
  for (const r of rows) {
    const zid = String(r.zone || "parter");
    if (!byZone.has(zid)) {
      const zLabel = schema.zonesObj?.[zid]?.label || zid;
      byZone.set(zid, { id: zid, label: zLabel, rows: [] });
    }
    byZone.get(zid).rows.push(r);
  }

  // boxes -> отдельная зона "boxes"
  const boxes = Array.isArray(schema.boxes) ? schema.boxes : [];
  if (boxes.length) {
    const zLabel = schema.priceGroupsObj?.p_boxes?.label || "Ложі";
    const boxZone = { id: "boxes", label: zLabel, rows: [] };
    for (const b of boxes) {
      boxZone.rows.push({
        row: b.label || b.id || "box",
        zone: "boxes",
        seats: Number(b.seats || 0),
        price_group: b.price_group || "p_boxes",
        _isBox: true,
        _boxId: b.id || b.label || "box"
      });
    }
    byZone.set("boxes", boxZone);
  }

  // порядок зон на экране
  const order = ["parter", "amphi", "balcony", "boxes"];
  const zonesArray = [];
  for (const id of order) if (byZone.has(id)) zonesArray.push(byZone.get(id));
  // остальные (если есть)
  for (const [id, z] of byZone.entries()) {
    if (!order.includes(id)) zonesArray.push(z);
  }

  schema.zonesArray = zonesArray;
  return schema;
}

/* ============================================================================
   STATE
============================================================================ */
function loadStateForShow() {
  try { seatState = JSON.parse(localStorage.getItem(lsKey("seatState")) || "{}"); } catch { seatState = {}; }
  try { basket = JSON.parse(localStorage.getItem(lsKey("basket")) || "[]"); } catch { basket = []; }
  try { reserves = JSON.parse(localStorage.getItem(lsKey("reserves")) || "[]"); } catch { reserves = []; }
  try { ops = JSON.parse(localStorage.getItem(lsKey("ops")) || "[]"); } catch { ops = []; }
}

function saveStateForShow() {
  localStorage.setItem(lsKey("seatState"), JSON.stringify(seatState));
  localStorage.setItem(lsKey("basket"), JSON.stringify(basket));
  localStorage.setItem(lsKey("reserves"), JSON.stringify(reserves));
  localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
}

function seatKey(zone, row, seat) {
  return `${String(zone)}::${String(row)}::${String(seat)}`;
}

function getSeatStatus(zone, row, seat) {
  return seatState[seatKey(zone,row,seat)] || "free";
}

function setSeatStatus(zone, row, seat, status) {
  seatState[seatKey(zone,row,seat)] = status;
}

/* ============================================================================
   PRICING
============================================================================ */
function priceForGroup(pg) {
  const def = SETTINGS?.pricing_defaults?.[pg];
  const n = Number(def);
  return Number.isFinite(n) ? n : 0;
}

function zoneLabel(zoneId) {
  if (zoneId === "boxes") return hallSchema?.zonesArray?.find(z=>z.id==="boxes")?.label || "Ложі";
  return hallSchema?.zonesObj?.[zoneId]?.label || zoneId;
}

function seatLabel(zone, row, seat, rowInfo) {
  // для лож: row — это "Ложа A" и т.п.
  if (rowInfo?._isBox) return `${row} • місце ${seat}`;
  // обычный ряд/место
  return `Ряд ${row}, місце ${seat} (${zoneLabel(zone)})`;
}

/* ============================================================================
   UI — HALL RENDER
============================================================================ */
function renderHall(schema) {
  const root = document.getElementById("hallRoot");
  if (!root) return;
  if (!schema) { root.innerHTML = "<div>Немає схеми залу.</div>"; return; }

  root.innerHTML = "";

  const zones = Array.isArray(schema.zonesArray) ? schema.zonesArray : [];
  for (const z of zones) {
    const zWrap = document.createElement("div");
    zWrap.className = "zone-block";

    const h = document.createElement("div");
    h.className = "zone-title";
    h.textContent = z.label || z.id;
    zWrap.appendChild(h);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "zone-rows";

    for (const r of (z.rows || [])) {
      rowsWrap.appendChild(renderRow(z.id, r));
    }

    zWrap.appendChild(rowsWrap);
    root.appendChild(zWrap);
  }
}

function renderRow(zoneId, rowInfo) {
  const row = rowInfo?.row ?? "?";
  const wrap = document.createElement("div");
  wrap.className = "hall-row";

  const lab = document.createElement("div");
  lab.className = "row-label";
  lab.textContent = String(row);
  wrap.appendChild(lab);

  const seatsWrap = document.createElement("div");
  seatsWrap.className = "row-seats";

  const pg = rowInfo?.price_group || "";
  const price = priceForGroup(pg);

  // Вариант А: seats_left / seats_right (амфитеатр)
  if (rowInfo && (rowInfo.seats_left != null || rowInfo.seats_right != null)) {
    const left = Math.max(0, Number(rowInfo.seats_left || 0));
    const right = Math.max(0, Number(rowInfo.seats_right || 0));

    // левые места 1..left
    for (let s=1; s<=left; s++) {
      seatsWrap.appendChild(renderSeatBtn(zoneId, row, s, price, rowInfo));
    }

    // проход между левыми/правыми (если right>0)
    if (right > 0) {
      const gap = document.createElement("div");
      gap.className = "seat-gap";
      seatsWrap.appendChild(gap);
    }

    // правые места продолжаем нумерацию
    for (let s=left+1; s<=left+right; s++) {
      seatsWrap.appendChild(renderSeatBtn(zoneId, row, s, price, rowInfo));
    }

    wrap.appendChild(seatsWrap);
    return wrap;
  }

  // Вариант B: обычный ряд seats + aisle_after
  const seats = Math.max(0, Number(rowInfo?.seats || 0));
  const aisleAfter = rowInfo?.aisle_after != null ? Number(rowInfo.aisle_after) : null;

  for (let s=1; s<=seats; s++) {
    seatsWrap.appendChild(renderSeatBtn(zoneId, row, s, price, rowInfo));
    if (aisleAfter && s === aisleAfter) {
      const gap = document.createElement("div");
      gap.className = "seat-gap";
      seatsWrap.appendChild(gap);
    }
  }

  wrap.appendChild(seatsWrap);
  return wrap;
}

function renderSeatBtn(zoneId, row, seat, price, rowInfo) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "seat";
  btn.textContent = String(seat);

  const st = getSeatStatus(zoneId, row, seat);

  // css классы статусов
  btn.dataset.status = st;

  // кликаем только если не продано/не служебное
  btn.addEventListener("click", () => onSeatClick(zoneId, row, seat, price, rowInfo));
  return btn;
}

function onSeatClick(zoneId, row, seat, price, rowInfo) {
  const st = getSeatStatus(zoneId, row, seat);

  if (st === "sold" || st === "blocked") return;

  // если уже в корзине — убрать
  if (st === "basket") {
    setSeatStatus(zoneId, row, seat, "free");
    basket = basket.filter((x) => !(x.zone===zoneId && String(x.row)===String(row) && x.seat===seat));
    updateBasketUI();
    saveStateForShow();
    renderHall(hallSchema);
    return;
  }

  // если бронь — не трогаем из зала (снимать бронь отдельной кнопкой)
  if (st === "reserved") return;

  // добавить в корзину
  const label = seatLabel(zoneId, row, seat, rowInfo);
  basket.push({ zone: zoneId, row: String(row), seat, price, seat_label: label });
  setSeatStatus(zoneId, row, seat, "basket");

  updateBasketUI();
  saveStateForShow();
  renderHall(hallSchema);
}

/* ============================================================================
   UI — BASKET / ACTIONS
============================================================================ */
function updateBasketUI() {
  const list = document.getElementById("basketList");
  const sumEl = document.getElementById("basketSum");
  if (!list || !sumEl) return;

  if (!basket.length) {
    list.innerHTML = `<div class="basket-empty">Поки що нічого не обрано.</div>`;
    sumEl.textContent = `0 ${CURRENCY}`;
    return;
  }

  const sum = basket.reduce((s,x)=>s+(Number(x.price)||0),0);
  sumEl.textContent = `${sum} ${CURRENCY}`;

  list.innerHTML = basket.map((it) => `
    <div class="basket-item">
      <div class="basket-seat">${safe(it.seat_label)}</div>
      <div class="basket-price">${it.price} ${CURRENCY}</div>
    </div>
  `).join("");
}

function addOp(type, payload) {
  ops.unshift({ id: uuid(), at: nowIso(), type, payload });
}

function clearBasketOnly() {
  // снимаем статус basket -> free
  for (const it of basket) setSeatStatus(it.zone, it.row, it.seat, "free");
  basket = [];
  saveStateForShow();
  updateBasketUI();
  renderHall(hallSchema);
}

function applyReserve() {
  if (!basket.length) return;

  const who = prompt("Хто бронює? (ПІБ або телефон)");
  if (!who) return;

  const items = basket.map((x) => ({ ...x }));
  for (const it of items) setSeatStatus(it.zone, it.row, it.seat, "reserved");

  reserves.unshift({ who, created_at: nowIso(), items });
  addOp("reserve", { who, items });

  basket = [];
  saveStateForShow();
  updateBasketUI();
  renderHall(hallSchema);
  renderRegistry();
}

function applyUnreserve() {
  if (!reserves.length) {
    alert("Немає броней.");
    return;
  }

  const who = prompt("Скасувати бронь для кого? (введи точно як в реєстрі)");
  if (!who) return;

  const idx = reserves.findIndex((r) => r.who === who);
  if (idx < 0) {
    alert("Не знайдено.");
    return;
  }

  const r = reserves[idx];
  for (const it of r.items) setSeatStatus(it.zone, it.row, it.seat, "free");
  reserves.splice(idx, 1);

  addOp("unreserve", { who, items: r.items });

  saveStateForShow();
  renderHall(hallSchema);
  renderRegistry();
}

function applySell() {
  if (!basket.length) return;

  const soldItems = basket.map((x) => ({ ...x, sold_at: nowIso() }));
  for (const it of soldItems) setSeatStatus(it.zone, it.row, it.seat, "sold");

  addOp("sell_cash", { items: soldItems });

  basket = [];
  saveStateForShow();

  updateBasketUI();
  renderHall(hallSchema);
  renderRegistry();

  refreshSyncHint();
}

/* ============================================================================
   REGISTRY + EXPORT
============================================================================ */
function renderRegistry() {
  const el = document.getElementById("reserveRegistry");
  if (!el) return;

  if (!reserves.length) {
    el.innerHTML = `<div class="registry-empty">Поки що немає броней.</div>`;
    return;
  }

  el.innerHTML = reserves.map((r) => {
    const sum = r.items.reduce((s, x) => s + (Number(x.price) || 0), 0);
    return `
      <div class="reg-card">
        <div class="reg-head">
          <div class="reg-who">${safe(r.who)}</div>
          <div class="reg-meta">${fmtDT(r.created_at)} • <b>${sum} ${CURRENCY}</b></div>
        </div>
        <div class="reg-items">
          ${r.items.map((it) => `<div class="reg-item">${safe(it.seat_label)} • ${it.price} ${CURRENCY}</div>`).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function toCsvRow(arr) {
  return arr.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",");
}

function exportReserves() {
  const rows = [["who", "created_at", "seat_label", "price"]];
  for (const r of reserves) {
    for (const it of r.items) rows.push([r.who, r.created_at, it.seat_label, it.price]);
  }
  downloadText(`reserves_${currentShowId || "show"}.csv`, rows.map(toCsvRow).join("\n"));
}

function exportSales() {
  const rows = [["at", "type", "seat_label", "price"]];
  const sales = ops.filter((o) => o.type === "sell_cash");
  for (const o of sales) {
    for (const it of (o.payload?.items || [])) rows.push([o.at, o.type, it.seat_label, it.price]);
  }
  downloadText(`sales_${currentShowId || "show"}.csv`, rows.map(toCsvRow).join("\n"));
}

function exportOps() {
  downloadText(`ops_${currentShowId || "show"}.json`, JSON.stringify(ops, null, 2));
}

/* ============================================================================
   LEGEND (можно оставить простой)
============================================================================ */
function renderPriceLegend() {
  const el = document.getElementById("priceLegend");
  if (!el) return;

  // по умолчанию показываем справку по статусам (не цены)
  el.innerHTML = `
    <span class="legend-item"><span class="dot dot-free"></span>вільно</span>
    <span class="legend-item"><span class="dot dot-basket"></span>обрано (кошик)</span>
    <span class="legend-item"><span class="dot dot-sold"></span>продано</span>
    <span class="legend-item"><span class="dot dot-reserved"></span>бронь</span>
    <span class="legend-item"><span class="dot dot-blocked"></span>службові / не продаються</span>
  `;
}

/* ============================================================================
   SYNC кассы с сайтом (cash-sync)
============================================================================ */
const SYNC_LS_SECRET = LS_PREFIX + "cashier_sync_secret";

function getCashSyncEndpoint() {
  const explicit = SETTINGS?.cash_sync_endpoint;
  if (explicit) return String(explicit).trim();

  const u = SETTINGS?.supabase_url || "";
  if (u && typeof u === "string") {
    return u.replace(/\/+$/, "") + "/functions/v1/cash-sync";
  }
  return "";
}

function getUnsyncedCashSales() {
  const list = [];
  for (const o of ops) {
    if (o.type !== "sell_cash") continue;
    if (o.synced_at) continue;

    const items = (o.payload?.items || []).map((it) => ({
      show_slug: currentShowId,
      seat_label: it.seat_label,
      price: it.price,
      sold_at: it.sold_at || o.at
    }));
    list.push({ opId: o.id, at: o.at, items });
  }
  return list;
}

function ensureSyncUI() {
  let host = document.querySelector(".admin-controls");
  if (!host) host = document.getElementById("admin-controls");
  if (!host) host = document.querySelector("header");
  if (!host) host = document.body;

  if (document.getElementById("btn-sync-now")) return;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "8px";
  wrap.style.marginTop = "10px";
  wrap.style.alignItems = "center";
  wrap.style.flexWrap = "wrap";

  wrap.innerHTML = `
    <button id="btn-sync-now" class="btn btn-secondary" type="button">Синхронізація з сайтом</button>
    <input id="cashierSecret" class="admin-select" style="min-width:220px" placeholder="CASHIER_SYNC_SECRET (разово)" />
    <span id="syncHint" style="font-size:12px;opacity:.75"></span>
  `;

  host.appendChild(wrap);

  const inp = document.getElementById("cashierSecret");
  const saved = localStorage.getItem(SYNC_LS_SECRET) || "";
  if (inp && saved) inp.value = saved;

  document.getElementById("btn-sync-now")?.addEventListener("click", syncNow);
  refreshSyncHint();
}

function refreshSyncHint() {
  const hint = document.getElementById("syncHint");
  if (!hint) return;

  const pending = getUnsyncedCashSales().reduce((s, x) => s + x.items.length, 0);
  const ep = getCashSyncEndpoint();
  if (!ep) {
    hint.textContent = "Синхронізація: endpoint не заданий у settings.json";
    return;
  }
  hint.textContent = pending ? `До синхронізації: ${pending} місць` : "Все синхронізовано";
}

async function syncNow() {
  const endpoint = getCashSyncEndpoint();
  if (!endpoint) {
    alert("Немає endpoint для синхронізації (cash-sync). Додай supabase_url/cash_sync_endpoint у settings.json.");
    return;
  }

  const inp = document.getElementById("cashierSecret");
  const secret = (inp?.value || "").trim();
  if (!secret) {
    alert("Введи CASHIER_SYNC_SECRET (разово).");
    return;
  }
  localStorage.setItem(SYNC_LS_SECRET, secret);

  const batches = getUnsyncedCashSales();
  const totalSeats = batches.reduce((s, b) => s + b.items.length, 0);

  if (!totalSeats) {
    alert("Нічого синхронізувати — все вже в базі.");
    refreshSyncHint();
    return;
  }

  const items = batches.flatMap((b) => b.items);

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cashier-secret": secret
      },
      body: JSON.stringify({
        cashier_id: "kassa",
        items
      })
    });

    const j = await r.json().catch(() => ({}));

    if (r.status === 401) {
      alert("401: невірний CASHIER_SYNC_SECRET");
      return;
    }

    if (r.status === 409) {
      const conflicts = j?.conflicts || [];
      alert(
        "Конфлікт місць (вже продано онлайн або вже є в базі):\n" +
        conflicts.map((c) => `${c.seat_label} (order:${c.order_id})`).join("\n")
      );
      return;
    }

    if (!r.ok || j?.ok === false) {
      alert("Помилка синхронізації: " + (j?.error || ("HTTP " + r.status)));
      return;
    }

    const syncedAt = nowIso();
    const syncedOpIds = new Set(batches.map((b) => b.opId));
    for (const o of ops) {
      if (syncedOpIds.has(o.id)) {
        o.synced_at = syncedAt;
        o.sync_order_id = j.order_id || null;
      }
    }
    saveStateForShow();
    refreshSyncHint();

    alert(`✅ Синхронізовано: ${j.synced} місць\nOrder: ${j.order_id}`);
  } catch (e) {
    alert("Помилка мережі/інтернету при синхронізації: " + String(e?.message || e));
  }
}

/* ============================================================================
   INIT
============================================================================ */
async function initAdminPage() {
  await loadSettings();
  await loadAfisha();
  await loadHallSchema();

  const nameEl = document.getElementById("admin-theatre-name");
  if (nameEl && SETTINGS.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  const dateEl = document.getElementById("admin-current-date");
  if (dateEl) dateEl.textContent = new Date().toLocaleString("uk-UA");

  // buttons
  document.getElementById("btn-sell")?.addEventListener("click", applySell);
  document.getElementById("btn-reserve")?.addEventListener("click", applyReserve);
  document.getElementById("btn-unreserve")?.addEventListener("click", applyUnreserve);
  document.getElementById("btn-clear")?.addEventListener("click", clearBasketOnly);

  document.getElementById("btn-export-reserves")?.addEventListener("click", exportReserves);
  document.getElementById("btn-export-sales")?.addEventListener("click", exportSales);
  document.getElementById("btn-export-ops")?.addEventListener("click", exportOps);

  // shows
  fillShowSelect();
  setCurrentShowHeader();
  loadStateForShow();

  // render
  renderHall(hallSchema);
  renderPriceLegend();
  updateBasketUI();
  renderRegistry();

  // sync ui
  ensureSyncUI();
  refreshSyncHint();
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage().catch((err) => {
    console.error("Помилка ініціалізації адмінки", err);
    alert("Помилка ініціалізації адмінки. Відкрий консоль (F12) і покажи помилку.");
  });
});
