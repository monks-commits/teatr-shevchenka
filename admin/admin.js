/* =====================================================================
   ADMIN (cashier panel) — Театр / универсальный шаблон
   + OFFLINE CASHIER SYNC to Supabase (orders/payments/tickets)
   ===================================================================== */

/* ===================== CONFIG / STATE ===================== */

const LS_PREFIX = "va_admin_v1_";
const CURRENCY_FALLBACK = "грн";

// Если не хочешь хранить ключи в settings.json — можно вписать сюда.
// Но правильнее: data/settings.json -> supabase.url + supabase.anon_key
const HARD_SUPABASE_URL = "";      // например: "https://xxxx.supabase.co"
const HARD_SUPABASE_ANON_KEY = ""; // anon / publishable key

let SETTINGS = null;
let afisha = [];
let hallSchema = null;

let currentShowId = "";
let seatState = new Map();  // key -> free|sold|reserved
let basket = [];            // [{key, zone, row, seat, price}]
let reserves = [];          // [{showId, who, createdAt, seats:[...]}]
let ops = [];               // operations log for exports + sync

let CURRENCY = CURRENCY_FALLBACK;

/* ===================== HELPERS ===================== */

const $ = (id) => document.getElementById(id);

function lsKey(name) {
  return `${LS_PREFIX}${name}_${currentShowId || "no_show"}`;
}
function nowIso() {
  return new Date().toISOString();
}
function fmtDT(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("uk-UA");
  } catch {
    return iso;
  }
}
function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function rand(n = 6) {
  return Math.random().toString(16).slice(2, 2 + n);
}
function makeCashOrderId() {
  // стабильный, чтобы повторный sync не плодил дублей
  // CASH-2026-01-04T12:34:56.789Z-a1b2c3
  return `CASH-${nowIso()}-${rand(6)}`;
}

/* seat label used in Supabase tickets.unique(show_slug, seat_label)
   ДОЛЖЕН совпадать с тем, что создаётся онлайн-продажей, иначе конфликт не сработает.
   Если у тебя онлайн использует другой формат — поменяй тут ОДИН раз. */
function seatLabelFromItem(it) {
  // самый безопасный — использовать it.key (если key уникален и стабилен)
  // Пример key: "parter_1_6:10-12" или "A0-M4"
  return String(it.key);
}

/* qr_payload format должен совпадать с parseQrPayload() в scan-ticket.ts:
   order:...|show:...|seat:...
*/
function makeQrPayload(order_id, show_slug, seat_label) {
  return `order:${order_id}|show:${show_slug}|seat:${seat_label}`;
}

/* ===================== SETTINGS / DATA LOAD ===================== */

async function loadSettings() {
  // ожидаем data/settings.json (как у тебя)
  // (если путь другой — поправь здесь один раз)
  const res = await fetch("../data/settings.json", { cache: "no-store" });
  if (!res.ok) {
    SETTINGS = {};
    CURRENCY = CURRENCY_FALLBACK;
    return;
  }
  SETTINGS = await res.json();
  CURRENCY = SETTINGS?.theatre?.currency || CURRENCY_FALLBACK;
}

async function loadAfisha() {
  // ожидаем data/afisha.json (если путь другой — поправь)
  const res = await fetch("../data/afisha.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не вдалося завантажити afisha.json");
  afisha = await res.json();
  if (!Array.isArray(afisha)) afisha = [];
}

async function loadHallSchema() {
  // ожидаем data/hall.json (или schema.json). Подстрой под свой репо.
  // Если у тебя зал лежит иначе — поменяй путь тут.
  const res = await fetch("../data/hall.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Не вдалося завантажити hall.json");
  hallSchema = await res.json();
  return hallSchema;
}

/* ===================== STATE STORAGE ===================== */

function loadStateForShow() {
  seatState = new Map();
  basket = [];
  reserves = [];
  ops = [];

  const ss = safeJsonParse(localStorage.getItem(lsKey("seatState")) || "{}", {});
  for (const [k, v] of Object.entries(ss)) seatState.set(k, v);

  reserves = safeJsonParse(localStorage.getItem(lsKey("reserves")) || "[]", []);
  ops = safeJsonParse(localStorage.getItem(lsKey("ops")) || "[]", []);

  updateBasketUI();
  renderRegistry();
}

function saveSeatState() {
  const obj = {};
  for (const [k, v] of seatState.entries()) obj[k] = v;
  localStorage.setItem(lsKey("seatState"), JSON.stringify(obj));
}
function saveReserves() {
  localStorage.setItem(lsKey("reserves"), JSON.stringify(reserves));
}
function saveOps() {
  localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
}

