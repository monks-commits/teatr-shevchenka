(() => {
  const { qs, qsa, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = "bo_v2_";

  let SETTINGS = { theatre: {}, pricing_defaults: {} };
  let AFISHA = [];
  let current = null;
  let seance = null;
  let currency = "грн";

  let basket = [];   // приходит ТОЛЬКО из hall-cash
  let ops = [];
  let zoom = 1;

  let CLIENTS = [];
  let ORDERS = [];

  /* ---------------- storage ---------------- */

  function lsKey(name) {
    const showKey = current ? `${current.id}_${current.date}` : "no_show";
    return `${LS_PREFIX}${name}_${showKey}`;
  }
  function lsKeyGlobal(name){
    return `${LS_PREFIX}${name}_global`;
  }

  /* ---------------- iframe ---------------- */

  function cashFrame(){ return qs("#cashFrame"); }
  function cashHint(){ return qs("#cashHint"); }
  function hallWrap(){ return qs("#hallWrap"); }

  function setCashVisible(on){
    if(cashFrame()) cashFrame().style.display = on ? "block" : "none";
    if(cashHint()) cashHint().style.display = on ? "none" : "flex";
  }

  function buildCashUrl(show){
    const url = new URL("../spectacles/hall-cash.html", location.href);
    url.searchParams.set("show", show.id);
    if(show.date) url.searchParams.set("date", show.date);
    url.searchParams.set("embed", "1");
    return url.toString();
  }

  function openCash(show){
    const fr = cashFrame();
    if(!fr) return;
    fr.src = buildCashUrl(show);
    setCashVisible(true);
    fr.onload = () => setTimeout(fitIframeToWrap, 80);
  }

  function fitIframeToWrap(){
    const fr = cashFrame(), wrap = hallWrap();
    if(!fr || !wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if(!w || !h) return;
    const scale = Math.min(1, w / 1200, h / 900);
    zoom = Math.max(0.55, scale);
    fr.style.zoom = String(zoom);
  }

  /* ---------------- UI sync ---------------- */

  function syncUI(){
    qs("#basketTotal").textContent = basket.reduce((s,i)=>s+Number(i.price||0),0);
    renderBasket(qs("#basketList"), basket, currency);
    qs("#basketMeta").textContent = basket.length ? `Обрано: ${basket.length}` : "Поки що нічого не обрано.";
    renderOps(qs("#opsList"), ops);
  }

  /* ---------------- messages from hall-cash ---------------- */

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if(!msg || msg.source !== "hall-cash") return;

    if(msg.type === "basket:update"){
      basket = Array.isArray(msg.payload?.items) ? msg.payload.items : [];
      syncUI();
    }

    if(msg.type === "sale:done"){
      ops.push({
        ts: nowIso(),
        tsHuman: fmtDT(Date.now()),
        action: msg.payload.status,
        status: msg.payload.status,
        showId: current?.id,
        showLabel: current ? `${current.title} — ${current.date} ${current.time}` : "",
        count: (msg.payload.seats||[]).length,
        total: msg.payload.total || 0,
        currency,
        seats: msg.payload.seats || []
      });
      localStorage.setItem(lsKey("ops"), JSON.stringify(ops));
      basket = [];
      syncUI();
    }
  });

  /* ---------------- data ---------------- */

  async function loadSettings(){
    SETTINGS = await fetchJson("../data/settings.json");
    currency = SETTINGS?.theatre?.currency || "грн";
    setText("#boTitle", `Білетний відділ — ${SETTINGS?.theatre?.name || ""}`);
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

    sel.onchange = async ()=>{
      if(!sel.value){
        current = null;
        setCashVisible(false);
        basket=[]; ops=[];
        syncUI();
        return;
      }
      const [id,date] = sel.value.split("__");
      current = AFISHA.find(x=>x.id===id && x.date===date);
      ops = JSON.parse(localStorage.getItem(lsKey("ops"))||"[]");
      syncUI();
      openCash(current);
    };
  }

  /* ---------------- init ---------------- */

  async function init(){
    await loadSettings();
    await loadAfisha();
    fillShowSelect();
    setCashVisible(false);
    syncUI();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
