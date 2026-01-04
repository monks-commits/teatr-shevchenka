// admin/admin.js

let SETTINGS = null;
let CURRENCY = "грн";
let PRICING_DEFAULTS = {};
let PRICE_PALETTE = {}; // "200" -> "seat--p200"

const LS_PREFIX = "shev_admin_v3_";

// local state
let hallSchema = null;
let afisha = [];
let currentShowId = "";

const seatState = new Map(); // key -> "free" | "selected" | "sold" | "reserved" | "inactive"
let basket = [];             // [{zone,row,seat,seat_label,price}]
let reserves = [];           // [{who, items:[...], created_at}]
let ops = [];                // журнал операций

// ===== helpers =====
function nowIso() { return new Date().toISOString(); }
function fmtDT(ts) { try { return new Date(ts).toLocaleString("uk-UA"); } catch { return ts; } }

function seatKey(row, seat, zone) {
  return `${zone}:${row}-${seat}`;
}

function lsKey(name) {
  return `${LS_PREFIX}${name}_${currentShowId || "no_show"}`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function safe(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}

// ===== IMPORTANT: paths =====
// У тебя /data в корне репо, а /admin отдельно.
// Поэтому из /admin/* надо ходить в ../data/*
const PATH_SETTINGS = "../data/settings.json";
const PATH_AFISHA = "../data/afisha.json";
const PATH_HALL = "../data/halls/shevchenko-big.json";

// ===== load config/data =====
async function loadSettings() {
  if (SETTINGS) return SETTINGS;

  try {
    const res = await fetch(PATH_SETTINGS, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    SETTINGS = await res.json();

    if (SETTINGS.theatre?.currency) CURRENCY = SETTINGS.theatre.currency;
    if (SETTINGS.pricing_defaults) PRICING_DEFAULTS = SETTINGS.pricing_defaults;
    if (SETTINGS.price_palette) PRICE_PALETTE = SETTINGS.price_palette;
  } catch (e) {
    console.warn("settings.json не прочитался, используем дефолты", e);
    SETTINGS = {};
  }

  // дефолтная палитра
  if (!PRICE_PALETTE || Object.keys(PRICE_PALETTE).length === 0) {
    PRICE_PALETTE = {
      "70": "seat--p70",
      "100": "seat--p100",
      "120": "seat--p120",
      "140": "seat--p140",
      "160": "seat--p160",
      "170": "seat--p170",
      "180": "seat--p180",
      "200": "seat--p200"
    };
  }

  return SETTINGS;
}

async function loadHallSchema() {
  if (hallSchema) return hallSchema;
  const res = await fetch(PATH_HALL, { cache: "no-store" });
  if (!res.ok) throw new Error("Cannot load hall schema: " + res.status);
  hallSchema = await res.json();
  return hallSchema;
}

async function loadAfisha() {
  const res = await fetch(PATH_AFISHA, { cache: "no-store" });
  if (!res.ok) throw new Error("Cannot load afisha: " + res.status);
  afisha = await res.json();
  return afisha;
}

// ===== pricing =====
function getPriceForRow(rowInfo, zone, rowNumber) {
  if (rowInfo.price != null) return Number(rowInfo.price) || 0;

  const g = rowInfo.price_group;
  if (g && PRICING_DEFAULTS[g] != null) return Number(PRICING_DEFAULTS[g]) || 0;

  // fallback только для партера/лож
  if (zone === "parter") {
    if (rowNumber <= 2) return 200;
    if (rowNumber <= 4) return 180;
    if (rowNumber <= 6) return 170;
    if (rowNumber <= 8) return 160;
    if (rowNumber <= 12) return 140;
    if (rowNumber <= 15) return 120;
    return 100;
  }
  if (zone === "lodge") return 200;

  return 0;
}

function getPriceClass(price) {
  const key = String(price);
  return PRICE_PALETTE?.[key] || "";
}

function getZoneLabel(zone) {
  switch (zone) {
    case "parter": return "Партер";
    case "amphi": return "Амфітеатр";
    case "balcony": return "Балкон";
    case "lodge": return "Ложа";
    default: return zone;
  }
}

// продаём партер + ложи (как у тебя)
function isSellable(zone) {
  return zone === "parter" || zone === "lodge";
}

// ===== state persistence =====
function saveStateForShow() {
  localStorage.setItem(lsKey("seatState"), JSON.stringify([...seatState.entries()]));
  localStorage.setItem(lsKey("reserves"), JSON.stringify(reserves));
  localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
}

function loadStateForShow() {
  seatState.clear();
  basket = [];

  try {
    const raw = localStorage.getItem(lsKey("seatState"));
    if (raw) {
      const entries = JSON.parse(raw);
      for (const [k, v] of entries) seatState.set(k, v);
    }
  } catch {}

  try {
    reserves = JSON.parse(localStorage.getItem(lsKey("reserves")) || "[]");
  } catch { reserves = []; }

  try {
    ops = JSON.parse(localStorage.getItem(lsKey("ops")) || "[]");
  } catch { ops = []; }
}

// ===== афиша/select =====
function fillShowSelect() {
  const sel = document.getElementById("showSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">— обрати —</option>`;

  for (const s of afisha) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.title} • ${s.date} ${s.time}`;
    sel.appendChild(opt);
  }

  sel.addEventListener("change", () => {
    currentShowId = sel.value || "";
    setCurrentShowHeader();
    loadStateForShow();
    renderHall(hallSchema);
    updateBasketUI();
    renderRegistry();
    refreshSyncHint();
  });

  // выберем первый по умолчанию
  if (!currentShowId && afisha.length) {
    currentShowId = afisha[0].id;
    sel.value = currentShowId;
  } else {
    sel.value = currentShowId;
  }
}

function getCurrentShow() {
  return afisha.find((x) => x.id === currentShowId) || null;
}

function setCurrentShowHeader() {
  const showEl = document.getElementById("admin-current-show");
  if (!showEl) return;

  const s = getCurrentShow();
  if (!s) {
    showEl.textContent = "Сеанс: (не обрано)";
    return;
  }
  showEl.textContent = `Сеанс: ${s.title} — ${s.date}, ${s.time}`;
}

// ===== UI: hall rendering =====
function renderPriceLegend() {
  const el = document.getElementById("priceLegend");
  if (!el) return;

  const prices = Object.keys(PRICE_PALETTE)
    .map((p) => Number(p))
    .filter((n) => !isNaN(n))
    .sort((a, b) => b - a);

  el.innerHTML = prices.map((p) => {
    const cls = PRICE_PALETTE[String(p)];
    return `<span class="legend-item"><span class="sw ${cls}"></span>${p} ${CURRENCY}</span>`;
  }).join("");
}

function seatLabel(zone, row, seat) {
  // важно: label должен быть СТАБИЛЬНЫМ — это ключ синхронизации
  return `${getZoneLabel(zone)} ${row} / ${seat}`;
}

function getSeatStatus(zone, row, seat) {
  const k = seatKey(row, seat, zone);
  return seatState.get(k) || "free";
}

function setSeatStatus(zone, row, seat, status) {
  const k = seatKey(row, seat, zone);
  seatState.set(k, status);
}

function toggleSeatToBasket(zone, row, seat, rowInfo) {
  const k = seatKey(row, seat, zone);
  const st = seatState.get(k) || "free";

  if (st === "inactive" || st === "sold" || st === "reserved") return;

  const idx = basket.findIndex((x) => x.zone === zone && x.row === row && x.seat === seat);
  if (idx >= 0) {
    basket.splice(idx, 1);
    seatState.set(k, "free");
  } else {
    const price = getPriceForRow(rowInfo, zone, row);
    basket.push({
      zone, row, seat,
      seat_label: seatLabel(zone, row, seat),
      price
    });
    seatState.set(k, "selected");
  }

  saveStateForShow();
  updateBasketUI();
  renderHall(hallSchema);
}

function renderRow(zone, rowInfo) {
  const row = rowInfo.row;
  const seatsCount = rowInfo.seats || 0;
  const offset = rowInfo.offset || 0;

  const rowWrap = document.createElement("div");
  rowWrap.className = "admin-row";

  const label = document.createElement("div");
  label.className = "admin-row-label";
  label.textContent = row;
  rowWrap.appendChild(label);

  const seatsWrap = document.createElement("div");
  seatsWrap.className = "admin-row-seats";
  seatsWrap.style.marginLeft = (offset * 18) + "px";

  for (let s = 1; s <= seatsCount; s++) {
    const st = getSeatStatus(zone, row, s);
    const btn = document.createElement("button");
    btn.className = "seat";

    if (st === "free") btn.classList.add("seat--free");
    if (st === "selected") btn.classList.add("seat--selected");
    if (st === "sold") btn.classList.add("seat--sold");
    if (st === "reserved") btn.classList.add("seat--reserved");
    if (st === "inactive") btn.classList.add("seat--inactive");

    if (isSellable(zone) && st !== "inactive") {
      const price = getPriceForRow(rowInfo, zone, row);
      const pcls = getPriceClass(price);
      if (pcls) btn.classList.add(pcls);
    }

    btn.textContent = s;
    btn.title = `${getZoneLabel(zone)} • Ряд ${row} • Місце ${s} • ${st}`;

    btn.addEventListener("click", () => toggleSeatToBasket(zone, row, s, rowInfo));
    seatsWrap.appendChild(btn);
  }

  rowWrap.appendChild(seatsWrap);
  return rowWrap;
}

function renderZone(zoneBlock) {
  const zone = zoneBlock.zone;
  const sec = document.createElement("div");
  sec.className = "admin-zone";

  const h = document.createElement("div");
  h.className = "admin-zone-title";
  h.textContent = getZoneLabel(zone);
  sec.appendChild(h);

  for (const rowInfo of zoneBlock.rows || []) {
    sec.appendChild(renderRow(zone, rowInfo));
  }

  return sec;
}

function renderHall(schema) {
  const root = document.getElementById("hall-root");
  if (!root) return;

  root.innerHTML = "";
  for (const zoneBlock of schema.zones || []) {
    root.appendChild(renderZone(zoneBlock));
  }
}

// ===== basket UI =====
function basketTotal() {
  return basket.reduce((s, x) => s + (Number(x.price) || 0), 0);
}

function updateBasketUI() {
  const list = document.getElementById("basket-list");
  const sub = document.getElementById("basket-sub");
  const total = document.getElementById("basket-total");
  const cur = document.getElementById("basket-currency");

  if (cur) cur.textContent = CURRENCY;
  if (total) total.textContent = String(basketTotal());

  if (!list) return;

  if (!basket.length) {
    list.innerHTML = "";
    if (sub) sub.textContent = "Поки що нічого не обрано.";
    return;
  }

  if (sub) sub.textContent = `${basket.length} місць у кошику.`;

  list.innerHTML = basket.map((x, i) => `
    <div class="basket-item">
      <div class="basket-title">${safe(x.seat_label)}</div>
      <div class="basket-meta">${safe(getZoneLabel(x.zone))} • ряд ${x.row} • місце ${x.seat} • <b>${x.price} ${CURRENCY}</b></div>
      <button class="basket-remove" data-i="${i}">×</button>
    </div>
  `).join("");

  list.querySelectorAll(".basket-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-i"));
      const it = basket[i];
      if (!it) return;

      basket.splice(i, 1);
      setSeatStatus(it.zone, it.row, it.seat, "free");
      saveStateForShow();
      updateBasketUI();
      renderHall(hallSchema);
    });
  });
}