/* ===================== UI: ZONES / PRICES ===================== */

function getZoneLabel(zone) {
  // если в схеме у тебя есть подписи зон — подтяни тут
  return String(zone || "zone");
}

function renderPriceLegend() {
  const root = $("priceLegend");
  if (!root) return;
  root.innerHTML = "";

  // если у тебя есть pricing в settings — можно отрисовать
  const pd = SETTINGS?.pricing_defaults || {};
  const keys = Object.keys(pd);
  if (!keys.length) return;

  for (const k of keys) {
    const div = document.createElement("div");
    div.className = "legend-item";
    div.textContent = `${k}: ${pd[k]} ${CURRENCY}`;
    root.appendChild(div);
  }
}

/* ===================== HALL RENDER ===================== */

function findSeatButtonByKey(key) {
  return document.querySelector(`[data-seat-key="${CSS.escape(key)}"]`);
}

function seatClassForState(st) {
  if (st === "sold") return "seat--sold";
  if (st === "reserved") return "seat--reserved";
  return "";
}

function toggleSeatInBasket(item) {
  const idx = basket.findIndex((x) => x.key === item.key);
  const btn = findSeatButtonByKey(item.key);
  const current = seatState.get(item.key) || "free";

  if (current === "sold" || current === "reserved") return;

  if (idx >= 0) {
    basket.splice(idx, 1);
    if (btn) btn.classList.remove("seat--selected");
  } else {
    basket.push(item);
    if (btn) btn.classList.add("seat--selected");
  }

  updateBasketUI();
}

function renderHall(schema) {
  const root = $("hall-root");
  if (!root) return;
  root.innerHTML = "";

  // schema ожидаем в твоём формате. Ниже — универсальный рендер под массив рядов.
  // Если у тебя другой формат — скажи, я подстрою, но сейчас делаем максимально “не ломая”.
  const rows = schema?.rows || [];
  for (const r of rows) {
    const rowWrap = document.createElement("div");
    rowWrap.className = "hall-row";

    const rowLabel = document.createElement("div");
    rowLabel.className = "row-label";
    rowLabel.textContent = r.row != null ? `Ряд ${r.row}` : "";
    rowWrap.appendChild(rowLabel);

    const seatsWrap = document.createElement("div");
    seatsWrap.className = "row-seats";

    const seatsCount = r.seats || 0;
    const offset = r.offset || 0;

    // оффсет пустых
    for (let i = 0; i < offset; i++) {
      const sp = document.createElement("span");
      sp.className = "seat-spacer";
      seatsWrap.appendChild(sp);
    }

    // по местам
    for (let s = 1; s <= seatsCount; s++) {
      const zone = (r.zones && r.zones[0] && r.zones[0].code) ? r.zones[0].code : (r.zone || "zone");
      const price = guessPrice(r, s);
      const key = `${zone}:${r.row}-${s}`;

      const btn = document.createElement("button");
      btn.className = "seat";
      btn.type = "button";
      btn.textContent = String(s);
      btn.dataset.seatKey = key;

      const st = seatState.get(key) || "free";
      const stCls = seatClassForState(st);
      if (stCls) btn.classList.add(stCls);

      btn.addEventListener("click", () => {
        const stNow = seatState.get(key) || "free";
        if (stNow === "sold" || stNow === "reserved") return;
        toggleSeatInBasket({ key, zone, row: r.row, seat: s, price });
      });

      seatsWrap.appendChild(btn);
    }

    rowWrap.appendChild(seatsWrap);
    root.appendChild(rowWrap);
  }
}

function guessPrice(rowObj, seatNum) {
  // если у тебя зоны/прайсы более сложные — тут можно расширить.
  // пока: берём price если есть, иначе pricing_defaults по первому ключу.
  if (typeof rowObj?.price === "number") return rowObj.price;
  const pd = SETTINGS?.pricing_defaults || {};
  const firstKey = Object.keys(pd)[0];
  if (firstKey) return Number(pd[firstKey]) || 0;
  return 0;
}

/* ===================== BASKET UI ===================== */

