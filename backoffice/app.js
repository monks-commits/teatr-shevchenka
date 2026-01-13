// backoffice/app.js  (FULL REPLACE)
(() => {
  const { qs, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v1_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];

  let current = null; // afisha item
  let seance = null;  // data/seances/*.json
  let hall = null;    // data/halls/*.json

  let currency = "грн";

  // state per seance
  let seatStatus = new Map(); // key -> status
  let basket = [];            // [{key,label,price}]
  let ops = [];               // log operations

  // zoom
  let zoom = 1;

  // -------------------- keys & helpers --------------------
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  // New format: "parter:1-1", "amphi:19-5", "balcony:1-1", "boxA-1"
  function seatKey(zone, row, seat) {
    if (zone === "box") return String(row); // row = "boxA-1"
    return `${zone}:${row}-${seat}`;
  }

  // Backward compat: seance.places can have:
  // - "19-5"  -> amphi:19-5 (if row >= 19)
  // - "1-1"   -> parter:1-1 (by your current convention)
  // - "boxA-1" -> as is
  // Balcony legacy without zone is impossible (conflicts with parter).
  function normalizePlaceKey(k) {
    const key = String(k || "").trim();
    if (!key) return "";

    if (key.includes(":")) return key; // already new format
    if (key.startsWith("boxA-") || key.startsWith("boxB-")) return key;

    const m = key.match(/^(\d+)-(\d+)$/);
    if (!m) return key;

    const row = Number(m[1]);

    // by your seance example: 19..23 = amphi
    if (row >= 19) return `amphi:${key}`;

    // rows 1..18 считаем партером (как у тебя сейчас)
    return `parter:${key}`;
  }

  function zoneLabel(zone) {
    return hall?.zones?.[zone]?.label || (
      zone === "parter" ? "Партер" :
      zone === "amphi" ? "Амфітеатр" :
      zone === "balcony" ? "Балкон" : zone
    );
  }

  function seatLabelFromKey(k) {
    const key = String(k || "");
    if (key.startsWith("boxA-")) return `Ложа A • місце ${key.split("-")[1]}`;
    if (key.startsWith("boxB-")) return `Ложа Б • місце ${key.split("-")[1]}`;

    const m = key.match(/^([a-z]+):(\d+)-(\d+)$/i);
    if (!m) return key;
    const zone = m[1];
    const row = m[2];
    const seat = m[3];
    return `${zoneLabel(zone)} • ряд ${row} • місце ${seat}`;
  }

  function isLockedStatus(st) {
    return st === "sold" || st === "blocked";
  }

  function humanActionName(status) {
    switch (status) {
      case "sold": return "ПРОДАЖ";
      case "reserved": return "РЕЗЕРВ";
      case "realization": return "РЕАЛІЗАЦІЯ";
      case "invite": return "ЗАПРОШЕННЯ";
      default: return status;
    }
  }

  function totalBasket() {
    return basket.reduce((s, i) => s + (Number(i.price) || 0), 0);
  }

  function getPriceByGroup(price_group) {
    const p = seance?.prices || {};
    const d = SETTINGS?.pricing_defaults || {};
    if (p && p[price_group] != null) return Number(p[price_group]) || 0;
    if (d && d[price_group] != null) return Number(d[price_group]) || 0;
    return 0;
  }

  // -------------------- load/save local state --------------------
  function loadLocalState() {
    seatStatus = new Map();
    basket = [];
    ops = [];

    const rawSeat = localStorage.getItem(lsKey("seatStatus"));
    if (rawSeat) {
      try {
        const obj = JSON.parse(rawSeat);
        for (const [k, v] of Object.entries(obj)) seatStatus.set(k, v);
      } catch {}
    }

    const rawOps = localStorage.getItem(lsKey("ops"));
    if (rawOps) {
      try { ops = JSON.parse(rawOps) || []; } catch { ops = []; }
    }

    syncUI();
  }

  function saveSeatStatus() {
    const obj = {};
    for (const [k, v] of seatStatus.entries()) obj[k] = v;
    localStorage.setItem(lsKey("seatStatus"), JSON.stringify(obj));
  }

  function saveOps() {
    localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
  }

  // -------------------- rendering hall --------------------
  function setZoom(value) {
    zoom = Math.max(0.6, Math.min(1.8, value));
    const root = qs("#hallRoot");
    if (root) root.style.transform = `scale(${zoom})`;
  }

  function seatDom(key, label, price, aisleAfter = null, seatNumber = null) {
    const btn = document.createElement("button");
    btn.className = "seat";
    btn.type = "button";
    btn.dataset.key = key;

    const base = seatStatus.get(key) || "free";
    const inBasket = basket.some(x => x.key === key);
    const st = inBasket ? "basket" : base;

    btn.dataset.st = st;
    btn.title = `${label}\n${price} ${currency}\nСтатус: ${base}`;
    btn.textContent = seatNumber != null ? String(seatNumber) : (key.split("-")[1] || "");

    if (isLockedStatus(base)) btn.disabled = true;

    btn.addEventListener("click", () => {
      const b = seatStatus.get(key) || "free";
      if (isLockedStatus(b)) return;

      const idx = basket.findIndex(x => x.key === key);
      if (idx >= 0) basket.splice(idx, 1);
      else basket.push({ key, label, price });

      btn.dataset.st = basket.some(x => x.key === key) ? "basket" : b;
      syncUI();
    });

    // aisle marker
    if (aisleAfter && Number(aisleAfter) === Number(seatNumber)) {
      btn.classList.add("gapRight");
    }

    return btn;
  }

  function renderSectionTitle(text) {
    const root = qs("#hallRoot");
    const t = document.createElement("div");
    t.className = "sectionTitle";
    t.textContent = text;
    root.appendChild(t);
  }

  function renderSimpleRow(zone, rowNum, seatsCount, aisleAfter, price_group) {
    const root = qs("#hallRoot");

    const line = document.createElement("div");
    line.className = "rowLine";

    const lab = document.createElement("div");
    lab.className = "rowLabel";
    lab.textContent = String(rowNum);
    line.appendChild(lab);

    const rowWrap = document.createElement("div");
    rowWrap.className = "seatsRow";

    const price = getPriceByGroup(price_group);

    for (let s = 1; s <= seatsCount; s++) {
      const key = seatKey(zone, rowNum, s);
      const lbl = `${zoneLabel(zone)} • ряд ${rowNum} • місце ${s}`;
      rowWrap.appendChild(seatDom(key, lbl, price, aisleAfter, s));
    }

    line.appendChild(rowWrap);
    root.appendChild(line);
  }

  function renderAmphiRow(rowNum, seatsLeft, seatsRight, price_group) {
    const root = qs("#hallRoot");
    const line = document.createElement("div");
    line.className = "rowLine";

    const lab = document.createElement("div");
    lab.className = "rowLabel";
    lab.textContent = String(rowNum);
    line.appendChild(lab);

    const wrap = document.createElement("div");
    wrap.className = "seatsRow";

    const price = getPriceByGroup(price_group);

    // left
    for (let s = 1; s <= seatsLeft; s++) {
      const key = seatKey("amphi", rowNum, s);
      const lbl = `${zoneLabel("amphi")} • ряд ${rowNum} • місце ${s}`;
      wrap.appendChild(seatDom(key, lbl, price, null, s));
    }

    // gap
    const gap = document.createElement("div");
    gap.style.width = "18px";
    gap.style.flex = "0 0 18px";
    wrap.appendChild(gap);

    // right seats continue numbering after left
    for (let s = 1; s <= seatsRight; s++) {
      const seatNo = seatsLeft + s;
      const key = seatKey("amphi", rowNum, seatNo);
      const lbl = `${zoneLabel("amphi")} • ряд ${rowNum} • місце ${seatNo}`;
      wrap.appendChild(seatDom(key, lbl, price, null, seatNo));
    }

    line.appendChild(wrap);
    root.appendChild(line);
  }

  function renderBoxes() {
    const root = qs("#hallRoot");
    const boxes = Array.isArray(hall?.boxes) ? hall.boxes : [];
    if (!boxes.length) return;

    renderSectionTitle("Ложі");

    for (const box of boxes) {
      const line = document.createElement("div");
      line.className = "rowLine";

      const lab = document.createElement("div");
      lab.className = "rowLabel";
      lab.textContent = String(box.label || box.id || "BOX");
      line.appendChild(lab);

      const rowWrap = document.createElement("div");
      rowWrap.className = "seatsRow";

      const seats = Number(box.seats || 0);
      const price = getPriceByGroup(box.price_group || "p_boxes");

      for (let i = 1; i <= seats; i++) {
        const key = `${box.id}-${i}`; // "boxA-1"
        const lbl = `${box.label || box.id} • місце ${i}`;
        rowWrap.appendChild(seatDom(key, lbl, price, null, i));
      }

      line.appendChild(rowWrap);
      root.appendChild(line);
    }
  }

  function renderHall() {
    const root = qs("#hallRoot");
    if (!root) return;
    root.innerHTML = "";

    if (!current || !seance || !hall) {
      root.innerHTML = `<div class="muted">Оберіть сеанс, щоб побачити зал.</div>`;
      return;
    }

    // group rows by zone
    const rows = Array.isArray(hall.rows) ? hall.rows.slice() : [];

    const parter = rows.filter(x => x.zone === "parter");
    const amphi = rows.filter(x => x.zone === "amphi");
    const balcony = rows.filter(x => x.zone === "balcony");

    if (parter.length) {
      renderSectionTitle("Партер");
      for (const r of parter) {
        renderSimpleRow("parter", r.row, r.seats, r.aisle_after, r.price_group);
      }
    }

    renderBoxes();

    if (amphi.length) {
      renderSectionTitle("Амфітеатр");
      for (const r of amphi) {
        // supports seats_left / seats_right
        const L = Number(r.seats_left || 0);
        const R = Number(r.seats_right || 0);
        renderAmphiRow(r.row, L, R, r.price_group);
      }
    }

    if (balcony.length) {
      renderSectionTitle("Балкон");
      for (const r of balcony) {
        // balcony row 6 can be split too, but you already have seats=20 + left/right
        if (r.seats_left != null || r.seats_right != null) {
          const L = Number(r.seats_left || 0);
          const R = Number(r.seats_right || 0);
          // here numbering is continuous 1..(L+R)
          renderAmphiRow(r.row, L, R, r.price_group); // same visual style
        } else {
          renderSimpleRow("balcony", r.row, r.seats, r.aisle_after, r.price_group);
        }
      }
    }

    setZoom(zoom);
  }

  // -------------------- UI sync --------------------
  function syncUI() {
    // basket
    const meta = qs("#basketMeta");
    const list = qs("#basketList");
    const totalEl = qs("#basketTotal");

    if (meta) meta.textContent = basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";
    if (totalEl) totalEl.textContent = String(totalBasket());

    renderBasket(list, basket, currency);
    renderOps(qs("#opsList"), ops);

    // update all seat buttons data-st
    const hallRoot = qs("#hallRoot");
    if (hallRoot) {
      hallRoot.querySelectorAll(".seat[data-key]").forEach(btn => {
        const key = btn.dataset.key;
        const base = seatStatus.get(key) || "free";
        const inB = basket.some(x => x.key === key);
        btn.dataset.st = inB ? "basket" : base;
        if (isLockedStatus(base)) btn.setAttribute("disabled", "disabled");
        else btn.removeAttribute("disabled");
      });
    }

    const curEl = qs("#currency");
    if (curEl) curEl.textContent = currency;
  }

  // -------------------- actions --------------------
  function clearBasket() {
    basket = [];
    syncUI();
  }

  function applyToBasket(status) {
    if (!current) { alert("Оберіть сеанс."); return; }
    if (!basket.length) return;

    const seatKeys = basket.map(x => x.key);
    for (const k of seatKeys) seatStatus.set(k, status);
    saveSeatStatus();

    ops.push({
      ts: nowIso(),
      tsHuman: fmtDT(Date.now()),
      action: humanActionName(status),
      status,
      showId: current.id,
      showLabel: `${current.title} — ${current.date} ${current.time}`,
      count: seatKeys.length,
      total: totalBasket(),
      currency,
      seats: seatKeys
    });
    saveOps();

    clearBasket();
    syncUI();
  }

  const sell = () => applyToBasket("sold");
  const reserve = () => applyToBasket("reserved");
  const realize = () => applyToBasket("realization");
  const invite = () => applyToBasket("invite");

  function exportStateJson() {
    if (!current) { alert("Оберіть сеанс."); return; }
    const obj = {};
    for (const [k, v] of seatStatus.entries()) obj[k] = v;
    downloadText(
      `backoffice_state_${current.id}_${current.date}.json`,
      JSON.stringify({ show: current, seance, state: obj, ops }, null, 2)
    );
  }

  function exportSalesCsv() {
    if (!current) { alert("Оберіть сеанс."); return; }
    const rows = [["ts", "action", "seat", "status", "total", "currency", "showId", "showDate"]];
    for (const o of ops) {
      if (o.action !== "ПРОДАЖ") continue;
      for (const s of (o.seats || [])) {
        rows.push([o.ts, o.action, s, o.status, o.total, o.currency, o.showId, current.date]);
      }
    }
    downloadText(`backoffice_sales_${current.id}_${current.date}.csv`, toCsv(rows));
  }

  function exportOpsCsv() {
    if (!current) { alert("Оберіть сеанс."); return; }
    const rows = [["ts", "action", "count", "total", "currency", "showId", "seats"]];
    for (const o of ops) rows.push([o.ts, o.action, o.count, o.total, o.currency, o.showId, (o.seats || []).join(",")]);
    downloadText(`backoffice_ops_${current.id}_${current.date}.csv`, toCsv(rows));
  }

  function exportOpsJson() {
    if (!current) { alert("Оберіть сеанс."); return; }
    downloadText(`backoffice_ops_${current.id}_${current.date}.json`, JSON.stringify(ops, null, 2));
  }

  function clearOps() {
    if (!current) return;
    ops = [];
    saveOps();
    syncUI();
  }

  function resetLocal() {
    if (!current) return;
    localStorage.removeItem(lsKey("seatStatus"));
    localStorage.removeItem(lsKey("ops"));
    loadLocalState();
    renderHall();
  }

  // -------------------- data loading --------------------
  async function loadSettings() {
    try {
      SETTINGS = await fetchJson("../data/settings.json");
      currency = SETTINGS?.theatre?.currency || "грн";
      setText("#boTitle", SETTINGS?.theatre?.name ? `Білетний відділ — ${SETTINGS.theatre.name}` : "Білетний відділ");
      return SETTINGS;
    } catch {
      SETTINGS = { theatre: {}, pricing_defaults: {} };
      currency = "грн";
      return SETTINGS;
    }
  }

  async function loadAfisha() {
    AFISHA = await fetchJson("../data/afisha.json");
    return AFISHA;
  }

  function inDateRange(item, fromStr, toStr) {
    const d = String(item?.date || "");
    if (!d) return true;
    if (fromStr && d < fromStr) return false;
    if (toStr && d > toStr) return false;
    return true;
  }

  function fillShowSelect() {
    const sel = qs("#showSelect");
    if (!sel) return;

    const from = qs("#rangeFrom")?.value || "";
    const to = qs("#rangeTo")?.value || "";

    const list = (AFISHA || [])
      .filter(x => inDateRange(x, from, to))
      .slice()
      .sort((a, b) => {
        const ak = `${a.date} ${a.time}`;
        const bk = `${b.date} ${b.time}`;
        return ak.localeCompare(bk);
      });

    sel.innerHTML = '<option value="">— обрати —</option>';
    for (const s of list) {
      const opt = document.createElement("option");
      opt.value = `${s.id}__${s.date}`;
      opt.textContent = `${s.date} • ${s.time} • ${s.title}`;
      sel.appendChild(opt);
    }
  }

  async function loadSeance(show) {
    current = show;

    const seanceUrl = `../data/seances/${show.id}-${show.date}.json`;
    try {
      seance = await fetchJson(seanceUrl);
    } catch (e) {
      console.error("Cannot load seance:", seanceUrl, e);
      alert(`Не можу завантажити сеанс: ${seanceUrl}\nПеревір: чи є файл у /data/seances/`);
      seance = null;
      return;
    }

    const hallId = seance.hall_id || seance.hallId || "shevchenko-big";
    const hallUrl = `../data/halls/${hallId}.json`;
    try {
      hall = await fetchJson(hallUrl);
    } catch (e) {
      console.error("Cannot load hall:", hallUrl, e);
      alert(`Не можу завантажити зал: ${hallUrl}`);
      hall = null;
      return;
    }

    // 1) base from seance.places
    seatStatus = new Map();
    const places = seance.places || {};
    for (const [k, v] of Object.entries(places)) {
      const nk = normalizePlaceKey(k);
      let st = v?.status || "free";
      // normalize aliases
      if (st === "hold") st = "reserved";
      if (st === "boxoffice") st = "sold";
      seatStatus.set(nk, st);
    }

    // 2) apply local override
    const rawLocal = localStorage.getItem(lsKey("seatStatus"));
    if (rawLocal) {
      try {
        const obj = JSON.parse(rawLocal);
        for (const [k, v] of Object.entries(obj)) seatStatus.set(k, v);
      } catch {}
    }

    // ops
    ops = [];
    const rawOps = localStorage.getItem(lsKey("ops"));
    if (rawOps) {
      try { ops = JSON.parse(rawOps) || []; } catch { ops = []; }
    }

    basket = [];

    setText("#seanceMeta", `${show.title} • ${show.date} ${show.time} • hall_id: ${hallId}`);

    saveSeatStatus();
    saveOps();

    renderHall();
    syncUI();
  }

  // -------------------- init --------------------
  function initToolbar() {
    qs("#btnZoomIn")?.addEventListener("click", () => setZoom(zoom + 0.1));
    qs("#btnZoomOut")?.addEventListener("click", () => setZoom(zoom - 0.1));
    qs("#btnHome")?.addEventListener("click", () => {
      const w = qs("#hallWrap");
      if (w) w.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
    qs("#btnList")?.addEventListener("click", () => qs("#opsList")?.scrollIntoView({ behavior: "smooth" }));

    qs("#btnSell")?.addEventListener("click", sell);
    qs("#btnReserve")?.addEventListener("click", reserve);
    qs("#btnRealize")?.addEventListener("click", realize);
    qs("#btnInvite")?.addEventListener("click", invite);
    qs("#btnClearBasket")?.addEventListener("click", clearBasket);

    qs("#btnExportStateJson")?.addEventListener("click", exportStateJson);
    qs("#btnExportSalesCsv")?.addEventListener("click", exportSalesCsv);

    qs("#btnExportOpsCsv")?.addEventListener("click", exportOpsCsv);
    qs("#btnExportOpsJson")?.addEventListener("click", exportOpsJson);
    qs("#btnClearOps")?.addEventListener("click", clearOps);

    qs("#btnResetLocal")?.addEventListener("click", resetLocal);

    // dates init
    const from = qs("#rangeFrom");
    const to = qs("#rangeTo");
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const y = today.getFullYear(), m = pad(today.getMonth() + 1), d = pad(today.getDate());
    if (from && !from.value) from.value = `${y}-${m}-01`;
    if (to && !to.value) to.value = `${y}-${m}-${d}`;

    // refilter seances on date change
    from?.addEventListener("change", () => fillShowSelect());
    to?.addEventListener("change", () => fillShowSelect());

    // showSelect change
    qs("#showSelect")?.addEventListener("change", async () => {
      const v = qs("#showSelect").value || "";
      if (!v) {
        current = null; seance = null; hall = null;
        setText("#seanceMeta", "Оберіть сеанс.");
        renderHall();
        loadLocalState();
        return;
      }
      const [id, date] = v.split("__");
      const found = AFISHA.find(x => x.id === id && x.date === date) || AFISHA.find(x => x.id === id) || null;
      if (!found) return;
      await loadSeance(found);
    });
  }

  async function init() {
    initToolbar();
    await loadSettings();
    await loadAfisha();
    fillShowSelect();

    setText("#seanceMeta", "Оберіть сеанс.");
    renderHall();
    syncUI();
    setZoom(1);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(e => {
      console.error(e);
      alert("Помилка ініціалізації Backoffice. Відкрий консоль (F12) і покажи помилку.");
    });
  });

})();
