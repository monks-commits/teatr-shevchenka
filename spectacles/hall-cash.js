/* hall-cash.js — касса локально (browser print), НЕ трогает LiqPay */

(function(){
  const qs = (id)=>document.getElementById(id);

  const showSelect = qs("showSelect");
  const hallRoot   = qs("hallRoot");
  const metaLine   = qs("metaLine");
  const basketList = qs("basketList");
  const sumAmount  = qs("sumAmount");
  const searchBox  = qs("searchBox");

  const btnSell    = qs("btnSell");
  const btnReserve = qs("btnReserve");
  const btnClear   = qs("btnClear");
  const btnReset   = qs("btnReset");

  const errorBox   = qs("errorBox");

  const BASE = ".."; // /spectacles/ -> / (repo root) = ..
  const AFISHA_URL = `${BASE}/data/afisha.json`;

  let AFISHA = [];
  let SEANCE = null;
  let currentKey = "";      // show|date|time
  let basket = [];          // [{key,row,seat,label,price,zone}]
  // === BACKOFFICE BRIDGE ===
function exportBasketToParent(){
  if (window.parent === window) return;

  window.parent.postMessage({
    source: "hall-cash",
    type: "basket",
    payload: basket.map(x => ({
      key: x.key,
      label: x.label,
      price: Number(x.price || 0)
    }))
  }, "*");
}

  let localPatch = {};      // { "1-1": {status:"reserved"} ... } only for this seance

  // ---------- helpers ----------
  function showErr(msg){
    errorBox.style.display = "block";
    errorBox.textContent = msg;
  }
  function clearErr(){
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }

  function getUrlParams(){
    const u = new URL(location.href);
    return {
      show: u.searchParams.get("show") || "",
      date: u.searchParams.get("date") || "",
      time: u.searchParams.get("time") || ""
    };
  }

  async function fetchJson(url){
    const res = await fetch(url, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  function fmtUAH(n){
    const v = Math.round((Number(n)||0)*100)/100;
    return `${v.toFixed(0)} грн`;
  }

  function patchStorageKey(){
    return `cash_patch__${currentKey}`;
  }

  function loadPatch(){
    try{
      const raw = localStorage.getItem(patchStorageKey());
      localPatch = raw ? JSON.parse(raw) : {};
    }catch(e){
      localPatch = {};
    }
  }

  function savePatch(){
    localStorage.setItem(patchStorageKey(), JSON.stringify(localPatch));
  }

  function resetPatch(){
    localPatch = {};
    savePatch();
  }

  function normalizeSeance(se){
    // Гарантируем поля как в твоем JSON
    se = se || {};
    se.show = se.show || se.show_slug || "";
    se.date = se.date || "";
    se.time = se.time || "";
    se.title = se.title || "";
    se.hall_id = se.hall_id || "shevchenko-big";
    se.prices = se.prices || {};
    se.places = se.places || {};
    return se;
  }

  // ---------- pricing ----------
  function priceFor(row){
    // ориентируемся на твою структуру prices в seance json
    const p = (SEANCE && SEANCE.prices) ? SEANCE.prices : {};
    const r = Number(row);

    if(r>=1 && r<=6)   return Number(p["p_parter_1_6"]  ?? 200);
    if(r>=7 && r<=12)  return Number(p["p_parter_7_12"] ?? 180);
    if(r>=13 && r<=18) return Number(p["p_parter_13_18"]?? 160);
    if(r>=19 && r<=23) return Number(p["p_amphi_all"]    ?? 140);

    return 0;
  }

  function zoneFor(row){
    const r = Number(row);
    if(r>=1 && r<=18) return "Партер";
    if(r>=19 && r<=23) return "Амфітеатр";
    return "Зона";
  }

  // ---------- seat status ----------
  function seatKey(row, seat){
    return `${row}-${seat}`;
  }

  function getSeatStatus(row, seat){
    const k = seatKey(row, seat);

    // 1) локальные изменения кассы (приоритет)
    const lp = localPatch[k];
    if(lp && lp.status) return lp.status;

    // 2) то что лежит в seance.json (онлайн/демо статусы)
    const sp = (SEANCE && SEANCE.places) ? SEANCE.places[k] : null;
    if(sp && sp.status) return sp.status; // sold / reserved / blocked / free

    return "free";
  }

  function setSeatStatus(row, seat, status){
    const k = seatKey(row, seat);
    localPatch[k] = {status};
    savePatch();
  }

  // ---------- basket ----------
  function inBasket(k){
    return basket.some(x=>x.key===k);
  }

  function toggleBasket(row, seat){
    const k = seatKey(row, seat);
    const st = getSeatStatus(row, seat);
    if(st==="sold" || st==="blocked") return;

    if(inBasket(k)){
      basket = basket.filter(x=>x.key!==k);
      // возвращаем в free (только локально, не трогаем онлайн seance.json)
      setSeatStatus(row, seat, "free");
    }else{
      const info = {
        key: k,
        row: Number(row),
        seat: Number(seat),
        label: `ряд ${row}, місце ${seat}`,
        price: priceFor(row),
        zone: zoneFor(row)
      };
      basket.push(info);
      setSeatStatus(row, seat, "basket");
    }
    renderBasket();
    renderHall(); // чтобы покрасить места
    exportBasketToParent();

  }

  function clearBasket(){
    // Все basket-места -> free
    for(const it of basket){
      const [r,s] = it.key.split("-").map(Number);
      setSeatStatus(r, s, "free");
    }
    basket = [];
    renderBasket();
    renderHall();
    exportBasketToParent();

  }

  function applyBasketStatus(toStatus){
    for(const it of basket){
      const [r,s] = it.key.split("-").map(Number);
      setSeatStatus(r, s, toStatus);
    }
    basket = [];
    renderBasket();
    renderHall();
  }

  // ---------- render ----------
  function renderBasket(){
    if(!basket.length){
      basketList.textContent = "Поки що нічого не обрано.";
      sumAmount.innerHTML = `<b>0 грн</b>`;
      btnSell.disabled = true;
      btnReserve.disabled = true;
      btnClear.disabled = true;
      return;
    }

    btnSell.disabled = false;
    btnReserve.disabled = false;
    btnClear.disabled = false;

    const total = basket.reduce((a,x)=>a+(Number(x.price)||0),0);
    sumAmount.innerHTML = `<b>${fmtUAH(total)}</b>`;

    basketList.innerHTML = basket
      .sort((a,b)=>a.row-b.row || a.seat-b.seat)
      .map(x=>`
        <div class="basket-item">
          <div>${x.label}</div>
          <div><b>${fmtUAH(x.price)}</b></div>
        </div>
      `).join("");
  }

  function renderHall(){
    hallRoot.innerHTML = "";
    if(!SEANCE){
      hallRoot.innerHTML = `<div class="sub" style="padding:12px 14px;">Оберіть сеанс зверху.</div>`;
      return;
    }

    // зал "shevchenko-big": партер 1-18 (20 мест, проход после 10) + амфи 19-23 (11 мест)
    const frag = document.createDocumentFragment();

    // партер
    const parterTitle = document.createElement("div");
    parterTitle.className = "sub";
    parterTitle.style.padding = "8px 14px 0";
    parterTitle.innerHTML = `<b style="color:#0f172a">Партер</b>`;
    frag.appendChild(parterTitle);

    for(let row=1; row<=18; row++){
      frag.appendChild(renderRow(row, 20, 10));
    }

    // амфи (упрощенно одной линией 11)
    const amphiTitle = document.createElement("div");
    amphiTitle.className = "sub";
    amphiTitle.style.padding = "10px 14px 0";
    amphiTitle.innerHTML = `<b style="color:#0f172a">Амфітеатр</b>`;
    frag.appendChild(amphiTitle);

    for(let row=19; row<=23; row++){
      frag.appendChild(renderRow(row, 11, null));
    }

    hallRoot.appendChild(frag);
  }

  function renderRow(row, seatsCount, aisleAfter){
    const line = document.createElement("div");
    line.className = "rowline";

    const lab = document.createElement("div");
    lab.className = "rowlab";
    lab.textContent = String(row);
    line.appendChild(lab);

    const seats = document.createElement("div");
    seats.className = "seats";

    for(let seat=1; seat<=seatsCount; seat++){
      if(aisleAfter && seat===aisleAfter+1){
        const a = document.createElement("div");
        a.className = "aisle";
        seats.appendChild(a);
      }

      const btn = document.createElement("div");
      btn.className = "seat";

      const st = getSeatStatus(row, seat);
      btn.dataset.st = st;

      btn.title = `${zoneFor(row)} • ряд ${row} місце ${seat} • ${fmtUAH(priceFor(row))} • ${st}`;
      btn.textContent = String(seat);

      if(st==="sold" || st==="blocked"){
        // no click
      }else{
        btn.addEventListener("click", ()=>toggleBasket(row, seat));
      }

      seats.appendChild(btn);
    }

    line.appendChild(seats);
    return line;
  }

  // ---------- printing ----------
  function printTickets(){
    if(!basket.length) return;

    const total = basket.reduce((a,x)=>a+(Number(x.price)||0),0);
    const title = (SEANCE.title || SEANCE.show || "").trim() || "Подія";
    const dt = `${SEANCE.date || ""} ${SEANCE.time || ""}`.trim();

    const pages = basket
      .sort((a,b)=>a.row-b.row || a.seat-b.seat)
      .map((x,i)=>ticketHtml({title, dt, seat:x, total, idx:i+1, count:basket.length}))
      .join('<div style="page-break-after:always"></div>');

    const html = `
<!doctype html>
<html><head><meta charset="utf-8">
<title>Квитки (каса)</title>
<style>
  body{margin:0;font-family:Arial, sans-serif}
  .ticket{width:320px;border:1px solid #111;border-radius:10px;padding:10px;margin:10px}
  .h{display:flex;justify-content:space-between;align-items:flex-start}
  .logo{font-weight:900}
  .small{font-size:11px;color:#111}
  .big{font-size:16px;font-weight:900;margin-top:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .box{border:1px dashed #999;border-radius:8px;padding:8px}
  .lbl{font-size:10px;color:#444}
  .val{font-size:14px;font-weight:800}
  .note{margin-top:10px;font-size:10px;color:#333}
</style>
</head><body>
${pages}
<script>window.onload=()=>{setTimeout(()=>window.print(),200)}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if(!w){ alert("Браузер заблокував pop-up. Дозволь відкриття вікон для друку."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function ticketHtml({title, dt, seat, idx, count}){
    const ord = `CASH-${Date.now()}-${idx}`;
    return `
<div class="ticket">
  <div class="h">
    <div>
      <div class="logo">Театр ім. Т. Г. Шевченка</div>
      <div class="small">Каса (browser print)</div>
    </div>
    <div class="small">${ord}</div>
  </div>

  <div class="big">${escapeHtml(title)}</div>
  <div class="small">${escapeHtml(dt)}</div>

  <div class="grid">
    <div class="box"><div class="lbl">Ряд</div><div class="val">${seat.row}</div></div>
    <div class="box"><div class="lbl">Місце</div><div class="val">${seat.seat}</div></div>
    <div class="box"><div class="lbl">Ціна</div><div class="val">${fmtUAH(seat.price)}</div></div>
    <div class="box"><div class="lbl">Канал</div><div class="val">Каса</div></div>
  </div>

  <div class="note">
    Квиток дійсний на одну особу. Зберігайте квиток до кінця вистави.<br>
    QR/штрих-код буде додано на етапі синхронізації з системою.
  </div>
</div>`;
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g,(c)=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  // ---------- seance load / select ----------
  function buildOptions(){
    showSelect.innerHTML = `<option value="">— обрати —</option>`;

    // сортировка по дате/времени
    const list = [...AFISHA].sort((a,b)=>{
      const ad = `${a.date||""} ${a.time||""}`.trim();
      const bd = `${b.date||""} ${b.time||""}`.trim();
      return ad.localeCompare(bd);
    });

    for(const x of list){
      const v = `${x.id}|${x.date||""}|${x.time||""}`;
      const txt = `${x.title || x.id} — ${x.date||""}${x.time?`, ${x.time}`:""}`;
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = txt;
      showSelect.appendChild(opt);
    }
  }

  async function loadAfisha(){
    AFISHA = await fetchJson(AFISHA_URL);
    if(!Array.isArray(AFISHA)) AFISHA = [];
  }

  async function loadSeance(showId, date, time){
    // файл как у тебя: /data/seances/visim-2025-12-28.json
    const url = `${BASE}/data/seances/${showId}-${date}.json`;
    const se = normalizeSeance(await fetchJson(url));

    // время берем из url или из json
    if(time) se.time = time;
    if(!se.title){
      const item = AFISHA.find(x=>x.id===showId && String(x.date||"")===String(date));
      if(item) se.title = item.title || showId;
    }
    return se;
  }

  function setMeta(){
    if(!SEANCE){
      metaLine.textContent = "Оберіть сеанс зверху.";
      return;
    }
    const title = (SEANCE.title || SEANCE.show || "").trim();
    metaLine.textContent = `${title} • ${SEANCE.date||""} ${SEANCE.time||""} • hall_id: ${SEANCE.hall_id||""}`;
  }

  function applySearch(){
    const q = (searchBox.value||"").trim();
    if(!q) return;

    // простая подсветка/прокрутка по "ряд-место"
    const m = q.match(/^(\d{1,2})\s*[-: ]\s*(\d{1,2})$/);
    if(!m) return;
    const row = Number(m[1]);
    const seat = Number(m[2]);
    // найти элемент по номеру ряда и месту: не по id, поэтому просто скролл к примерному месту
    // (в этой версии оставим без сложностей)
    const lines = hallRoot.querySelectorAll(".rowline");
    for(const ln of lines){
      const lab = ln.querySelector(".rowlab");
      if(lab && Number(lab.textContent)===row){
        ln.scrollIntoView({behavior:"smooth", block:"center"});
        break;
      }
    }
  }

  // ---------- events ----------
  showSelect.addEventListener("change", async ()=>{
    clearErr();
    const v = showSelect.value;
    if(!v){
      SEANCE = null; basket=[]; localPatch={}; currentKey="";
      setMeta(); renderBasket(); renderHall();
      return;
    }

    const [showId, date, time] = v.split("|");
    try{
      SEANCE = await loadSeance(showId, date, time);
      currentKey = `${SEANCE.show}|${SEANCE.date}|${SEANCE.time}`;
      loadPatch();
      basket = [];
      setMeta();
      renderBasket();
      renderHall();
    }catch(e){
      SEANCE = null;
      basket=[];
      currentKey="";
      showErr(`Не вдалося завантажити сеанс: перевір /data/seances/${showId}-${date}.json`);
      setMeta(); renderBasket(); renderHall();
    }
  });

  btnClear.addEventListener("click", ()=>clearBasket());
  btnReserve.addEventListener("click", ()=>{
    if(!basket.length) return;
    applyBasketStatus("reserved");
  });

  btnSell.addEventListener("click", ()=>{
    if(!basket.length) return;
    // 1) печать
    printTickets();
    // 2) помечаем продано локально
    applyBasketStatus("sold");
  });

  btnReset.addEventListener("click", ()=>{
    if(!SEANCE || !currentKey){
      alert("Спочатку обери сеанс.");
      return;
    }
    if(!confirm("Скинути ВСІ локальні зміни каси для цього сеансу?")) return;
    resetPatch();
    basket = [];
    renderBasket();
    renderHall();
  });

  searchBox.addEventListener("change", applySearch);
  searchBox.addEventListener("keydown",(e)=>{ if(e.key==="Enter") applySearch(); });

  // ---------- boot ----------
  (async function init(){
    try{
      clearErr();
      await loadAfisha();
      buildOptions();

      // автоселект по URL ?show=visim
      const p = getUrlParams();
      if(p.show){
        // ищем запись в афише
        const item = AFISHA.find(x=>x.id===p.show) || null;
        const date = p.date || (item ? item.date : "");
        const time = p.time || (item ? item.time : "");
        if(item && date){
          showSelect.value = `${p.show}|${date}|${time||""}`;
          showSelect.dispatchEvent(new Event("change"));
        }
      }

    }catch(e){
      showErr(`Помилка ініціалізації: перевір, що існує ${AFISHA_URL}`);
    }
  })();

})();