function updateBasketUI() {
  const list = $("basket-list");
  const sub = $("basket-sub");
  const totalEl = $("basket-total");
  const curEl = $("basket-currency");

  if (curEl) curEl.textContent = CURRENCY;

  if (!list) return;
  list.innerHTML = "";

  if (!basket.length) {
    if (sub) sub.textContent = "Поки що нічого не обрано.";
    if (totalEl) totalEl.textContent = "0";
    return;
  }

  if (sub) sub.textContent = `Обрано місць: ${basket.length}`;

  let total = 0;
  for (const it of basket) total += Number(it.price || 0);
  if (totalEl) totalEl.textContent = String(total);

  for (const it of basket) {
    const div = document.createElement("div");
    div.className = "basket-item";
    div.innerHTML = `
      <div class="b-main">
        <div class="b-seat"><b>${getZoneLabel(it.zone)}</b> • ряд ${it.row} • місце ${it.seat}</div>
        <div class="b-price">${it.price || 0} ${CURRENCY}</div>
      </div>
      <button class="b-remove" type="button">×</button>
    `;
    div.querySelector(".b-remove")?.addEventListener("click", () => {
      const idx = basket.findIndex((x) => x.key === it.key);
      if (idx >= 0) basket.splice(idx, 1);
      const btn = findSeatButtonByKey(it.key);
      if (btn) btn.classList.remove("seat--selected");
      updateBasketUI();
    });
    list.appendChild(div);
  }
}

/* ===================== REGISTRY (RESERVES) ===================== */

