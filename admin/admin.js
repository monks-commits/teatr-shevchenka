/* admin.js — касса/админка (локальная демо-логика)
   Совместимо с текущим admin.html, где есть:
   - select#showSelect
   - div#hall-root
   - div#basket-list, span#basket-total, span#basket-currency
   - div#reserveRegistry
   - buttons: #btn-sell #btn-reserve #btn-unreserve #btn-clear
   - texts: #admin-theatre-name #admin-current-show #admin-current-date
   - #priceLegend
*/

(() => {
  // -----------------------------
  // Helpers / DOM
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    theatreName: $("#admin-theatre-name"),
    currentShow: $("#admin-current-show"),
    currentDate: $("#admin-current-date"),
    showSelect: $("#showSelect"),
    hallRoot: $("#hall-root"),
    basketList: $("#basket-list"),
    basket toggleSub: $("#basket-sub"),
    basketTotal: $("#basket-total"),
    basketCurrency: $("#basket-currency"),
    reserveRegistry: $("#reserveRegistry"),
    priceLegend: $("#priceLegend"),

    btnSell: $("#btn-sell"),
    btnReserve: $("#btn-reserve"),
    btnUnreserve: $("#btn-unreserve"),
    btnClear: $("#btn-clear"),
    btnExportReserves: $("#btn-export-reserves"),
    btnExportSales: $("#btn-export-sales"),
    btnExportOps: $("#btn-export-ops"),
  };

  function assertEl(node, name) {
    if (!node) throw new Error(`Admin DOM missing: ${name}`);
  }

  // Проверим ключевые узлы (чтобы ловить проблему сразу)
  try {
    assertEl(el.showSelect, "#showSelect");
    assertEl(el.hallRoot, "#hall-root");
    assertEl(el.basketList, "#basket-list");
    assertEl(el.reserveRegistry, "#reserveRegistry");
  } catch (e) {
    alert("Помилка ініціалізації адмінки: " + e.message);
    console.error(e);
    return;
  }

  // -----------------------------
  // Config / Data
  // -----------------------------
  const PATH_SETTINGS = "../data/settings.json";
  const PATH_AFISHA = "../data/afisha.json";
  const DEFAULT_HALL_FILE = "../data/halls/shevchenko-big.json";

  const LS = {
    // статусы мест по спектаклю
    showState: (showKey) => `va_admin_show_state__${showKey}`,
    // журнал операций
    ops: "va_admin_ops__v1",
  };

  const SeatStatus = {
    FREE: "free",
    SELECTED: "selected",
    SOLD: "sold",
    RESERVED: "reserved",
    INACTIVE: "inactive",
  };

  let settings = null;
  let afisha = [];
  let hall = null;

  let currentShow = null; // объект из afisha
  let showKey = "";       // стабильный ключ для localStorage
  let state = null;       // состояние мест для текущего шоу

  let selected = new Set(); // seatId выбранные (корзина)

  // -----------------------------
  // Storage state format:
  // {
  //   seats: { [seatId]: { status, reservedBy?, price?, label? } },
  //   createdAt, updatedAt
  // }
  // -----------------------------
  function loadShowState(key) {
    const raw = localStorage.getItem(LS.showState(key));
    if (!raw) {
      return {
        seats: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") throw new Error("bad json");
      if (!obj.seats || typeof obj.seats !== "object") obj.seats = {};
      return obj;
    } catch (e) {
      console.warn("Bad show state in LS, resetting", e);
      return {
        seats: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  function saveShowState(key, st) {
    st.updatedAt = new Date().toISOString();
    localStorage.setItem(LS.showState(key), JSON.stringify(st));
  }

  function pushOp(type, payload) {
    const raw = localStorage.getItem(LS.ops);
    const ops = raw ? (JSON.parse(raw) || []) : [];
    ops.unshift({
      at: new Date().toISOString(),
      type,
      show: currentShow ? `${currentShow.title} • ${currentShow.date} ${currentShow.time}` : "",
      payload: payload || null,
    });
    localStorage.setItem(LS.ops, JSON.stringify(ops.slice(0, 5000)));
  }

  // -----------------------------
  // Fetch JSON helpers
  // -----------------------------
  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.json();
  }

  // -----------------------------
  // Seat id / labels / prices
  // -----------------------------
  function pad2(n) {
    const x = String(n);
    return x.length === 1 ? "0" + x : x;
  }

  function seatId({ zone, row, seat }) {
    // стабильный ID (не зависит от языка)
    return `${zone}:${row}:${seat}`;
  }

  function seatLabel({ zone, row, seat }) {
    // на экране можно красиво: A0-M2 у тебя тоже было — но тут проще и понятно кассе
    // Если хочешь — сделаем формат “Ряд X, місце Y”.
    return `Ряд ${row}, місце ${seat}`;
  }

  function priceForRow(rowObj) {
    if (!settings?.pricing_defaults) return 0;
    const pg = rowObj.price_group;
    const v = settings.pricing_defaults[pg];
    return typeof v === "number" ? v : 0;
  }

  // -----------------------------
  // Normalize hall schema
  // -----------------------------
  function normalizeHall(h) {
    const out = { ...h };
    out.zones = out.zones || {};
    out.price_groups = out.price_groups || {};
    out.rows = Array.isArray(out.rows) ? out.rows : [];
    out.boxes = Array.isArray(out.boxes) ? out.boxes : [];

    // Разделим ряды по зонам, чтобы не путаться (parter/amphi/balcony)
    out.rowsByZone = {};
    for (const r of out.rows) {
      const z = r.zone || "parter";
      if (!out.rowsByZone[z]) out.rowsByZone[z] = [];
      out.rowsByZone[z].push(r);
    }
    return out;
  }

  // -----------------------------
  // UI: render
  // -----------------------------
  function setTopBar() {
    if (el.theatreName && settings?.theatre?.name) el.theatreName.textContent = settings.theatre.name;

    if (!currentShow) {
      el.currentShow.textContent = "Сеанс: (не обрано)";
      el.currentDate.textContent = "—";
      return;
    }
    el.currentShow.textContent = `Сеанс: ${currentShow.title} — ${currentShow.date}, ${currentShow.time}`;
    el.currentDate.textContent = new Date().toLocaleString("uk-UA");
  }

  function renderPriceLegend() {
    if (!el.priceLegend) return;
    if (!settings?.pricing_defaults || !hall?.price_groups) {
      el.priceLegend.innerHTML = "";
      return;
    }

    const items = Object.entries(hall.price_groups).map(([key, meta]) => {
      const price = settings.pricing_defaults[key];
      if (typeof price !== "number") return null;
      const label = meta?.label || key;
      return `<div class="price-item"><span class="price-label">${escapeHtml(label)}</span><span class="price-val">${price} ${settings?.theatre?.currency || "грн"}</span></div>`;
    }).filter(Boolean);

    el.priceLegend.innerHTML = items.join("");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function seatClass(st) {
    // классы уже есть в твоем CSS (sw-free/sw-selected/...)
    // а для кнопок используем: seat free/selected/sold/reserved/inactive
    return st || SeatStatus.FREE;
  }

  function getSeatState(seat) {
    const id = seatId(seat);
    const rec = state.seats[id];
    return rec?.status || SeatStatus.FREE;
  }

  function setSeatState(seat, newStatus, extra = {}) {
    const id = seatId(seat);
    const prev = state.seats[id] || {};
    state.seats[id] = { ...prev, ...extra, status: newStatus, label: seatLabel(seat) };
  }

  function isSelectable(status) {
    return status === SeatStatus.FREE || status === SeatStatus.SELECTED;
  }

  function toggleSelect(seat) {
    const id = seatId(seat);
    const status = getSeatState(seat);

    if (!isSelectable(status)) return;

    if (selected.has(id)) {
      selected.delete(id);
      setSeatState(seat, SeatStatus.FREE);
    } else {
      selected.add(id);
      setSeatState(seat, SeatStatus.SELECTED);
    }
    saveShowState(showKey, state);
    renderAll();
  }

  function renderHall() {
    el.hallRoot.innerHTML = "";

    if (!currentShow) {
      el.hallRoot.innerHTML = `<div class="admin-empty">Оберіть спектакль зверху.</div>`;
      return;
    }
    if (!hall) {
      el.hallRoot.innerHTML = `<div class="admin-empty">Не завантажилась схема залу.</div>`;
      return;
    }

    // секции зон (parter/amphi/balcony)
    const zonesOrder = ["parter", "amphi", "balcony"];
    for (const zone of zonesOrder) {
      const rows = hall.rowsByZone?.[zone] || [];
      if (!rows.length) continue;

      const zoneLabel = hall.zones?.[zone]?.label || zone;

      const zoneWrap = document.createElement("div");
      zoneWrap.className = "zone-block";

      const zoneTitle = document.createElement("div");
      zoneTitle.className = "zone-title";
      zoneTitle.textContent = zoneLabel;
      zoneWrap.appendChild(zoneTitle);

      const rowsWrap = document.createElement("div");
      rowsWrap.className = "rows-wrap";

      rows.forEach((rowObj) => {
        const rowLine = document.createElement("div");
        rowLine.className = "row-line";

        const rowLab = document.createElement("div");
        rowLab.className = "row-label";
        rowLab.textContent = String(rowObj.row);
        rowLine.appendChild(rowLab);

        const seatsWrap = document.createElement("div");
        seatsWrap.className = "seats-wrap";

        // случаи: seats (один блок) или seats_left + seats_right
        const makeSeatBtn = (seatNum) => {
          const seat = { zone, row: rowObj.row, seat: seatNum };
          const id = seatId(seat);
          const st = getSeatState(seat);

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `seat ${seatClass(st)}`;
          btn.textContent = pad2(seatNum);
          btn.title = `${seatLabel(seat)} • ${st}`;

          btn.addEventListener("click", () => toggleSelect(seat));
          seatsWrap.appendChild(btn);
        };

        const aisleAfter = rowObj.aisle_after ? Number(rowObj.aisle_after) : 0;

        if (rowObj.seats && !rowObj.seats_left && !rowObj.seats_right) {
          const count = Number(rowObj.seats) || 0;
          for (let s = 1; s <= count; s++) {
            makeSeatBtn(s);
            if (aisleAfter && s === aisleAfter) {
              const gap = document.createElement("span");
              gap.className = "aisle-gap";
              seatsWrap.appendChild(gap);
            }
          }
        } else {
          const left = Number(rowObj.seats_left) || 0;
          const right = Number(rowObj.seats_right) || 0;

          // левый блок
          for (let s = 1; s <= left; s++) makeSeatBtn(s);

          // проход по центру
          const gap = document.createElement("span");
          gap.className = "aisle-gap";
          seatsWrap.appendChild(gap);

          // правый блок (продолжим нумерацию)
          for (let s = left + 1; s <= left + right; s++) makeSeatBtn(s);
        }

        rowLine.appendChild(seatsWrap);
        rowsWrap.appendChild(rowLine);
      });

      zoneWrap.appendChild(rowsWrap);
      el.hallRoot.appendChild(zoneWrap);
    }
  }

  function renderBasket() {
    const items = [...selected].map((id) => state.seats[id]).filter(Boolean);

    el.basketList.innerHTML = "";

    if (!items.length) {
      if (el.toggleSub) el.toggleSub.textContent = "Поки що нічого не обрано.";
      el.basketTotal.textContent = "0";
      return;
    }

    if (el.toggleSub) el.toggleSub.textContent = `Обрано місць: ${items.length}`;

    let total = 0;

    items.forEach((rec) => {
      const row = document.createElement("div");
      row.className = "basket-item";
      row.innerHTML = `<div class="basket-seat">${escapeHtml(rec.label || "")}</div>`;
      el.basketList.appendChild(row);

      // цена — попробуем восстановить из label/seatId через hall rows
      // проще: возьмём из rec.price, если есть, иначе 0
      const p = Number(rec.price || 0);
      total += p;
    });

    el.basketTotal.textContent = String(total);
    if (settings?.theatre?.currency) el.basketCurrency.textContent = settings.theatre.currency;
  }

  function groupReserves() {
    // собираем reserved seats
    const reserved = Object.entries(state.seats)
      .filter(([, v]) => v?.status === SeatStatus.RESERVED)
      .map(([id, v]) => ({ id, ...v }));

    const groups = {};
    for (const r of reserved) {
      const by = (r.reservedBy || "—").trim();
      if (!groups[by]) groups[by] = [];
      groups[by].push(r);
    }
    return groups;
  }

  function renderReserveRegistry() {
    const groups = groupReserves();
    const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, "uk"));

    if (!keys.length) {
      el.reserveRegistry.innerHTML = `<div class="admin-empty">Поки що немає броней.</div>`;
      return;
    }

    el.reserveRegistry.innerHTML = "";

    keys.forEach((by) => {
      const seats = groups[by];

      const card = document.createElement("div");
      card.className = "registry-card";

      const head = document.createElement("div");
      head.className = "registry-head";
      head.innerHTML = `<div class="registry-by">${escapeHtml(by)}</div><div class="registry-count">${seats.length}</div>`;
      card.appendChild(head);

      const list = document.createElement("div");
      list.className = "registry-list";
      list.innerHTML = seats.map(s => `<div class="registry-item">${escapeHtml(s.label || s.id)}</div>`).join("");
      card.appendChild(list);

      const actions = document.createElement("div");
      actions.className = "registry-actions";

      const btnSell = document.createElement("button");
      btnSell.className = "btn btn-primary";
      btnSell.type = "button";
      btnSell.textContent = "Продати";
      btnSell.addEventListener("click", () => sellReservedGroup(by));

      const btnCancel = document.createElement("button");
      btnCancel.className = "btn btn-secondary";
      btnCancel.type = "button";
      btnCancel.textContent = "Скасувати бронь";
      btnCancel.addEventListener("click", () => cancelReservedGroup(by));

      actions.appendChild(btnSell);
      actions.appendChild(btnCancel);
      card.appendChild(actions);

      el.reserveRegistry.appendChild(card);
    });
  }

  function renderAll() {
    setTopBar();
    renderPriceLegend();
    renderHall();
    renderBasket();
    renderReserveRegistry();
  }

  // -----------------------------
  // Actions
  // -----------------------------
  function ensureShowSelected() {
    if (!currentShow) {
      alert("Оберіть спектакль.");
      return false;
    }
    return true;
  }

  function inferPricesForSelected() {
    // проставим price в seat records по выбранным местам (по rowObj.price_group)
    if (!hall || !settings?.pricing_defaults) return;

    // составим карту row -> rowObj для каждой зоны
    const rowMap = new Map();
    Object.values(hall.rowsByZone || {}).forEach(rows => {
      rows.forEach(r => rowMap.set(`${r.zone}:${r.row}`, r));
    });

    for (const id of selected) {
      const rec = state.seats[id];
      if (!rec) continue;

      // id формата zone:row:seat
      const [zone, rowStr] = String(id).split(":");
      const rowObj = (hall.rowsByZone?.[zone] || []).find(r => String(r.row) === String(rowStr));
      const price = rowObj ? priceForRow(rowObj) : 0;
      rec.price = price;
    }
  }

  function sellSelected() {
    if (!ensureShowSelected()) return;
    if (!selected.size) {
      alert("Немає обраних місць.");
      return;
    }

    inferPricesForSelected();

    const soldNow = [];
    for (const id of selected) {
      const rec = state.seats[id];
      if (!rec) continue;
      if (rec.status === SeatStatus.SOLD) continue;

      rec.status = SeatStatus.SOLD;
      rec.reservedBy = "";
      soldNow.push({ id, label: rec.label, price: rec.price || 0 });
    }

    selected.clear();
    saveShowState(showKey, state);
    pushOp("sell_cash", { seats: soldNow });
    renderAll();
  }

  function reserveSelected() {
    if (!ensureShowSelected()) return;
    if (!selected.size) {
      alert("Немає обраних місць.");
      return;
    }

    const who = prompt("Хто бронює? (ПІБ/телефон)");
    if (!who) return;

    inferPricesForSelected();

    const reservedNow = [];
    for (const id of selected) {
      const rec = state.seats[id];
      if (!rec) continue;
      if (rec.status === SeatStatus.SOLD) continue;

      rec.status = SeatStatus.RESERVED;
      rec.reservedBy = who.trim();
      reservedNow.push({ id, label: rec.label, by: rec.reservedBy });
    }

    selected.clear();
    saveShowState(showKey, state);
    pushOp("reserve", { by: who.trim(), seats: reservedNow });
    renderAll();
  }

  function unreserveSelected() {
    if (!ensureShowSelected()) return;
    if (!selected.size) {
      alert("Немає обраних місць.");
      return;
    }

    const changed = [];
    for (const id of selected) {
      const rec = state.seats[id];
      if (!rec) continue;
      if (rec.status !== SeatStatus.RESERVED) continue;

      rec.status = SeatStatus.FREE;
      rec.reservedBy = "";
      changed.push({ id, label: rec.label });
    }

    selected.clear();
    saveShowState(showKey, state);
    pushOp("unreserve_selected", { seats: changed });
    renderAll();
  }

  function clearBasket() {
    if (!ensureShowSelected()) return;
    if (!selected.size) return;

    // вернуть selected -> free
    for (const id of selected) {
      const rec = state.seats[id];
      if (!rec) continue;
      if (rec.status === SeatStatus.SELECTED) rec.status = SeatStatus.FREE;
    }
    selected.clear();
    saveShowState(showKey, state);
    renderAll();
  }

  function sellReservedGroup(by) {
    if (!ensureShowSelected()) return;

    const groups = groupReserves();
    const seats = groups[by] || [];
    if (!seats.length) return;

    if (!confirm(`Продати бронь для "${by}"? (${seats.length} місць)`)) return;

    const soldNow = [];
    for (const s of seats) {
      const rec = state.seats[s.id];
      if (!rec) continue;
      rec.status = SeatStatus.SOLD;
      rec.reservedBy = "";
      soldNow.push({ id: s.id, label: rec.label, price: rec.price || 0 });
    }

    saveShowState(showKey, state);
    pushOp("sell_reserved_group", { by, seats: soldNow });
    renderAll();
  }

  function cancelReservedGroup(by) {
    if (!ensureShowSelected()) return;

    const groups = groupReserves();
    const seats = groups[by] || [];
    if (!seats.length) return;

    if (!confirm(`Скасувати бронь для "${by}"? (${seats.length} місць)`)) return;

    const freed = [];
    for (const s of seats) {
      const rec = state.seats[s.id];
      if (!rec) continue;
      rec.status = SeatStatus.FREE;
      rec.reservedBy = "";
      freed.push({ id: s.id, label: rec.label });
    }

    saveShowState(showKey, state);
    pushOp("cancel_reserved_group", { by, seats: freed });
    renderAll();
  }

  // -----------------------------
  // Export CSV
  // -----------------------------
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

  function toCsv(rows) {
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return rows.map(r => r.map(esc).join(",")).join("\n");
  }

  function exportReserves() {
    if (!ensureShowSelected()) return;

    const groups = groupReserves();
    const rows = [["by", "seat", "show", "at"]];
    const showTitle = `${currentShow.title} • ${currentShow.date} ${currentShow.time}`;

    Object.keys(groups).forEach(by => {
      groups[by].forEach(s => rows.push([by, s.label || s.id, showTitle, new Date().toISOString()]));
    });

    downloadText(`reserves_${currentShow.id || "show"}.csv`, toCsv(rows));
  }

  function exportSales() {
    if (!ensureShowSelected()) return;

    const sold = Object.entries(state.seats)
      .filter(([, v]) => v?.status === SeatStatus.SOLD)
      .map(([id, v]) => ({ id, ...v }));

    const rows = [["seat", "price", "show", "at"]];
    const showTitle = `${currentShow.title} • ${currentShow.date} ${currentShow.time}`;
    sold.forEach(s => rows.push([s.label || s.id, s.price || 0, showTitle, new Date().toISOString()]));

    downloadText(`sales_${currentShow.id || "show"}.csv`, toCsv(rows));
  }

  function exportOps() {
    const raw = localStorage.getItem(LS.ops);
    const ops = raw ? (JSON.parse(raw) || []) : [];
    const rows = [["at", "type", "show", "payload"]];
    ops.forEach(o => rows.push([o.at, o.type, o.show, JSON.stringify(o.payload || {})]));
    downloadText(`ops_log.csv`, toCsv(rows));
  }

  // -----------------------------
  // Init
  // -----------------------------
  function makeShowKey(showObj) {
    // стабильно: id + дата/время (если id одинаковый, но разные даты)
    const id = showObj?.id || "show";
    const dt = `${showObj?.date || ""}_${showObj?.time || ""}`;
    return `${id}__${dt}`;
  }

  function hydrateSelectedFromState() {
    selected.clear();
    // если в state остались seat.status=selected (после перезагрузки) — поднимем их в корзину
    Object.entries(state.seats).forEach(([id, rec]) => {
      if (rec?.status === SeatStatus.SELECTED) selected.add(id);
    });
  }

  async function onShowChange() {
    const v = el.showSelect.value || "";
    currentShow = afisha.find(x => String(x.id) === String(v)) || null;

    setTopBar();

    if (!currentShow) {
      el.hallRoot.innerHTML = `<div class="admin-empty">Оберіть спектакль зверху.</div>`;
      el.basketList.innerHTML = "";
      el.reserveRegistry.innerHTML = "";
      selected.clear();
      state = null;
      return;
    }

    showKey = makeShowKey(currentShow);
    state = loadShowState(showKey);

    // зал
    hall = normalizeHall(await fetchJson(DEFAULT_HALL_FILE));

    // проставим цены всем seats рекордам (если не стоят), чтобы сумма считалась
    // цены считаются по row.price_group
    // (делаем лениво при действиях и при рендере корзины — тут минимум)

    hydrateSelectedFromState();
    renderAll();
  }

  async function init() {
    try {
      settings = await fetchJson(PATH_SETTINGS);
      afisha = await fetchJson(PATH_AFISHA);

      // валидируем
      if (!Array.isArray(afisha)) throw new Error("afisha.json must be an array");

      // UI defaults
      if (el.basketCurrency && settings?.theatre?.currency) el.basketCurrency.textContent = settings.theatre.currency;
      setTopBar();

      // fill select
      el.showSelect.innerHTML = `<option value="">— обрати —</option>` +
        afisha.map(s => {
          const t = `${escapeHtml(s.title)} • ${escapeHtml(s.date)} ${escapeHtml(s.time)}`;
          return `<option value="${escapeHtml(s.id)}">${t}</option>`;
        }).join("");

      // handlers
      el.showSelect.addEventListener("change", onShowChange);

      el.btnSell?.addEventListener("click", sellSelected);
      el.btnReserve?.addEventListener("click", reserveSelected);
      el.btnUnreserve?.addEventListener("click", unreserveSelected);
      el.btnClear?.addEventListener("click", clearBasket);

      el.btnExportReserves?.addEventListener("click", exportReserves);
      el.btnExportSales?.addEventListener("click", exportSales);
      el.btnExportOps?.addEventListener("click", exportOps);

      // start empty
      renderAll();
    } catch (e) {
      console.error(e);
      alert("Помилка ініціалізації адмінки. Відкрий консоль (F12) і покажи помилку.\n\n" + String(e?.message || e));
    }
  }

  window.addEventListener("load", init);
})();