function clearBasketOnly() {
  for (const it of basket) setSeatStatus(it.zone, it.row, it.seat, "free");
  basket = [];
  saveStateForShow();
  updateBasketUI();
  renderHall(hallSchema);
}

// ===== reserves/ops =====
function addOp(type, payload) {
  ops.unshift({
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: nowIso(),
    type,
    show_id: currentShowId,
    payload
  });
  saveStateForShow();
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

// ===== registry UI =====
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

// ===== CSV export =====
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

// =====================================================================
// ✅ СИНХРОНИЗАЦИЯ КАССЫ С САЙТОМ (через Edge Function cash-sync)
// =====================================================================
const SYNC_LS_SECRET = LS_PREFIX + "cashier_sync_secret";

function getCashSyncEndpoint() {
  const explicit = SETTINGS?.cash_sync_endpoint;
  if (explicit) return String(explicit).trim();

  const u = SETTINGS?.supabase_url || SETTINGS?.supabase?.url || "";
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
  // Ставим рядом с контролами (fallback: в body)
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

// ===== init =====
async function initAdminPage() {
  await loadSettings();
  await loadAfisha();
  const schema = await loadHallSchema();

  const nameEl = document.getElementById("admin-theatre-name");
  if (nameEl && SETTINGS.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  const dateEl = document.getElementById("admin-current-date");
  if (dateEl) dateEl.textContent = new Date().toLocaleString("uk-UA");

  fillShowSelect();
  setCurrentShowHeader();
  loadStateForShow();

  renderHall(schema);
  renderPriceLegend();
  updateBasketUI();
  renderRegistry();

  document.getElementById("btn-sell")?.addEventListener("click", applySell);
  document.getElementById("btn-reserve")?.addEventListener("click", applyReserve);
  document.getElementById("btn-unreserve")?.addEventListener("click", applyUnreserve);
  document.getElementById("btn-clear")?.addEventListener("click", clearBasketOnly);

  document.getElementById("btn-export-reserves")?.addEventListener("click", exportReserves);
  document.getElementById("btn-export-sales")?.addEventListener("click", exportSales);
  document.getElementById("btn-export-ops")?.addEventListener("click", exportOps);

  ensureSyncUI();
  refreshSyncHint();
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage().catch((err) => {
    console.error("Помилка ініціалізації адмінки", err);
    alert("Помилка ініціалізації адмінки. Відкрий консоль (F12) і покажи помилку.");
  });
});