function groupReserves() {
  const map = new Map();
  for (const r of reserves) {
    const key = r.who || "—";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function renderRegistry() {
  const root = $("reserveRegistry");
  if (!root) return;
  root.innerHTML = "";

  if (!currentShowId) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">Оберіть спектакль, щоб бачити броні.</div>';
    return;
  }

  if (!reserves.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">Поки що броней немає.</div>';
    return;
  }

  const groups = groupReserves();
  for (const [who, items] of groups.entries()) {
    const allSeats = items.flatMap((x) => x.seats);
    const total = allSeats.reduce((s, i) => s + (i.price || 0), 0);

    const card = document.createElement("div");
    card.className = "registry-card";

    const head = document.createElement("div");
    head.className = "registry-head";
    head.innerHTML = `
      <div>
        <div class="registry-who">${who}</div>
        <div class="registry-meta">Місць: ${allSeats.length} • Сума: ${total} ${CURRENCY}</div>
      </div>
      <div class="registry-meta">${fmtDT(items[0]?.createdAt || "")}</div>
    `;
    card.appendChild(head);

    const rows = document.createElement("div");
    rows.className = "registry-rows";
    rows.textContent = allSeats.map((s) => `${getZoneLabel(s.zone)} ${s.row}-${s.seat}`).join(", ");
    card.appendChild(rows);

    const actions = document.createElement("div");
    actions.className = "registry-actions";

    const btnSell = document.createElement("button");
    btnSell.className = "btn btn-primary";
    btnSell.textContent = "Продати + друк";
    btnSell.addEventListener("click", () => {
      const show = afisha.find((x) => x.id === currentShowId);

      // фиксируем sold локально
      for (const s of allSeats) {
        seatState.set(s.key, "sold");
      }
      saveSeatState();

      // удаляем бронь
      reserves = reserves.filter((r) => r.who !== who);
      saveReserves();

      // ✅ операция продажи (важно: добавили cash_order_id)
      const cash_order_id = makeCashOrderId();
      ops.push({
        ts: nowIso(),
        showId: currentShowId,
        action: "sell_from_reserve",
        who,
        seats: allSeats,
        total,
        cash_order_id,
        synced_at: null,
        sync_error: null,
      });
      saveOps();

      for (const s of allSeats) {
        const btn = findSeatButtonByKey(s.key);
        if (btn) {
          btn.classList.remove("seat--selected", "seat--reserved");
          btn.classList.add("seat--sold");
        }
      }

      renderRegistry();
      openPrintBatch(allSeats, show);

      // если онлайн уже включён — можно попробовать синкнуть сразу
      autoSyncIfOnline();
    });

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn btn-secondary";
    btnCancel.textContent = "Скасувати бронь";
    btnCancel.addEventListener("click", () => {
      for (const s of allSeats) {
        seatState.set(s.key, "free");
        const btn = findSeatButtonByKey(s.key);
        if (btn) btn.classList.remove("seat--reserved", "seat--selected", "seat--sold");
      }
      saveSeatState();

      reserves = reserves.filter((r) => r.who !== who);
      saveReserves();

      ops.push({
        ts: nowIso(),
        showId: currentShowId,
        action: "cancel_reserve",
        who,
        seats: allSeats,
        total,
      });
      saveOps();

      renderRegistry();
    });

    actions.appendChild(btnSell);
    actions.appendChild(btnCancel);
    card.appendChild(actions);

    root.appendChild(card);
  }
}

/* ===================== CASHIER ACTIONS ===================== */

function clearBasketOnly() {
  for (const it of basket) {
    const btn = findSeatButtonByKey(it.key);
    if (btn) btn.classList.remove("seat--selected");
  }
  basket = [];
  updateBasketUI();
}

function applyReserve() {
  if (!currentShowId) { alert("Спочатку оберіть спектакль."); return; }
  if (!basket.length) return;

  const who = prompt("Хто бронює? (ПІБ / телефон / організація)", "");
  if (!who) return;

  for (const it of basket) {
    seatState.set(it.key, "reserved");
    const btn = findSeatButtonByKey(it.key);
    if (btn) {
      btn.classList.remove("seat--selected", "seat--sold");
      btn.classList.add("seat--reserved");
    }
  }
  saveSeatState();

  reserves.push({
    showId: currentShowId,
    who,
    createdAt: nowIso(),
    seats: basket.slice(),
  });
  saveReserves();

  const total = basket.reduce((s, i) => s + (i.price || 0), 0);
  ops.push({ ts: nowIso(), showId: currentShowId, action: "reserve", who, seats: basket.slice(), total });
  saveOps();

  basket = [];
  updateBasketUI();
  renderRegistry();
}

function applyUnreserve() {
  if (!currentShowId) { alert("Оберіть спектакль."); return; }
  if (!reserves.length) return;

  const who = prompt("Скасувати бронь для (точно як у реєстрі):", "");
  if (!who) return;

  const found = reserves.filter((r) => r.who === who);
  if (!found.length) {
    alert("Не знайдено бронь для цього імені.");
    return;
  }

  const allSeats = found.flatMap((x) => x.seats);
  for (const s of allSeats) {
    seatState.set(s.key, "free");
    const btn = findSeatButtonByKey(s.key);
    if (btn) btn.classList.remove("seat--reserved", "seat--selected", "seat--sold");
  }
  saveSeatState();

  reserves = reserves.filter((r) => r.who !== who);
  saveReserves();

  const total = allSeats.reduce((s, i) => s + (i.price || 0), 0);
  ops.push({ ts: nowIso(), showId: currentShowId, action: "unreserve", who, seats: allSeats, total });
  saveOps();

  renderRegistry();
}

function applySell() {
  if (!currentShowId) { alert("Спочатку оберіть спектакль."); return; }
  if (!basket.length) return;

  const show = afisha.find((x) => x.id === currentShowId);

  for (const it of basket) {
    seatState.set(it.key, "sold");
    const btn = findSeatButtonByKey(it.key);
    if (btn) {
      btn.classList.remove("seat--selected", "seat--reserved");
      btn.classList.add("seat--sold");
    }
  }
  saveSeatState();

  const total = basket.reduce((s, i) => s + (i.price || 0), 0);

  // ✅ операция продажи (важно: добавили cash_order_id)
  const cash_order_id = makeCashOrderId();
  ops.push({
    ts: nowIso(),
    showId: currentShowId,
    action: "sell",
    who: "",
    seats: basket.slice(),
    total,
    cash_order_id,
    synced_at: null,
    sync_error: null,
  });
  saveOps();

  const items = basket.slice();
  basket = [];
  updateBasketUI();

  openPrintBatch(items, show);

  autoSyncIfOnline();
}

/* ===================== PRINT (stub / your existing) ===================== */

function openPrintBatch(items, show) {
  // если у тебя уже есть своя печать — оставь её.
  // Тут сделан минимальный “не ломаем” вариант:
  console.log("PRINT batch", { show, items });
}

/* ===================== EXPORT CSV ===================== */

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(";")).join("\n");
}

function exportReserves() {
  if (!currentShowId) { alert("Оберіть спектакль."); return; }
  const rows = [["createdAt", "who", "zone", "row", "seat", "price", "currency", "showId"]];
  for (const r of reserves) {
    for (const s of r.seats) {
      rows.push([r.createdAt, r.who, getZoneLabel(s.zone), s.row, s.seat, s.price, CURRENCY, r.showId]);
    }
  }
  downloadText(`reserves_${currentShowId}.csv`, toCsv(rows));
}

