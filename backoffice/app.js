(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v2_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];
  let current = null;
  let seance = null;
  let currency = "грн";

  let basket = []; // [{key,label,price}]
  // === receive basket from hall-cash ===
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.source !== "hall-cash") return;

  if (msg.type === "basket" && Array.isArray(msg.payload)) {
    basket = msg.payload.map(it => ({
      key: it.key,
      label: it.label || it.key,
      price: Number(it.price || 0)
    }));

    syncUI(); // ОБЯЗАТЕЛЬНО
  }
});

  let ops = [];
  let zoom = 1;

  // -------------------- localStorage helpers --------------------
  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  // -------------------- iframe helpers --------------------
  function cashFrameEl(){ return qs("#cashFrame"); }
  function cashHintEl(){ return qs("#cashHint"); }
  function hallWrapEl(){ return qs("#hallWrap"); }

  function setCashVisible(yes){
    const fr = cashFrameEl();
    const hint = cashHintEl();
    if(fr) fr.style.display = yes ? "block" : "none";
    if(hint) hint.style.display = yes ? "none" : "flex";
  }

  function buildCashUrl(show){
    const base = "../spectacles/hall-cash.html";
    const url = new URL(base, window.location.href);
    url.searchParams.set("show", show.id);
    if (show.date) url.searchParams.set("date", show.date);
    url.searchParams.set("embed", "1");
    return url.toString();
  }

  function openCash(show){
    const fr = cashFrameEl();
    if(!fr || !show) return;
    fr.src = buildCashUrl(show);
    setCashVisible(true);
    fr.onload = () => setTimeout(fitIframeToWrap, 80);
  }

  function fitIframeToWrap(){
    const fr = cashFrameEl();
    const wrap = hallWrapEl();
    if(!fr || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const scale = Math.min(1, w / 1200, h / 800);
    setZoom(scale);
  }

  function setZoom(v){
    zoom = Math.max(0.55, Math.min(1, v));
    const fr = cashFrameEl();
    if(fr) fr.style.zoom = String(zoom);
  }

  // -------------------- UI sync --------------------
  function totalBasket(){
    return basket.reduce((s,x)=>s+(Number(x.price)||0),0);
  }

  function syncUI(){
    setText("#basketTotal", totalBasket());
    renderBasket(qs("#basketList"), basket, currency);
    setText("#basketMeta", basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.");
    renderOps(qs("#opsList"), ops);
  }

  // -------------------- iframe → backoffice (КЛЮЧЕВОЕ) --------------------
  function normalizeBasketItems(arr){
    if(!Array.isArray(arr)) return [];
    return arr.map(x => ({
      key: String(x?.key ?? "").trim(),
      label: String(x?.label ?? "").trim(),
      price: Number(x?.price ?? 0) || 0
    })).filter(x => x.key);
  }

  window.addEventListener("message", (ev) => {
    const msg = ev?.data;
    if(!msg || msg.source !== "hall-cash") return;

    if(msg.type === "basket"){
      basket = normalizeBasketItems(msg.payload);
      syncUI();
    }
  });

  // -------------------- actions --------------------
  function clearBasket(){
    basket = [];
    syncUI();
  }

  function applyToBasket(status){
    if(!current || !basket.length) return;

    ops.push({
      ts: nowIso(),
      tsHuman: fmtDT(Date.now()),
      action: status,
      showId: current.id,
      count: basket.length,
      total: totalBasket(),
      currency,
      seats: basket.map(x=>x.key)
    });

    basket = [];
    syncUI();
  }

  function sell(){ applyToBasket("sold"); }
  function reserve(){ applyToBasket("reserved"); }
  function takeQuota(){
  if(!current){
    alert("Оберіть сеанс.");
    return;
  }
  if(!basket.length){
    alert("Кошик порожній.");
    return;
  }

  ops.push({
    ts: nowIso(),
    tsHuman: fmtDT(Date.now()),
    action: "КВОТА",
    status: "quota",
    showId: current.id,
    showLabel: `${current.title} — ${current.date} ${current.time}`,
    count: basket.length,
    total: totalBasket(),
    currency,
    seats: basket.map(x => x.key),
    payment: "cashless",
    document: "invoice"
  });

  // сообщаем hall-cash
  postToCash("apply_status", {
    status: "quota",
    seats: basket.map(x => x.key),
    show: current
  });

  basket = [];
  syncUI();
}


  // -------------------- data loading --------------------
  async function loadSettings(){
    SETTINGS = await fetchJson("../data/settings.json");
    currency = SETTINGS?.theatre?.currency || "грн";
    setText("#boTitle", SETTINGS?.theatre?.name
      ? `Білетний відділ — ${SETTINGS.theatre.name}`
      : "Білетний відділ");
  }

  async function loadAfisha(){
    AFISHA = await fetchJson("../data/afisha.json");
  }

  function fillShowSelect(){
    const sel = qs("#showSelect");
    sel.innerHTML = '<option value="">— обрати —</option>';
    AFISHA.forEach(s=>{
      const o = document.createElement("option");
      o.value = `${s.id}__${s.date}`;
      o.textContent = `${s.title} — ${s.date} ${s.time}`;
      sel.appendChild(o);
    });

    sel.addEventListener("change", async ()=>{
      const v = sel.value;
      if(!v){
        current = null;
        setCashVisible(false);
        basket=[];
        syncUI();
        return;
      }
      const [id,date] = v.split("__");
      current = AFISHA.find(x=>x.id===id && x.date===date);
      setText("#seanceMeta", `${current.title} • ${current.date} ${current.time}`);
      basket=[];
      syncUI();
      openCash(current);
    });
  }

  // -------------------- toolbar --------------------
  function initToolbar(){
    qs("#btnSell")?.addEventListener("click", sell);
    qs("#btnReserve")?.addEventListener("click", reserve);
    qs("#btnClearBasket")?.addEventListener("click", clearBasket);
    qs("#btnFit")?.addEventListener("click", fitIframeToWrap);
    qs("#btnZoomIn")?.addEventListener("click", ()=>setZoom(zoom+0.05));
    qs("#btnZoomOut")?.addEventListener("click", ()=>setZoom(zoom-0.05));
    qs("#btnQuota")?.addEventListener("click", takeQuota);

  }

  // -------------------- init --------------------
  async function init(){
    initToolbar();
    await loadSettings();
    await loadAfisha();
    fillShowSelect();
    setCashVisible(false);
    syncUI();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
