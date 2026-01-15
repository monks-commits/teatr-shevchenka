(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v2_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];
  let current = null; // {id,title,date,time,...}
  let seance = null;  // data/seances/*.json
  let hall = null;    // data/halls/*.json
  let currency = "грн";

  // state per seance (seat_label -> status)
  let seatStatus = new Map();
  let basket = []; // [{key,label,price}]
  let ops = [];
  let zoom = 1;

  // clients/orders local db
  let CLIENTS = []; // [{id,name,email,phone,type,note,created_at}]
  let ORDERS  = []; // [{id,status,client,amount,seats,created_at}]

  // -------------------- seat label helpers (unified) --------------------
  // Parter:  P{row}-M{seat}
  // Amphi:   A{row}-M{seat}
  // Balcony: B{row}-M{seat}
  // BoxA:    A0-M{seat}   (ВАЖНО: A слева)
  // BoxB:    B0-M{seat}   (B справа)
  function seatLabelKey(zone, row, seat, boxId) {
    if (boxId === "boxA") return `A0-M${seat}`;
    if (boxId === "boxB") return `B0-M${seat}`;
    if (zone === "parter") return `P${row}-M${seat}`;
    if (zone === "amphi") return `A${row}-M${seat}`;
    if (zone === "balcony") return `B${row}-M${seat}`;
    return `P${row}-M${seat}`;
  }

  function keyToHuman(k) {
    const m = String(k).match(/^([PAB])(\d+)-M(\d+)$/i);
    if (!m) return k;
    const prefix = m[1].toUpperCase();
    const row = Number(m[2]);
    const seat = Number(m[3]);

    if (prefix === "P") return `Партер • ряд ${row} • місце ${seat}`;
    if (prefix === "A") return row === 0 ? `Ложа A (зліва) • місце ${seat}` : `Амфітеатр • ряд ${row} • місце ${seat}`;
    if (prefix === "B") return row === 0 ? `Ложа B (справа) • місце ${seat}` : `Балкон • ряд ${row} • місце ${seat}`;
    return k;
  }

  // support old seance.places keys: "1-2" and "boxA-5"
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

  // -------------------- pricing --------------------
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

  // -------------------- localStorage keys --------------------
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }
  function lsKeyGlobal(name){
    return `${LS_PREFIX}${name}_global`;
  }

  // -------------------- clients/orders storage --------------------
  function loadClients(){
    try{
      const raw = localStorage.getItem(lsKeyGlobal("clients"));
      CLIENTS = raw ? (JSON.parse(raw) || []) : [];
      if(!Array.isArray(CLIENTS)) CLIENTS = [];
    }catch{ CLIENTS = []; }
  }
  function saveClients(){
    localStorage.setItem(lsKeyGlobal("clients"), JSON.stringify(CLIENTS));
  }

  function loadOrders(){
    try{
      const raw = localStorage.getItem(lsKeyGlobal("orders"));
      ORDERS = raw ? (JSON.parse(raw) || []) : [];
      if(!Array.isArray(ORDERS)) ORDERS = [];
    }catch{ ORDERS = []; }
  }
  function saveOrders(){
    localStorage.setItem(lsKeyGlobal("orders"), JSON.stringify(ORDERS));
  }

  // -------------------- zoom --------------------
  function setZoom(value) {
    zoom = Math.max(0.6, Math.min(1.8, value));
    const root = qs("#hallRoot");
    if (root) {
      root.style.transformOrigin = "top left";
      root.style.transform = `scale(${zoom})`;
    }
  }

  // -------------------- seat DOM --------------------
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

    const m = String(key).match(/-M(\d+)$/i);
    btn.textContent = m ? m[1] : key;

    if (isLockedStatus(stBase)) btn.disabled = true;

    btn.addEventListener("click", () => {
      const base = seatStatus.get(key) || "free";
      if (isLockedStatus(base)) return;

      const idx = basket.findIndex(x => x.key === key);
      if (idx >= 0) basket.splice(idx, 1);
      else basket.push({ key, label, price });

      syncUI();
    });

    return btn;
  }

  // -------------------- render hall from data/halls/*.json --------------------
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

    // --- Parter ---
    const parterRows = rows.filter(x => x.zone === "parter");

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "Партер";
    root.appendChild(title);

    const parterWrap = document.createElement("div");
    parterWrap.className = "parterWrap";

    // LEFT: BoxA (Ложа A слева)
    const boxA = boxes.find(b => String(b.id).toLowerCase() === "boxa");
    const leftBox = document.createElement("div");
    leftBox.className = "lodgeCol";
    leftBox.innerHTML = `<div class="lodgeTitle">Ложа A</div>`;
    const leftSeats = document.createElement("div");
    leftSeats.className = "lodgeSeats";
    if (boxA) {
      const price = priceByGroup(boxA.price_group || "p_boxes");
      for (let i = 1; i <= Number(boxA.seats || 18); i++) {
        const key = seatLabelKey(null, 0, i, "boxA");
        leftSeats.appendChild(seatDom(key, `Ложа A • місце ${i}`, price));
      }
    }
    leftBox.appendChild(leftSeats);

    // CENTER: parter rows
    const center = document.createElement("div");
    center.className = "parterCenter";

    for (const r of parterRows) {
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

    // RIGHT: BoxB (Ложа B справа)
    const boxB = boxes.find(b => String(b.id).toLowerCase() === "boxb");
    const rightBox = document.createElement("div");
    rightBox.className = "lodgeCol";
    rightBox.innerHTML = `<div class="lodgeTitle">Ложа B</div>`;
    const rightSeats = document.createElement("div");
    rightSeats.className = "lodgeSeats";
    if (boxB) {
      const price = priceByGroup(boxB.price_group || "p_boxes");
      for (let i = 1; i <= Number(boxB.seats || 18); i++) {
        const key = seatLabelKey(null, 0, i, "boxB");
        rightSeats.appendChild(seatDom(key, `Ложа B • місце ${i}`, price));
      }
    }
    rightBox.appendChild(rightSeats);

    parterWrap.appendChild(leftBox);
    parterWrap.appendChild(center);
    parterWrap.appendChild(rightBox);
    root.appendChild(parterWrap);

    // --- Amphi ---
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
          const seatNum = L + s;
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

    // --- Balcony ---
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

        if (r.seats) {
          const cnt = Number(r.seats || 0);
          for (let s = 1; s <= cnt; s++) {
            const key = seatLabelKey("balcony", Number(r.row), s);
            const aisleGap = r.aisle_after && Number(r.aisle_after) === s;
            rowWrap.appendChild(seatDom(key, keyToHuman(key), price, aisleGap));
          }
        } else {
          // row 6 style
          const L = Number(r.seats_left || 0);
          const R = Number(r.seats_right || 0);

          for (let s = 1; s <= L; s++) {
            const key = seatLabelKey("balcony", Number(r.row), s);
            const aisleGap = r.aisle_after && Number(r.aisle_after) === s;
            rowWrap.appendChild(seatDom(key, keyToHuman(key), price, aisleGap));
          }
          for (let i = 0; i < 8; i++) {
            const ph = document.createElement("span");
            ph.className = "seat";
            ph.style.visibility = "hidden";
            ph.style.pointerEvents = "none";
            rowWrap.appendChild(ph);
          }
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
    const totalEl = qs("#basketTotal");
    if (totalEl) totalEl.textContent = String(totalBasket());
    renderBasket(qs("#basketList"), basket, currency);

    const meta = qs("#basketMeta");
    if (meta) meta.textContent = basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";

    renderOps(qs("#opsList"), ops);

    // update seat buttons states
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

  // -------------------- local state --------------------
  function saveSeatStatus() {
    const obj = {};
    for (const [k, v] of seatStatus.entries()) obj[k] = v;
    localStorage.setItem(lsKey("seatStatus"), JSON.stringify(obj));
  }

  function saveOps() {
    localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
  }

  function resetLocal() {
    if (!current) return;
    localStorage.removeItem(lsKey("seatStatus"));
    localStorage.removeItem(lsKey("ops"));

    seatStatus = new Map();
    basket = [];
    ops = [];
    renderHall();
    syncUI();
  }

  // -------------------- CASH iframe --------------------
  function cashUrlForShow(showSlug){
    const base = "../spectacles/hall-cash.html";
    return `${base}?show=${encodeURIComponent(showSlug || "")}`;
  }

  function setCashFrame(showSlug){
    const frame = qs("#cashFrame");
    const meta = qs("#cashMeta");
    if(!frame) return;

    if(!showSlug){
      frame.src = "";
      if(meta) meta.textContent = "Оберіть сеанс у вкладці “Події” (або у списку) — і каса переключиться.";
      return;
    }

    frame.src = cashUrlForShow(showSlug);
    if(meta) meta.textContent = `Каса: ${showSlug} • ${frame.src}`;
  }

  // -------------------- data loading --------------------
  async function loadSettings() {
    try {
      SETTINGS = await fetchJson("../data/settings.json");
      currency = SETTINGS?.theatre?.currency || "грн";
      setText("#boTitle", SETTINGS?.theatre?.name ? `Білетний відділ — ${SETTINGS.theatre.name}` : "Білетний відділ");
      return SETTINGS;
    } catch (e) {
      SETTINGS = { theatre: {}, pricing_defaults: {} };
      currency = "грн";
      return SETTINGS;
    }
  }

  async function loadAfisha() {
    AFISHA = await fetchJson("../data/afisha.json");
    if(!Array.isArray(AFISHA)) AFISHA = [];
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
        seatStatus = new Map();
        basket = [];
        ops = [];
        syncUI();
        setCashFrame("");
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
      alert(`Не можу завантажити сеанс: ${seanceUrl}\nПеревір: чи є файл у /data/seances/`);
      seance = null;
      return;
    }

    const hallId = seance.hall_id || seance.hallId || "shevchenko-big";
    const hallUrl = `../data/halls/${hallId}.json`;
    try {
      hall = await fetchJson(hallUrl);
    } catch (e) {
      alert(`Не можу завантажити зал: ${hallUrl}`);
      hall = null;
      return;
    }

    // init statuses from seance.places (normalize keys)
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

    // ops
    const rawOps = localStorage.getItem(lsKey("ops"));
    ops = [];
    if (rawOps) {
      try { ops = JSON.parse(rawOps) || []; } catch { ops = []; }
    }

    basket = [];
    setText("#seanceMeta", `${show.title} • ${show.date} ${show.time} • hall_id: ${hallId}`);

    // pricing dump
    const pd = qs("#pricingDump");
    if(pd){
      pd.textContent = JSON.stringify({ seance_prices: seance?.prices || {}, defaults: SETTINGS?.pricing_defaults || {} }, null, 2);
    }

    saveSeatStatus();
    saveOps();
    renderHall();
    syncUI();

    // IMPORTANT: переключаем "живую кассу" на этот show
    setCashFrame(show.id || "");
  }

  // -------------------- tabs --------------------
  function setTab(name){
    qsa("#tabs .tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    qsa("[data-pane]").forEach(p => p.hidden = (p.dataset.pane !== name));
  }

  function initTabs(){
    qs("#tabs")?.addEventListener("click", (e)=>{
      const b = e.target.closest(".tabbtn");
      if(!b) return;
      setTab(b.dataset.tab);
      if(b.dataset.tab === "clients") renderClients();
      if(b.dataset.tab === "orders") renderOrders();
    });
  }

  // -------------------- clients UI --------------------
  let editingClientId = null;

  function uid(prefix){
    const rnd = Math.random().toString(16).slice(2,8);
    return `${prefix}-${Date.now()}-${rnd}`;
  }

  function renderClients(){
    const tbody = qs("#clientsTbody");
    if(!tbody) return;

    const q = (qs("#clientSearch")?.value || "").trim().toLowerCase();
    const list = CLIENTS.filter(c => {
      const s = `${c.name||""} ${c.phone||""} ${c.email||""} ${c.note||""}`.toLowerCase();
      return !q || s.includes(q);
    });

    tbody.innerHTML = list.map(c => `
      <tr data-id="${c.id}">
        <td><b>${c.id}</b></td>
        <td>${c.name||""}</td>
        <td>${c.email||""}</td>
        <td>${c.phone||""}</td>
        <td>${c.type||""}</td>
        <td>${c.note||""}</td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr").forEach(tr=>{
      tr.addEventListener("click", ()=>{
        const id = tr.dataset.id;
        openClientForm(id);
      });
    });
  }

  function openClientForm(id){
    const form = qs("#clientForm");
    if(!form) return;

    editingClientId = id || null;
    const c = CLIENTS.find(x => x.id === id) || { id: "", name:"", email:"", phone:"", type:"client", note:"" };

    qs("#cName").value = c.name || "";
    qs("#cEmail").value = c.email || "";
    qs("#cPhone").value = c.phone || "";
    qs("#cType").value = c.type || "client";
    qs("#cNote").value = c.note || "";

    form.hidden = false;
  }

  function closeClientForm(){
    const form = qs("#clientForm");
    if(form) form.hidden = true;
    editingClientId = null;
  }

  function saveClient(){
    const name = (qs("#cName").value || "").trim();
    const email = (qs("#cEmail").value || "").trim();
    const phone = (qs("#cPhone").value || "").trim();
    const type = qs("#cType").value;
    const note = (qs("#cNote").value || "").trim();

    if(!name && !phone){
      alert("Вкажіть хоча б П.І.Б. або телефон.");
      return;
    }

    if(editingClientId){
      const idx = CLIENTS.findIndex(x => x.id === editingClientId);
      if(idx >= 0){
        CLIENTS[idx] = { ...CLIENTS[idx], name, email, phone, type, note };
      }
    }else{
      CLIENTS.push({
        id: uid("CL"),
        name, email, phone, type, note,
        created_at: nowIso()
      });
    }

    saveClients();
    renderClients();
    closeClientForm();
  }

  function deleteClient(){
    if(!editingClientId) return;
    if(!confirm("Видалити клієнта?")) return;
    CLIENTS = CLIENTS.filter(x => x.id !== editingClientId);
    saveClients();
    renderClients();
    closeClientForm();
  }

  // -------------------- orders UI --------------------
  let editingOrderId = null;

  function nextOrderId(){
    const n = ORDERS.length + 1;
    return `ORD-${String(n).padStart(5,"0")}`;
  }

  function renderOrders(){
    const tbody = qs("#ordersTbody");
    if(!tbody) return;

    const q = (qs("#orderSearch")?.value || "").trim().toLowerCase();
    const fs = (qs("#orderFilterStatus")?.value || "");

    const list = ORDERS.filter(o => {
      const s = `${o.id||""} ${o.client||""}`.toLowerCase();
      if(q && !s.includes(q)) return false;
      if(fs && o.status !== fs) return false;
      return true;
    });

    tbody.innerHTML = list.slice().reverse().map(o => `
      <tr data-id="${o.id}">
        <td><b>${o.id}</b></td>
        <td>${o.status}</td>
        <td>${o.client||""}</td>
        <td><b>${o.amount||0}</b> ${currency}</td>
        <td>${(o.seats||[]).join(", ")}</td>
        <td class="muted">${o.created_at ? o.created_at.slice(0,19).replace("T"," ") : ""}</td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr").forEach(tr=>{
      tr.addEventListener("click", ()=>{
        openOrderForm(tr.dataset.id);
      });
    });
  }

  function openOrderForm(id){
    const form = qs("#orderForm");
    if(!form) return;

    editingOrderId = id || null;
    const o = ORDERS.find(x => x.id === id) || { id: nextOrderId(), status:"draft", client:"", amount:0, seats:[], created_at: nowIso() };

    qs("#oId").value = o.id || "";
    qs("#oStatus").value = o.status || "draft";
    qs("#oClient").value = o.client || "";
    qs("#oSeats").value = (o.seats||[]).join(", ");
    qs("#oAmount").value = Number(o.amount || 0);

    form.hidden = false;
  }

  function closeOrderForm(){
    const form = qs("#orderForm");
    if(form) form.hidden = true;
    editingOrderId = null;
  }

  function saveOrder(){
    const id = (qs("#oId").value || "").trim();
    const status = qs("#oStatus").value;
    const client = (qs("#oClient").value || "").trim();
    const seats = (qs("#oSeats").value || "").split(",").map(s=>s.trim()).filter(Boolean);
    const amount = Number(qs("#oAmount").value || 0);

    if(!id){ alert("Немає номеру."); return; }

    const existing = ORDERS.findIndex(x => x.id === id);
    const payload = { id, status, client, seats, amount, created_at: (existing>=0 ? ORDERS[existing].created_at : nowIso()) };

    if(existing>=0) ORDERS[existing] = payload;
    else ORDERS.push(payload);

    saveOrders();
    renderOrders();
    closeOrderForm();
  }

  function deleteOrder(){
    const id = (qs("#oId").value || "").trim();
    if(!id) return;
    if(!confirm("Видалити замовлення?")) return;
    ORDERS = ORDERS.filter(x => x.id !== id);
    saveOrders();
    renderOrders();
    closeOrderForm();
  }

  function printOrder(){
    const id = (qs("#oId").value || "").trim();
    const o = ORDERS.find(x => x.id === id);
    if(!o){ alert("Не знайдено замовлення."); return; }

    const html = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"/>
<title>${o.id}</title>
<style>
  body{font-family:Arial,sans-serif;margin:18px;color:#111827}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:12px;max-width:520px}
  h1{margin:0 0 6px;font-size:18px}
  .muted{color:#6b7280;font-size:12px}
  .row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed #e5e7eb;padding:6px 0}
  .row:last-child{border-bottom:0}
</style></head>
<body>
  <div class="card">
    <h1>Замовлення ${o.id}</h1>
    <div class="muted">Статус: ${o.status} • Створено: ${o.created_at || ""}</div>
    <div class="row"><div>Клієнт</div><div><b>${o.client||"—"}</b></div></div>
    <div class="row"><div>Сума</div><div><b>${o.amount||0}</b> ${currency}</div></div>
    <div class="row"><div>Місця</div><div><b>${(o.seats||[]).join(", ")}</b></div></div>
    <div class="row"><div>Подія</div><div>${current ? `${current.title} • ${current.date} ${current.time}` : "—"}</div></div>
  </div>
<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    if(!w){ alert("Браузер заблокував pop-up для друку."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function createOrderFromBasket(){
    if(!basket.length){ alert("Кошик порожній."); return; }
    const id = nextOrderId();
    const seats = basket.map(x => x.key);
    const amount = totalBasket();
    ORDERS.push({ id, status:"draft", client:"", amount, seats, created_at: nowIso() });
    saveOrders();
    setTab("orders");
    openOrderForm(id);
    renderOrders();
  }

  // -------------------- reports --------------------
  function exportClientsJson(){
    downloadText("clients.json", JSON.stringify(CLIENTS, null, 2));
  }
  function exportClientsCsv(){
    const rows = [["id","name","email","phone","type","note","created_at"]];
    CLIENTS.forEach(c => rows.push([c.id,c.name,c.email,c.phone,c.type,c.note,c.created_at]));
    downloadText("clients.csv", toCsv(rows));
  }
  function exportOrdersJson(){
    downloadText("orders.json", JSON.stringify(ORDERS, null, 2));
  }
  function exportOrdersCsv(){
    const rows = [["id","status","client","amount","seats","created_at"]];
    ORDERS.forEach(o => rows.push([o.id,o.status,o.client,o.amount,(o.seats||[]).join(" "),o.created_at]));
    downloadText("orders.csv", toCsv(rows));
  }

  // -------------------- toolbar / events --------------------
  function initToolbar() {
    qs("#btnZoomIn")?.addEventListener("click", () => setZoom(zoom + 0.1));
    qs("#btnZoomOut")?.addEventListener("click", () => setZoom(zoom - 0.1));
    qs("#btnHome")?.addEventListener("click", () => {
      const w = qs("#hallWrap");
      if (w) w.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });

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

    qs("#btnCreateOrder")?.addEventListener("click", createOrderFromBasket);

    // seat search (scroll to seat)
    qs("#seatSearch")?.addEventListener("keydown", (e)=>{
      if(e.key !== "Enter") return;
      const key = (e.target.value||"").trim();
      if(!key) return;
      const btn = qs(`.seat[data-key="${CSS.escape(key)}"]`);
      if(btn) btn.scrollIntoView({behavior:"smooth", block:"center", inline:"center"});
      else alert("Не знайдено місце: " + key);
    });

    // cash iframe controls
    qs("#btnCashReload")?.addEventListener("click", ()=>{
      const fr = qs("#cashFrame");
      if(!fr) return;
      fr.src = fr.src; // simple reload
    });

    qs("#btnCashOpenNew")?.addEventListener("click", ()=>{
      if(!current?.id){
        alert("Спочатку оберіть сеанс.");
        return;
      }
      window.open(cashUrlForShow(current.id), "_blank");
    });
  }

  // -------------------- init: clients/orders UI events --------------------
  function initClientsUi(){
    qs("#clientSearch")?.addEventListener("input", renderClients);
    qs("#btnClientNew")?.addEventListener("click", ()=> openClientForm(null));
    qs("#btnClientCancel")?.addEventListener("click", closeClientForm);
    qs("#btnClientSave")?.addEventListener("click", saveClient);
    qs("#btnClientDelete")?.addEventListener("click", deleteClient);
  }

  function initOrdersUi(){
    qs("#orderSearch")?.addEventListener("input", renderOrders);
    qs("#orderFilterStatus")?.addEventListener("change", renderOrders);
    qs("#btnOrderNew")?.addEventListener("click", ()=> openOrderForm(null));
    qs("#btnOrderCancel")?.addEventListener("click", closeOrderForm);
    qs("#btnOrderSave")?.addEventListener("click", saveOrder);
    qs("#btnOrderDelete")?.addEventListener("click", deleteOrder);
    qs("#btnOrderPrint")?.addEventListener("click", printOrder);
  }

  function initReportsUi(){
    qs("#btnExportClientsJson")?.addEventListener("click", exportClientsJson);
    qs("#btnExportClientsCsv")?.addEventListener("click", exportClientsCsv);
    qs("#btnExportOrdersJson")?.addEventListener("click", exportOrdersJson);
    qs("#btnExportOrdersCsv")?.addEventListener("click", exportOrdersCsv);
  }

  // -------------------- boot --------------------
  async function init() {
    initTabs();
    initToolbar();
    initClientsUi();
    initOrdersUi();
    initReportsUi();

    loadClients();
    loadOrders();

    await loadSettings();
    await loadAfisha();
    fillShowSelect();

    setText("#seanceMeta", "Оберіть сеанс.");
    renderHall();
    syncUI();
    setZoom(1);

    // init cash frame empty
    setCashFrame("");

    // default tab
    setTab("events");
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(e => {
      console.error(e);
      alert("Помилка ініціалізації Backoffice. Відкрий консоль (F12) і покажи помилку.");
    });
  });
})();