function exportSales() {
  if (!currentShowId) { alert("Оберіть спектакль."); return; }
  const rows = [["ts", "action", "zone", "row", "seat", "price", "currency", "showId", "cash_order_id", "synced_at", "sync_error"]];
  for (const o of ops.filter((x) => x.action === "sell" || x.action === "sell_from_reserve")) {
    for (const s of o.seats) {
      rows.push([o.ts, o.action, getZoneLabel(s.zone), s.row, s.seat, s.price, CURRENCY, o.showId, o.cash_order_id || "", o.synced_at || "", o.sync_error || ""]);
    }
  }
  downloadText(`sales_${currentShowId}.csv`, toCsv(rows));
}

function exportOps() {
  if (!currentShowId) { alert("Оберіть спектакль."); return; }
  const rows = [["ts", "action", "who", "count", "total", "showId", "cash_order_id", "synced_at", "sync_error", "seats"]];
  for (const o of ops) {
    const seatsStr = (o.seats || []).map((s) => `${s.zone}:${s.row}-${s.seat}`).join(",");
    rows.push([o.ts, o.action, o.who || "", (o.seats || []).length, o.total || 0, o.showId, o.cash_order_id || "", o.synced_at || "", o.sync_error || "", seatsStr]);
  }
  downloadText(`ops_${currentShowId}.csv`, toCsv(rows));
}

/* ===================== SHOW SELECTOR ===================== */

function setCurrentShowHeader() {
  const showEl = $("admin-current-show");
  if (!showEl) return;

  const s = afisha.find((x) => x.id === currentShowId);
  if (!s) {
    showEl.textContent = "Сеанс: (не обрано)";
    return;
  }
  showEl.textContent = `Сеанс: ${s.title} — ${s.date}, ${s.time}`;
}

function fillShowSelect() {
  const sel = $("showSelect");
  if (!sel) return;

  sel.innerHTML = '<option value="">— обрати —</option>';

  for (const s of afisha) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.title} — ${s.date}, ${s.time}`;
    sel.appendChild(opt);
  }

  sel.value = currentShowId || "";
  sel.addEventListener("change", () => {
    currentShowId = sel.value || "";
    setCurrentShowHeader();
    loadStateForShow();
    renderHall(hallSchema);
    updateBasketUI();
    renderRegistry();
  });
}

/* ===================== OFFLINE SYNC TO SUPABASE ===================== */

/**
 * Требования:
 * - Supabase URL + anon key доступны (settings.json или хардкод)
 * - таблицы: orders, payments, tickets (как у тебя)
 * - tickets unique(show_slug, seat_label) защищает от дублей
 *
 * Что создаём:
 * orders: order_id=cash_order_id, status=paid, amount=total, currency=UAH/...
 * payments: order_id=cash_order_id, status=paid, raw={source: cashier_offline, ts, ...}
 * tickets: по каждому месту
 */
function getSupabaseCfg() {
  const url =
    SETTINGS?.supabase?.url ||
    SETTINGS?.supabase_url ||
    HARD_SUPABASE_URL ||
    "";

  const anon =
    SETTINGS?.supabase?.anon_key ||
    SETTINGS?.supabase_anon_key ||
    HARD_SUPABASE_ANON_KEY ||
    "";

  return {
    url: String(url || "").replace(/\/+$/, ""),
    anon: String(anon || ""),
  };
}

function supaHeaders() {
  const { anon } = getSupabaseCfg();
  if (!anon) return null;
  return {
    apikey: anon,
    Authorization: "Bearer " + anon,
    "Content-Type": "application/json",
  };
}

async function supaInsert(table, row) {
  const { url } = getSupabaseCfg();
  const headers = supaHeaders();
  if (!url || !headers) throw new Error("Supabase URL / ANON key не налаштовані");
  const r = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${table} insert failed: HTTP ${r.status} ${t}`);
  }
  return true;
}

async function supaUpdate(table, matchObj, patchObj) {
  const { url } = getSupabaseCfg();
  const headers = supaHeaders();
  if (!url || !headers) throw new Error("Supabase URL / ANON key не налаштовані");

  // строим query eq.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(matchObj || {})) qs.set(k, `eq.${v}`);

  const r = await fetch(`${url}/rest/v1/${table}?${qs.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patchObj),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${table} update failed: HTTP ${r.status} ${t}`);
  }
  return true;
}

