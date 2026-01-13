// backoffice/app.js (REPLACE FULL FILE)
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
  let seatStatus = new Map(); // seat_label -> status (free/reserved/sold/realization/invite/blocked)
  let basket = [];            // [{key,label,price}]
  let ops = [];               // log operations
  let zoom = 1;

  // -------------------- key helpers (унифицируем под онлайн формат) --------------------
  // Партер:  P{row}-M{seat}
  // Амфи:    A{row}-M{seat}
  // Балкон:  B{row}-M{seat}
  // Ложа A:  A0-M{seat}
  // Ложа B:  B0-M{seat}
  function seatLabelKey(zone, row, seat, boxId) {
    if (boxId === "boxA") return `A0-M${seat}`;
    if (boxId === "boxB") return `B0-M${seat}`;
    if (zone === "parter") return `P${row}-M${seat}`;
    if (zone === "amphi") return `A${row}-M${seat}`;
    if (zone === "balcony") return `B${row}-M${seat}`;
    // fallback
    return `P${row}-M${seat}`;
  }

  function keyToHuman(k) {
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
    const sp = (seance && seance.prices) ? seance.prices : null;
    if (sp && sp[groupKey] != null) return Number(sp[groupKey]) || 0;

    const d = SETTINGS.pricing_defaults || {};
    if (d && d[groupKey] != null) return Number(d[groupKey]) || 0;

    return 0;
  }

  function totalBasket() {
    return basket.reduce((s, i) => s + (Number(i.price) || 0), 0);
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
      case "clear": return "ОЧИЩЕННЯ";
      default: return status;
    }
  }

  // -------------------- localStorage helpers --------------------
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  function loadLocalState() {
    seatStatus = new Map();
    basket = [];
    ops = [];

    const raw1 = localStorage.getItem(lsKey("seatStatus"));
    if (raw1) {
      try {
        const obj = JSON.parse(raw1);
        for (const [k, v] of Object.entries(obj)) seatStatus.set(k, v);
      } catch {}
    }

    const raw2 = localStorage.getItem(lsKey("ops"));
    if (raw2) {
      try { ops = JSON.parse(raw2) || []; } catch { ops = []; }
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

  // -------------------- zoom --------------------
  function setZoom(value) {
    zoom = Math.max(0.6, Math.min(1.8, value));
    const root = qs("#hallRoot");
    if (root) root.style.transform = `scale(${zoom})`;
  }

  // -------------------- seat dom --------------------
  function seatDom(key, label, price, aisleGap = false) {
    const btn = document.createElement("button");
    btn.className = "seat" + (aisleGap ? " gapRight" : "");
    btn.type = "button";
    btn.dataset.key = key;

    const stBase = seatStatus.get(key) || "free";
    const inBasket = basket.some(x => x.key === key);
    const st = inBasket ? "basket" : stBase;

    btn.dataset.st = st;
    btn.title = `${label}\n${price} ${currency}\nСтатус: ${stBase}`;

    // номер
    const m = String(key).match(/-M(\d+)$/i);
    btn.textContent = m ? m[1] : key;

    if (isLockedStatus(stBase)) btn.disabled = true;

    btn.addEventListener("click", () => {
      const base = seatStatus.get(key) || "free";
      if (isLockedStatus(base)) return;

      const idx = basket.findIndex(x => x.key === key);
      if (idx >= 0) basket.splice(idx, 1);
      else basket.push({ key, label, price });

      btn.dataset.st = basket.some(x => x.key === key) ? "basket" : base;
      syncUI();
    });

    return btn;
  }

  // -------------------- render hall (как spectacles/hall.html) --------------------
  function renderHall() {
    const root = qs("#hallRoot");
    if (!root) return;

    root.innerHTML = "";

    if (!current || !seance || !hall) {
      root.innerHTML = `<div class="muted">Оберіть сеанс, щоб побачити зал.</div>`;
      return;
    }

    const rows = (hall.rows || []).slice();
    const boxes = Array.isArray(hall.boxes) ? hall.boxes : [];

    // 1) Партер (rows zone=parter, seats=20)
    const parter = rows.filter(x => x.zone === "parter");

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "Партер";
    root.appendChild(title);

    const parterWrap = document.createElement("div");
    parterWrap.className = "parterWrap";

    // Ложа B (слева)
    const boxB = boxes.find(b => String(b.id).toLowerCase() === "boxb");
    const leftBox = document.createElement("div");
    leftBox.className = "lodgeCol";
    leftBox.innerHTML = `<div class="lodgeTitle">Ложа Б</div>`;
    const leftSeats = document.createElement("div");
    leftSeats.className = "lodgeSeats";
    if (boxB) {
      const price = priceByGroup(boxB.price_group || "p_boxes");
      for (let i = 1; i <= Number(boxB.seats || 18); i++) {
        const key = seatLabelKey(null, 0, i, "boxB");
        leftSeats.appendChild(seatDom(key, `Ложа B • місце ${i}`, price));
      }
    }
    leftBox.appendChild(leftSeats);

    // Партер центр
    const center = document.createElement("div");
    center.className = "parterCenter";

    for (const r of parter) {
      const line = document.createElement("div");
      line.className = "rowLine";

      const lab = document.createElement("div");
      lab.className = "rowLabel";
      lab.textContent = String(r.row);
      line.appendChild(lab);

      const rowWrap = document.createElement("div");
      rowWrap.className = "seatsRow";

      const price = priceByGroup(r.price_group || "");
      const cnt = Number(r.seats || 0);

      for (let s = 1; s <= cnt; s++) {
        const key = seatLabelKey("parter", Number(r.row), s);
        const aisleGap = r.aisle_after && Number(r.aisle_after) === s;
        rowWrap.appendChild(seatDom(key, keyToHuman(key), price, aisleGap));
      }

      line.appendChild(rowWrap);
      center.appendChild(line);
    }

    // Ложа A (справа)
    const boxA = boxes.find(b => String(b.id).toLowerCase() === "boxa");
    const rightBox = document.createElement("div");
    rightBox.className = "lodgeCol";
    rightBox.innerHTML = `<div class="lodgeTitle">Ложа A</div>`;
    const rightSeats = document.createElement("div");
    rightSeats.className = "lodgeSeats";
    if (boxA) {
      const price = priceByGroup(boxA.price_group || "p_boxes");
      for (let i = 1; i <= Number(boxA.seats || 18); i++) {
        const key = seatLabelKey(null, 0, i, "boxA");
        rightSeats.appendChild(seatDom(key, `Ложа A • місце ${i}`, price));
      }
    }
    rightBox.appendChild(rightSeats);

    parterWrap.appendChild(leftBox);
    parterWrap.appendChild(center);
    parterWrap.appendChild(rightBox);

    root.appendChild(parterWrap);

    // 2) Амфітеатр (rows zone=amphi, seats_left / seats_right)
    const amphi = rows.filter(x => x.zone === "amphi");
    if (amphi.length) {
      const t2 = document.createElement("div");
      t2.className = "sectionTitle";
      t2.textContent = "Амфітеатр";
      root.appendChild(t2);

      for (const r of amphi) {
        const line = document.createElement("div");
        line.className = "rowLine";

        const lab = document.createElement("div");
        lab.className = "rowLabel";
        lab.textContent = String(r.row);
        line.appendChild(lab);

        const wrap = document.createElement("div");
        wrap.className = "amphiWrap";

        const left = document.createElement("div");
        left.className = "seatsRow";
        const gap = document.createElement("div");
        gap.className = "amphiGap";
        const right = document.createElement("div");
        right.className = "seatsRow";

        const price = priceByGroup(r.price_group || "");

        const L = Number(r.seats_left || 0);
        const R = Number(r.seats_right || 0);

        for (let s = 1; s <= L; s++) {
          const key = seatLabelKey("amphi", Number(r.row), s);
          left.appendChild(seatDom(key, keyToHuman(key), price));
        }
        for (let s = 1; s <= R; s++) {
          const seatNum = L + s; // справа продолжает нумерацию
          const key = seatLabelKey("amphi", Number(r.row), seatNum);
          right.appendChild(seatDom(key, keyToHuman(key), price));
        }

        wrap.appendChild(left);
        wrap.appendChild(gap);
        wrap.appendChild(right);

        line.appendChild(wrap);
        root.appendChild(line);
      }
    }

    // 3) Балкон (rows zone=balcony)
    const balcony = rows.filter(x => x.zone === "balcony");
    if (balcony.length) {
      const t3 = document.createElement("div");
      t3.className = "sectionTitle";
      t3.textContent = "Балкон";
      root.appendChild(t3);

      for (const r of balcony) {
        const line = document.createElement("div");
        line.className = "rowLine";

        const lab = document.createElement("div");
        lab.className = "rowLabel";
        lab.textContent = String(r.row);
        line.appendChild(lab);

        const rowWrap = document.createElement("div");
        rowWrap.className = "seatsRow";

        const price = priceByGroup(r.price_group || "");

        // Ряды 1-5: seats=28
        if (r.seats) {
          const cnt = Number(r.seats || 0);
          for (let s = 1; s <= cnt; s++) {
            const key = seatLabelKey("balcony", Number(r.row), s);
            const aisleGap = r.aisle_after && Number(r.aisle_after) === s;
            rowWrap.appendChild(seatDom(key, keyToHuman(key), price, aisleGap));
          }
        } else {
          // Ряд 6: seats_left/seats_right, визуально как у тебя: 1-10, пусто, 11-20
          const L = Number(r.seats_left || 0);
          const R = Number(r.seats_right || 0);

          // слева 1..L
          for (let s = 1; s <= L; s++) {
            const key = seatLabelKey("balcony", Number(r.row), s);
            const aisleGap = r.aisle_after && Number(r.aisle_after) === s;
            rowWrap.appendChild(seatDom(key, keyToHuman(key), price, aisleGap));
          }
          // пустые слоты (как “пропуск”)
          for (let i = 0; i < 8; i++) {
            const ph = document.createElement("span");
            ph.className = "seatPh";
            rowWrap.appendChild(ph);
          }
          // справа (продолжаем как 11..(10+R))
          for (let s = 1; s <= R; s++) {
            const seatNum = L + s;
            const key = seatLabelKey("balcony", Number(r.row), seatNum);
            rowWrap.appendChild(seatDom(key, keyToHuman(key), price));
          }
        }

        line.appendChild(rowWrap);
        root.appendChild(line);
      }
    }

    setZoom(zoom);
  }

  // -------------------- UI sync --------------------
  function syncUI() {
    const meta = qs("#basketMeta");
    const list = qs("#basketList");
    const totalEl = qs("#basketTotal");

    if (meta) meta.textContent = basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";
    if (totalEl) totalEl.textContent = String(totalBasket());
    renderBasket(list, basket, currency);

    const opsList = qs("#opsList");
    renderOps(opsList, ops);

    // обновляем статусы на кнопках
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
  function clearBasket() { basket = []; syncUI(); }

  function applyToBasket(status) {
    if (!current) { alert("Оберіть сеанс."); return; }
    if (!basket.length) return;

    const seatKeys = basket.map(x => x.key);
    for (const k of seatKeys) seatStatus.set(k, status);
    saveSeatStatus();

    const total = totalBasket();
    const showLabel = `${current.title} — ${current.date} ${current.time}`;
    ops.push({
      ts: nowIso(),
      tsHuman: fmtDT(Date.now()),
      action: humanActionName(status),
      status,
      showId: current.id,
      showLabel,
      count: seatKeys.length,
      total,
      currency,
      seats: seatKeys
    });
    saveOps();

    clearBasket();
    syncUI();
  }

  function sell() { applyToBasket("sold"); }
  function reserve() { applyToBasket("reserved"); }
  function realize() { applyToBasket("realization"); }
  function invite() { applyToBasket("invite"); }

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
      for (const s of (o.seats || [])) rows.push([o.ts, o.action, s, o.status, o.total, o.currency, o.showId, current.date]);
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
    } catch (e) {
      console.warn("settings.json не прочитался", e);
      SETTINGS = { theatre: {}, pricing_defaults: {} };
      currency = "грн";
      return SETTINGS;
    }
  }

  async function loadAfisha() {
    AFISHA = await fetchJson("../data/afisha.json");
    return AFISHA;
  }

  function fillShowSelect() {
    const sel = qs("#showSelect");
    if (!sel) return;

    sel.innerHTML = '<option value="">— обрати —</option>';
    for (const s of AFISHA) {
      const opt = document.createElement("option");
      opt.value = `${s.id}__${s.date}`;
      opt.textContent = `${s.title} — ${s.date}, ${s.time}`;
      sel.appendChild(opt);
    }

    sel.addEventListener("change", async () => {
      const v = sel.value || "";
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

    // init statuses from seance.places
    seatStatus = new Map();
    const places = seance.places || {};
    for (const [k, v] of Object.entries(places)) {
      const seatLabel = normalizePlaceKeyToSeatLabel(k);
      if (!seatLabel) continue;

      const st = (v && v.status) ? v.status : "free";
      let norm = st;
      if (st === "hold") norm = "reserved";
      if (st === "boxoffice") norm = "sold";
      seatStatus.set(seatLabel, norm);
    }

    // apply local override
    const rawLocal = localStorage.getItem(lsKey("seatStatus"));
    if (rawLocal) {
      try {
        const obj = JSON.parse(rawLocal);
        for (const [k, v] of Object.entries(obj)) seatStatus.set(k, v);
      } catch {}
    }

    const rawOps = localStorage.getItem(lsKey("ops"));
    ops = [];
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

    // dates UI (пока просто выставим)
    const from = qs("#rangeFrom");
    const to = qs("#rangeTo");
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const y = today.getFullYear(), m = pad(today.getMonth() + 1), d = pad(today.getDate());
    if (from) from.value = `${y}-${m}-01`;
    if (to) to.value = `${y}-${m}-${d}`;
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
