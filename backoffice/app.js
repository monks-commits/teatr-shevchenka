(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v2_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];
  let current = null; // {id,title,date,time,...}
  let seance = null;  // data/seances/*.json
  let currency = "грн";

  // local state (мы оставляем как было: корзина/журнал/клиенты/заказы локально)
  let basket = []; // [{key,label,price}]
  let ops = [];
  let zoom = 1;

  // clients/orders local db
  let CLIENTS = []; // [{id,name,email,phone,type,note,created_at}]
  let ORDERS  = []; // [{id,status,client,amount,seats,created_at}]

  // -------------------- localStorage keys --------------------
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }
  function lsKeyGlobal(name){
    return `${LS_PREFIX}${name}_global`;
  }

  // -------------------- iframe helpers --------------------
  function cashFrameEl(){ return qs("#cashFrame"); }
  function cashHintEl(){ return qs("#cashHint"); }

  function setCashVisible(yes){
    const fr = cashFrameEl();
    const hint = cashHintEl();
    if(fr) fr.style.display = yes ? "block" : "none";
    if(hint) hint.style.display = yes ? "none" : "block";
  }

  function buildCashUrl(show){
    // show.id обязателен для hall-cash
    // date добавляем для удобства (может пригодиться hall-cash)
    const base = "../spectacles/hall-cash.html";
    const url = new URL(base, window.location.href);
    url.searchParams.set("show", show.id);
    if (show.date) url.searchParams.set("date", show.date);
    return url.toString();
  }

  function openCash(show){
    const fr = cashFrameEl();
    if(!fr || !show || !show.id) return;

    const url = buildCashUrl(show);
    fr.src = url;
    setCashVisible(true);

    // сброс zoom при открытии нового события
    zoom = 1;
    applyIframeZoom();
  }

  function postToCash(type, payload){
    const fr = cashFrameEl();
    if(!fr || !fr.contentWindow) return;
    fr.contentWindow.postMessage({ source: "backoffice", type, payload }, "*");
  }

  function applyIframeZoom(){
    const fr = cashFrameEl();
    if(!fr) return;

    // CSS zoom (простое масштабирование iframe контента)
    // Примечание: zoom не стандартизован везде идеально, но в Chromium ок.
    fr.style.zoom = String(zoom);
  }

  function setZoom(value) {
    zoom = Math.max(0.6, Math.min(1.8, value));
    applyIframeZoom();
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

  // -------------------- ops local state --------------------
  function loadOps() {
    ops = [];
    const raw2 = localStorage.getItem(lsKey("ops"));
    if (raw2) {
      try { ops = JSON.parse(raw2) || []; } catch { ops = []; }
    }
  }

  function saveOps() {
    localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
  }

  function resetLocal() {
    if (!current) return;
    localStorage.removeItem(lsKey("ops"));
    loadOps();
    basket = [];
    syncUI();
  }

  // -------------------- pricing --------------------
  function totalBasket() {
    return basket.reduce((s, i) => s + (Number(i.price) || 0), 0);
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

  // -------------------- UI sync --------------------
  function syncUI() {
    const totalEl = qs("#basketTotal");
    if (totalEl) totalEl.textContent = String(totalBasket());

    renderBasket(qs("#basketList"), basket, currency);

    const meta = qs("#basketMeta");
    if (meta) meta.textContent = basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";

    renderOps(qs("#opsList"), ops);

    const curEl = qs("#currency");
    if (curEl) curEl.textContent = currency;
  }

  // -------------------- actions --------------------
  function clearBasket() { basket = []; syncUI(); }

  function applyToBasket(status) {
    if (!current) { alert("Оберіть сеанс."); return; }
    if (!basket.length) return;

    const seatKeys = basket.map(x => x.key);
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

    // Также отправим действие в hall-cash (если он поддерживает)
    postToCash("apply_status", { status, seats: seatKeys, show: current });

    clearBasket();
    syncUI();
  }

  function sell() { applyToBasket("sold"); }
  function reserve() { applyToBasket("reserved"); }
  function realize() { applyToBasket("realization"); }
  function invite() { applyToBasket("invite"); }

  function exportStateJson() {
    if (!current) { alert("Оберіть сеанс."); return; }

    // В варианте с iframe у нас нет локальной карты статусов по креслам.
    // Экспортируем то, что реально есть в backoffice: show + ops + basket (пустой обычно).
    downloadText(
      `backoffice_state_${current.id}_${current.date}.json`,
      JSON.stringify({ show: current, seance, ops }, null, 2)
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
        current = null; seance = null;
        setText("#seanceMeta", "Оберіть сеанс.");
        setCashVisible(false);
        basket = [];
        ops = [];
        syncUI();
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

    // грузим seance только для: hall_id/цены/мета в UI
    const seanceUrl = `../data/seances/${show.id}-${show.date}.json`;
    try {
      seance = await fetchJson(seanceUrl);
    } catch (e) {
      // даже если seance не найден — iframe кассы всё равно откроем по show.id
      seance = null;
    }

    const hallId = seance?.hall_id || seance?.hallId || "—";
    setText("#seanceMeta", `${show.title} • ${show.date} ${show.time} • hall_id: ${hallId}`);

    // pricing dump
    const pd = qs("#pricingDump");
    if(pd){
      pd.textContent = JSON.stringify(
        { seance_prices: seance?.prices || {}, defaults: SETTINGS?.pricing_defaults || {} },
        null,
        2
      );
    }

    // ops from localStorage (per show/date)
    loadOps();
    basket = [];
    syncUI();

    // открыть кассу в iframe
    openCash(show);
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

    // seat search: отправляем в hall-cash (если он поддерживает)
    qs("#seatSearch")?.addEventListener("keydown", (e)=>{
      if(e.key !== "Enter") return;
      const key = (e.target.value||"").trim();
      if(!key) return;

      if(!current){
        alert("Оберіть сеанс.");
        return;
      }

      // пробуем отправить в iframe
      postToCash("seat_search", { key });

      // если hall-cash не поддерживает, хотя бы подскажем
      alert("Запит на пошук місця відправлено у касу (hall-cash). Якщо не спрацювало — додамо listener у hall-cash.");
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
    setCashVisible(false);

    loadOps();
    basket = [];
    syncUI();
    setZoom(1);

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