async function supaGetOnlineEnabled() {
  // settings table (если есть) — не обязательно для синка, только для авто
  const { url } = getSupabaseCfg();
  const headers = supaHeaders();
  if (!url || !headers) return null;

  const r = await fetch(
    `${url}/rest/v1/settings?select=online_sales_enabled,updated_at&order=updated_at.desc&limit=1`,
    { headers }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.online_sales_enabled ?? null;
}

async function syncOneOpToSupabase(op) {
  // только продажи
  if (!(op.action === "sell" || op.action === "sell_from_reserve")) return { ok: true, skipped: true };

  const cashOrderId = op.cash_order_id;
  if (!cashOrderId) return { ok: false, error: "no cash_order_id" };

  const show_slug = op.showId; // если у тебя show_slug другой — подстрой тут
  const amount = Number(op.total || 0);
  const currency = SETTINGS?.payments?.currency || "UAH";

  // 1) orders
  await supaInsert("orders", {
    order_id: cashOrderId,
    show_slug,
    seats: (op.seats || []).map(seatLabelFromItem),
    amount,
    currency,
    status: "paid",
    buyer_name: op.who || null,
    buyer_email: null,
    created_at: op.ts || nowIso(),
    updated_at: nowIso(),
    idempotency_key: cashOrderId, // чтобы и тут был идемпотентный след
  });

  // 2) payments
  await supaInsert("payments", {
    order_id: cashOrderId,
    amount,
    currency,
    status: "paid",
    raw: {
      source: "cashier_offline",
      ts: op.ts || null,
      action: op.action,
      who: op.who || "",
    },
    created_at: nowIso(),
  });

  // 3) tickets
  for (const it of (op.seats || [])) {
    const seat_label = seatLabelFromItem(it);
    await supaInsert("tickets", {
      order_id: cashOrderId,
      show_slug,
      seat_label,
      price: Number(it.price || 0),
      buyer_name: op.who || null,
      buyer_email: null,
      qr_payload: makeQrPayload(cashOrderId, show_slug, seat_label),
      pdf_url: null,
      created_at: nowIso(),
    });
  }

  return { ok: true };
}

async function syncOpsToSupabase({ onlyShowId = null } = {}) {
  const { url, anon } = getSupabaseCfg();
  if (!url || !anon) {
    alert("Для синхронізації потрібні Supabase URL та ANON key. Додай їх у data/settings.json (supabase.url + supabase.anon_key) або в admin.js.");
    return;
  }

  // только несинкнутые продажи
  const pending = ops
    .map((o, idx) => ({ o, idx }))
    .filter(({ o }) => (o.action === "sell" || o.action === "sell_from_reserve"))
    .filter(({ o }) => !o.synced_at)
    .filter(({ o }) => (onlyShowId ? o.showId === onlyShowId : true));

  if (!pending.length) {
    alert("Немає операцій для синхронізації ✅");
    return;
  }

  let okCount = 0;
  let failCount = 0;

  for (const { o, idx } of pending) {
    try {
      await syncOneOpToSupabase(o);
      ops[idx].synced_at = nowIso();
      ops[idx].sync_error = null;
      okCount++;
      saveOps();
    } catch (e) {
      // частая ситуация: конфликт (место уже существует) или order_id уже есть
      ops[idx].sync_error = String(e?.message || e);
      failCount++;
      saveOps();
    }
  }

  alert(`Синхронізація завершена.\nУспішно: ${okCount}\nЗ помилкою: ${failCount}\n\n(Деталі — в ops export CSV)`);
}

async function autoSyncIfOnline() {
  // если есть settings.online_sales_enabled и он true — синкаем сразу
  try {
    const enabled = await supaGetOnlineEnabled();
    if (enabled === true) {
      await syncOpsToSupabase({ onlyShowId: currentShowId || null });
    }
  } catch {
    // молча
  }
}

/* Добавим “страховочную” кнопку синхронизации, если её нет в HTML —
   можно вызвать вручную из консоли: window.syncNow()
*/
function initSyncButtonIfExists() {
  // если ты добавишь кнопку в admin.html:
  // <button id="btn-sync" class="btn btn-secondary">Синхронізація</button>
  const btn = $("btn-sync");
  if (!btn) return;
  btn.addEventListener("click", () => syncOpsToSupabase({ onlyShowId: currentShowId || null }));
}

window.syncNow = () => syncOpsToSupabase({ onlyShowId: currentShowId || null });

/* ===================== SCANNER (embedded) — оставлено как “не ломаем” ===================== */

const SCAN_LS_SECRET = LS_PREFIX + "scanner_secret";

function getScanEndpoint() {
  const u = SETTINGS?.supabase_url || SETTINGS?.supabase?.url || HARD_SUPABASE_URL || "";
  if (u && typeof u === "string") return u.replace(/\/+$/, "") + "/functions/v1/scan-ticket";
  // fallback (у тебя project ref fhusjlkneckbvnrdhbil)
  return "https://fhusjlkneckbvnrdhbil.supabase.co/functions/v1/scan-ticket";
}

let qrScanner = null;
let scanCooldown = false;
let lastQrText = "";

function setScanResult(state, statusText, detailsText, qrText) {
  const box = $("scanResult");
  if (!box) return;
  box.classList.remove("ok", "warn", "bad");
  box.classList.add(state);

  const st = $("scanStatus");
  const det = $("scanDetails");
  const qr = $("scanQr");
  if (st) st.textContent = statusText || "";
  if (det) det.textContent = detailsText || "—";
  if (qr) qr.textContent = qrText || "—";
}

function ensureScannerModal() {
  // если у тебя уже есть свой UI — этот блок просто не сработает
  if ($("scannerModal")) return;

  const modal = document.createElement("div");
  modal.id = "scannerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999;padding:14px;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:900px;width:100%;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #eee;">
        <b>Сканер квитків</b>
        <button id="btnScanClose" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:12px;padding:14px;">
        <div>
          <div id="scanReader" style="width:100%;min-height:260px;border:1px dashed #cbd5e1;border-radius:12px;"></div>
          <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
            <button id="btnScanStart" class="btn btn-primary">▶ Запустити</button>
            <button id="btnScanStop" class="btn btn-secondary" disabled>■ Зупинити</button>
          </div>
          <div style="margin-top:8px;color:#64748b;font-size:12px;">
            Камера працює тільки по <b>HTTPS</b>. GitHub Pages — ок.
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:#64748b;">Контролер / Вхід</label>
          <input id="scanGate" class="input" value="gate-1" style="width:100%;margin:6px 0 10px;" />
          <label style="display:block;font-size:12px;color:#64748b;">SCANNER_SECRET</label>
          <input id="scanSecret" class="input" placeholder="встав код (разово)" style="width:100%;margin:6px 0 6px;" />
          <button id="btnScanClearSecret" class="btn btn-ghost" style="padding:6px 0;">Очистити secret</button>

          <div id="scanResult" class="status ok" style="margin-top:10px;padding:10px;border-radius:12px;border:1px solid #e5e7eb;">
            <div><b>Статус:</b> <span id="scanStatus">Готово</span></div>
            <div style="color:#64748b;font-size:12px;margin-top:4px;" id="scanDetails">—</div>
            <div style="margin-top:6px;font-size:12px;"><b>QR:</b> <span id="scanQr">—</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  $("btnScanClose")?.addEventListener("click", closeScanner);
  $("btnScanStart")?.addEventListener("click", startScanner);
  $("btnScanStop")?.addEventListener("click", stopScanner);
  $("btnScanClearSecret")?.addEventListener("click", () => {
    localStorage.removeItem(SCAN_LS_SECRET);
    const inp = $("scanSecret");
    if (inp) inp.value = "";
    setScanResult("ok", "Secret очищено", "Вставте SCANNER_SECRET знову при потребі.", "");
  });
}

function openScanner() {
  ensureScannerModal();
  const modal = $("scannerModal");
  if (modal) modal.style.display = "flex";

  // подхват secret
  const saved = localStorage.getItem(SCAN_LS_SECRET) || "";
  const inp = $("scanSecret");
  if (inp && saved) inp.value = saved;

  setScanResult("ok", "Готово", "Запустіть камеру і скануйте QR.", "");
}

function closeScanner() {
  stopScanner().finally(() => {
    const modal = $("scannerModal");
    if (modal) modal.style.display = "none";
  });
}

async function sendScanToServer(qr_payload) {
  const endpoint = getScanEndpoint();
  const gate = ( $("scanGate")?.value || "gate-1" ).trim();
  const secret = ( $("scanSecret")?.value || "" ).trim();

  if (!secret) {
    setScanResult("warn", "Потрібен secret", "Вставте SCANNER_SECRET і повторіть сканування.", qr_payload);
    throw new Error("secret required");
  }
  localStorage.setItem(SCAN_LS_SECRET, secret);

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scanner-secret": secret,
    },
    body: JSON.stringify({ qr_payload, checked_in_by: gate }),
  });

  const data = await r.json().catch(() => ({}));

  if (r.status === 401) {
    setScanResult("bad", "Доступ заборонено", "Невірний SCANNER_SECRET (401).", qr_payload);
    return;
  }
  if (r.status === 404) {
    setScanResult("bad", "Недійсний квиток", "Ticket not found (404).", qr_payload);
    return;
  }
  if (r.status === 409) {
    const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
    setScanResult("warn", "Вже використано", at ? `Погашено: ${at}` : "Квиток вже погашений.", qr_payload);
    return;
  }
  if (!r.ok || data?.ok === false) {
    setScanResult("bad", "Помилка", data?.error ? String(data.error) : `HTTP ${r.status}`, qr_payload);
    return;
  }

  const at = data?.checked_in_at || data?.ticket?.checked_in_at || "";
  const seat = data?.ticket?.seat_label ? `Місце: ${data.ticket.seat_label}` : "";
  setScanResult("ok", "Пропустити", [seat, at ? `Погашено: ${at}` : ""].filter(Boolean).join(" • "), qr_payload);
}

