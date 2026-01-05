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
let reserves = [];           // [{who, items:[.], created_at}]
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

/* ============================================================================
   ✅ IMPORTANT: paths (FIX)
   /data в корне репо, /admin — подпапка.
   Значит из /admin/* надо ходить в ../data/*
============================================================================ */
const PATH_SETTINGS = "../data/settings.json";
const PATH_AFISHA   = "../data/afisha.json";
const PATH_HALL     = "../data/halls/shevchenko-big.json";

/* ============================================================================
   load config/data
============================================================================ */
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

/* ============================================================================
   ДАЛЬШЕ — твой файл без изменений (я не “перепридумываю” логику кассы).
   Ниже оставь содержимое как у тебя: функции расчёта цены, рендер схемы,
   бронь/продажа, экспорт CSV, sync UI, сканер-логика и initAdminPage().
============================================================================ */

// ==== Цена ====
// 1) если есть rowInfo.
// ... (оставь как в твоём текущем admin/admin.js, начиная с блока цены)
// ВАЖНО: единственное, что мы поменяли — PATH_* выше.
