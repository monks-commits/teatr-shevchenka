// backoffice/app.js (REPLACE FULL FILE)
// Требует: ../scripts/hallRenderer.js подключен на странице backoffice (до app.js)

(() => {
  const { qs, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v1_";

  let SETTINGS = { theatre: {}, pricing_defaults: {}, pricing_defaults_fallback: {} };
  let AFISHA = [];
  let current = null; // {id,title,date,time,...}
  let seance = null;  // data/seances/*.json
  let hall = null;    // data/halls/*.json
  let currency = "грн";

  // state per seance
  let seatStatus = new Map(); // seat_label -> status (free/reserved/sold/realization/invite/blocked/external)
  let basket = [];            // [{key,label,price}]
  let ops = [];               // log operations
  let zoom = 1;

  // -------------------- key helpers --------------------
  function keyToHuman(k) {
    // используем общий humanize если есть
    if (window.HallRenderer?.humanizeSeatKey) return window.HallRenderer.humanizeSeatKey(k);

    const m = String(k).match(/^([PAB])(\d+)-M(\d+)$/i);
    if (!m) return k;
    const prefix = m[1].toUpperCase();
    const row = Number(m[2]);
    const seat = Number(m[3]);

    if (prefix === "P") return `Партер • ряд ${row} • місце ${seat}`;
    if (prefix === "A") return row === 0 ? `Ложа A • місце ${seat}` : `Амфітеатр • ряд ${row} • місце ${seat}`;
    if (prefix === "B") return row === 0 ? `Ложа B • місце ${seat}` : `Балкон • ряд ${row} • місце ${seat}`;
    return k;
  }

  // поддержка старого формата places: "1-2" и "boxA-5"
  function normalizePlaceKeyToSeatLabel(k) {
    const s = String(k || "").trim();
    if (!s) return "";
    if (/^[PAB]\d+-M\d+$/i.test(s)) return s;

    const box = s.match(/^box([ab])-(\d+)$/i);
    if (box) {
      const idx = Number(box[2]);
      return box[1].toLowerCase() === "a" ? `A0-M${idx}` : `B0-M${idx}`;
    }

    const simple = s.match(/^(\d+)-(\d+)$/);
    if (simple) {
      const row = Number(simple[1]);
      const seat = Number(simple[2]);
      return `P${row}-M${seat}`;
    }

    return s;
  }

  // -------------------- pricing helpers --------------------
  function priceByGroup(groupKey) {
    const sp = (seance && seance.prices)