async function onScanSuccess(decodedText) {
  if (scanCooldown) return;
  const text = String(decodedText || "").trim();
  if (!text) return;

  if (text === lastQrText) return;
  lastQrText = text;

  scanCooldown = true;
  try {
    await sendScanToServer(text);
  } finally {
    setTimeout(() => { scanCooldown = false; }, 1200);
  }
}

async function startScanner() {
  // html5-qrcode должен быть подключён в admin.html, иначе просто не стартанёт
  if (!window.Html5Qrcode) {
    setScanResult("bad", "Немає бібліотеки", "Html5Qrcode не завантажено.", "");
    return;
  }

  $("btnScanStart") && ($("btnScanStart").disabled = true);

  try {
    qrScanner = new Html5Qrcode("scanReader");
    await qrScanner.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: { width: 280, height: 280 } },
      onScanSuccess
    );

    $("btnScanStop") && ($("btnScanStop").disabled = false);
    setScanResult("ok", "Камера працює", "Скануйте QR квитка.", "");
  } catch (e) {
    $("btnScanStart") && ($("btnScanStart").disabled = false);
    $("btnScanStop") && ($("btnScanStop").disabled = true);
    setScanResult("bad", "Помилка камери", String(e?.message || e), "");
  }
}

async function stopScanner() {
  $("btnScanStop") && ($("btnScanStop").disabled = true);
  try {
    if (qrScanner) {
      await qrScanner.stop();
      await qrScanner.clear();
      qrScanner = null;
    }
    $("btnScanStart") && ($("btnScanStart").disabled = false);
  } catch {
    $("btnScanStart") && ($("btnScanStart").disabled = false);
  }
}

