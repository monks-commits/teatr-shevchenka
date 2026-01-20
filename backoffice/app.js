(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v2_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];
  let current = null;
  let seance = null;
  let currency = "грн";

  // ===== STATE =====
  let basket = []; // [{key,label,price}]
  let ops = [];
  let zoom = 1;

  // ===== localStorage helpers =====
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  // ===== iframe helpers =====
  const cashFrameEl = () => qs("#cashFrame");
  const cashHintEl = () => qs("#cashHint");
  const hallWrapEl = () => qs("#hallWrap");

  function setCashVisible(v) {
    if (cashFrameEl()) cashFrameEl().style.display = v ? "block" : "none";
    if (cashHintEl()) cashHintEl().style.display = v ? "none" : "flex";
  }

  function buildCashUrl(show) {
    const base = "../spectacles/hall-cash.html";
    const url = new URL(base, window.location.href);
    url.searchParams.set("show", show.id);
    if (show.date) url.searchParams.set("date", show.date);
    url.searchParams.set("embed", "1");
    return url.toString();
  }

  function openCash(show) {
    const fr = cashFrameEl();
    if (!fr) return;
    fr.src = buildCashUrl(show);
    setCashVisible(true);
    fr.onload = () => setTimeout(fitIframeToWrap, 100);
  }

  function fitIframeToWrap() {
    const fr = cashFrameEl();
    const wrap = hallWrapEl();
    if (!fr || !wrap) return;

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;

    let cw = 1200, ch = 800;
    try {
      const d = fr.contentWindow.document.documentElement;
      cw = d.scrollWidth || cw;
      ch = d.scrollHeight || ch;
    } catch {}

    zoom = Math.min(1, w / cw, h / ch);
    fr.style.zoom = zoom;
  }

  // ===== RECEIVE BASKET FROM hall-cash =====
  window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.source !== "hall-cash") return;

  if (msg.type === "basket") {
    console.log("BASKET FROM HALL:", msg.payload);

    basket = Array.isArray(msg.payload) ? msg.payload : [];
    syncUI();
  }
});


  // ===== OPS =====
  function loadOps() {
    try {
      ops = JSON.parse(localStorage.getItem(lsKey("ops"))) || [];
    } catch {
      ops = [];
    }
  }

  function saveOps() {
    localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
  }

  function totalBasket() {
    return basket.reduce((s, x) => s + Number(x.price || 0), 0);
  }

  function syncUI() {
    qs("#basketTotal").textContent = totalBasket();
    renderBasket(qs("#basketList"), basket, currency);
    qs("#basketMeta").textContent =
      basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";
    renderOps(qs("#opsList"), ops);
  }

  // ===== ACTIONS =====
  function applyAction(type) {
    if (!current || !basket.length) return;

    ops.push({
      ts: nowIso(),
      tsHuman: fmtDT(Date.now()),
      action: type,
      showId: current.id,
      showLabel: `${current.title} — ${current.date} ${current.time}`,
      count: basket.length,
      total: totalBasket(),
      currency,
      seats: basket.map(x => x.key)
    });

    saveOps();
    basket = [];
    syncUI();
  }

  // ===== EXPORTS =====
  function exportStateJson() {
    downloadText(
      `backoffice_state_${current.id}.json`,
      JSON.stringify({ show: current, ops }, null, 2)
    );
  }

  function exportSalesCsv() {
    const rows = [["seat", "price", "show"]];
    ops.forEach(o =>
      o.seats.forEach(s => rows.push([s, o.total, o.showId]))
    );
    downloadText(`sales_${current.id}.csv`, toCsv(rows));
  }

  // ===== DATA =====
  async function loadSettings() {
    SETTINGS = await fetchJson("../data/settings.json");
    currency = SETTINGS?.theatre?.currency || "грн";
    setText("#boTitle", `Білетний відділ — ${SETTINGS?.theatre?.name || ""}`);
  }

  async function loadAfisha() {
    AFISHA = await fetchJson("../data/afisha.json");
  }

  function fillShowSelect() {
    const sel = qs("#showSelect");
    sel.innerHTML = `<option value="">— обрати —</option>`;
    AFISHA.forEach(s => {
      const o = document.createElement("option");
      o.value = `${s.id}__${s.date}`;
      o.textContent = `${s.title} — ${s.date} ${s.time}`;
      sel.appendChild(o);
    });

    sel.onchange = () => {
      if (!sel.value) return;
      const [id, date] = sel.value.split("__");
      current = AFISHA.find(x => x.id === id && x.date === date);
      setText("#seanceMeta", `${current.title} • ${current.date} ${current.time}`);
      loadOps();
      basket = [];
      syncUI();
      openCash(current);
    };
  }

  // ===== INIT =====
  async function init() {
    await loadSettings();
    await loadAfisha();
    fillShowSelect();
    loadOps();
    syncUI();
    setCashVisible(false);

    qs("#btnExportStateJson")?.addEventListener("click", exportStateJson);
    qs("#btnExportSalesCsv")?.addEventListener("click", exportSalesCsv);
    qs("#btnClearBasket")?.addEventListener("click", () => {
      basket = [];
      syncUI();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