function initScannerUI() {
  // если в HTML есть кнопка:
  // <button id="btn-open-scanner" class="btn btn-secondary">Сканер</button>
  const btn = $("btn-open-scanner");
  if (btn) btn.addEventListener("click", openScanner);
}

/* ===================== INIT ===================== */

async function initAdminPage() {
  await loadSettings();
  await loadAfisha();
  const schema = await loadHallSchema();

  const nameEl = $("admin-theatre-name");
  if (nameEl && SETTINGS?.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  const dateEl = $("admin-current-date");
  if (dateEl) dateEl.textContent = new Date().toLocaleString("uk-UA");

  fillShowSelect();
  setCurrentShowHeader();

  // default show = first
  if (!currentShowId && afisha.length) {
    currentShowId = afisha[0].id;
    const sel = $("showSelect");
    if (sel) sel.value = currentShowId;
    setCurrentShowHeader();
  }

  loadStateForShow();

  renderHall(schema);
  renderPriceLegend();
  updateBasketUI();
  renderRegistry();

  $("btn-sell")?.addEventListener("click", applySell);
  $("btn-reserve")?.addEventListener("click", applyReserve);
  $("btn-unreserve")?.addEventListener("click", applyUnreserve);
  $("btn-clear")?.addEventListener("click", clearBasketOnly);

  $("btn-export-reserves")?.addEventListener("click", exportReserves);
  $("btn-export-sales")?.addEventListener("click", exportSales);
  $("btn-export-ops")?.addEventListener("click", exportOps);

  initScannerUI();
  initSyncButtonIfExists();
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage().catch((err) => {
    console.error("Помилка ініціалізації адмінки", err);
    alert("Помилка ініціалізації адмінки. Відкрий консоль (F12) і покажи помилку.");
  });
});
