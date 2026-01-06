// backoffice/app.js
(() => {
  const { qs, nowIso, fmtDT, downloadText, toCsv, fetchJson } = window.BO_UTILS;
  const { setText, renderBasket, renderOps } = window.BO_UI;

  const LS_PREFIX = 'bo_v1_';

  let SETTINGS = { theatre:{}, pricing_defaults:{}, pricing_defaults_fallback:{} };
  let AFISHA = [];
  let current = null; // {id,title,date,time, stage...}
  let seance = null;  // data/seances/*.json
  let hall = null;    // data/halls/*.json
  let currency = 'грн';

  // state per seance
  let seatStatus = new Map(); // key -> status (free/reserved/sold/realization/invite/blocked)
  let basket = [];            // [{key,label,price}]
  let ops = [];               // log operations

  // zoom
  let zoom = 1;

  // -------------------- helpers --------------------
  function lsKey(name){
    const showKey = current ? `${current.id}_${current.date}` : 'no_show';
    return `${LS_PREFIX}${name}_${showKey}`;
  }

  function makeSeatKey(row, seat){
    return `${row}-${seat}`;
  }

  function seatLabel(row, seat, zoneLabel){
    return `${zoneLabel} • ряд ${row} • місце ${seat}`;
  }

  function zoneName(zone){
    switch(zone){
      case 'parter': return 'Партер';
      case 'amphi': return 'Амфітеатр';
      case 'balcony': return 'Балкон';
      case 'lodge': return 'Ложа';
      default: return zone;
    }
  }

  function getPriceForSeat(row, zone){
    // Берём из seance.prices (если есть)
    const p = (seance && seance.prices) ? seance.prices : null;
    if (p){
      // правила по ключам как в data/settings.json
      if (zone === 'parter'){
        if (row <= 6 && p.p_parter_1_6 != null) return Number(p.p_parter_1_6)||0;
        if (row <= 12 && p.p_parter_7_12 != null) return Number(p.p_parter_7_12)||0;
        if (row <= 18 && p.p_parter_13_18 != null) return Number(p.p_parter_13_18)||0;
      }
      if (zone === 'amphi' && p.p_amphi_all != null) return Number(p.p_amphi_all)||0;
      if (zone === 'balcony'){
        // row 1-5 and 6 like in your settings
        if (row <= 5 && p.p_balcony_1_5 != null) return Number(p.p_balcony_1_5)||0;
        if (row === 6 && p.p_balcony_6 != null) return Number(p.p_balcony_6)||0;
      }
      if (zone === 'lodge' && p.p_boxes != null) return Number(p.p_boxes)||0;
    }

    // fallback — settings.json
    const d = SETTINGS.pricing_defaults || {};
    if (zone === 'parter'){
      if (row <= 6 && d.p_parter_1_6 != null) return Number(d.p_parter_1_6)||0;
      if (row <= 12 && d.p_parter_7_12 != null) return Number(d.p_parter_7_12)||0;
      if (row <= 18 && d.p_parter_13_18 != null) return Number(d.p_parter_13_18)||0;
    }
    if (zone === 'amphi' && d.p_amphi_all != null) return Number(d.p_amphi_all)||0;
    if (zone === 'balcony'){
      if (row <= 5 && d.p_balcony_1_5 != null) return Number(d.p_balcony_1_5)||0;
      if (row === 6 && d.p_balcony_6 != null) return Number(d.p_balcony_6)||0;
    }
    if (zone === 'lodge' && d.p_boxes != null) return Number(d.p_boxes)||0;

    return 0;
  }

  function totalBasket(){
    return basket.reduce((s,i)=>s+(Number(i.price)||0),0);
  }

  function isLockedStatus(st){
    return st === 'sold' || st === 'blocked';
  }

  function humanActionName(a){
    switch(a){
      case 'sell': return 'ПРОДАЖ';
      case 'reserve': return 'РЕЗЕРВ';
      case 'realization': return 'РЕАЛІЗАЦІЯ';
      case 'invite': return 'ЗАПРОШЕННЯ';
      case 'clear': return 'ОЧИЩЕННЯ';
      default: return a;
    }
  }

  // -------------------- load/save state --------------------
  function loadLocalState(){
    seatStatus = new Map();
    basket = [];
    ops = [];

    const raw1 = localStorage.getItem(lsKey('seatStatus'));
    if (raw1){
      try{
        const obj = JSON.parse(raw1);
        for (const [k,v] of Object.entries(obj)) seatStatus.set(k, v);
      }catch{}
    }

    const raw2 = localStorage.getItem(lsKey('ops'));
    if (raw2){
      try{ ops = JSON.parse(raw2) || []; }catch{ ops=[]; }
    }

    syncUI();
  }

  function saveSeatStatus(){
    const obj = {};
    for (const [k,v] of seatStatus.entries()) obj[k]=v;
    localStorage.setItem(lsKey('seatStatus'), JSON.stringify(obj));
  }
  function saveOps(){
    localStorage.setItem(lsKey('ops'), JSON.stringify(ops));
  }

  // -------------------- rendering hall --------------------
  function setZoom(value){
    zoom = Math.max(0.6, Math.min(1.8, value));
    const root = qs('#hallRoot');
    if (root) root.style.transform = `scale(${zoom})`;
  }

  function seatDom(key, label, price){
    const btn = document.createElement('button');
    btn.className = 'seat';
    btn.type = 'button';
    btn.dataset.key = key;

    // status calc:
    const stBase = seatStatus.get(key) || 'free';
    const inBasket = basket.some(x=>x.key===key);
    const st = inBasket ? 'basket' : stBase;

    btn.dataset.st = st;
    btn.title = `${label}\n${price} ${currency}\nСтатус: ${stBase}`;

    // show seat number as last part
    const seatNum = key.split('-')[1] || '';
    btn.textContent = seatNum;

    if (isLockedStatus(stBase)){
      btn.disabled = true;
    }

    btn.addEventListener('click', ()=>{
      const base = seatStatus.get(key) || 'free';
      if (isLockedStatus(base)) return;

      const idx = basket.findIndex(x=>x.key===key);
      if (idx >= 0){
        basket.splice(idx,1);
      } else {
        basket.push({ key, label, price });
      }

      // rerender seat status quickly
      btn.dataset.st = basket.some(x=>x.key===key) ? 'basket' : base;

      syncUI();
    });

    return btn;
  }

  function renderZone(title, rows){
    const root = qs('#hallRoot');
    if(!root) return;

    const t = document.createElement('div');
    t.className = 'sectionTitle';
    t.textContent = title;
    root.appendChild(t);

    for (const r of rows){
      const line = document.createElement('div');
      line.className = 'rowLine';

      const lab = document.createElement('div');
      lab.className = 'rowLabel';
      lab.textContent = String(r.row);
      line.appendChild(lab);

      const rowWrap = document.createElement('div');
      rowWrap.className = 'seatsRow';

      const seatsCount = Number(r.seats || 0);
      for (let s=1; s<=seatsCount; s++){
        const key = makeSeatKey(r.row, s);
        const price = getPriceForSeat(r.row, r.zone);
        const lbl = seatLabel(r.row, s, zoneName(r.zone));

        const b = seatDom(key, lbl, price);

        // aisle gap (optional): if schema row has aisle_after number (like 10)
        if (r.aisle_after && Number(r.aisle_after) === s) {
          b.classList.add('gapRight');
        }

        rowWrap.appendChild(b);
      }

      line.appendChild(rowWrap);
      root.appendChild(line);
    }
  }

  function renderHall(){
    const root = qs('#hallRoot');
    if(!root) return;
    root.innerHTML = '';

    if (!current || !seance || !hall){
      root.innerHTML = `<div class="muted">Оберіть сеанс, щоб побачити зал.</div>`;
      return;
    }

    const rows = (hall.rows || []).slice();

    const parter = rows.filter(x=>x.zone==='parter');
    const lodge  = rows.filter(x=>x.zone==='lodge');
    const amphi  = rows.filter(x=>x.zone==='amphi');
    const balcony= rows.filter(x=>x.zone==='balcony');

    // ВАЖНО: lodge в твоих seances хранится как boxA-1 и boxB-3 — но пока V1 оставляем
    // как "ряд 0" не делаем, чтобы не конфликтовать с онлайном.
    // Поэтому lodge рисуем как "ряд 0", но ключи делаем "boxA-*" и "boxB-*".
    // И статусы тоже берём по этим ключам если они есть в seance.places.
    // (Это не ломает онлайн, потому что backoffice отдельный.)
    const haveBoxes = true;

    renderZone('Партер', parter);

    if (haveBoxes){
      // Boxes: A and B each 18
      const boxSection = document.createElement('div');
      boxSection.className = 'sectionTitle';
      boxSection.textContent = 'Ложі (A / B)';
      root.appendChild(boxSection);

      const wrapA = document.createElement('div');
      wrapA.className = 'rowLine';
      wrapA.innerHTML = `<div class="rowLabel">A</div>`;
      const rowA = document.createElement('div');
      rowA.className = 'seatsRow';

      for (let i=1;i<=18;i++){
        const key = `boxA-${i}`;
        const price = (seance?.prices?.p_boxes != null) ? Number(seance.prices.p_boxes)||0 : (SETTINGS?.pricing_defaults?.p_boxes||0);
        const lbl = `Ложа A • місце ${i}`;
        const b = document.createElement('button');
        b.className = 'seat';
        b.type = 'button';
        b.dataset.key = key;

        const base = seatStatus.get(key) || 'free';
        const inBasket = basket.some(x=>x.key===key);
        b.dataset.st = inBasket ? 'basket' : base;
        b.textContent = String(i);
        b.title = `${lbl}\n${price} ${currency}\nСтатус: ${base}`;

        if (isLockedStatus(base)) b.disabled = true;

        b.addEventListener('click', ()=>{
          const st = seatStatus.get(key) || 'free';
          if (isLockedStatus(st)) return;
          const idx = basket.findIndex(x=>x.key===key);
          if (idx>=0) basket.splice(idx,1);
          else basket.push({ key, label: lbl, price });
          b.dataset.st = basket.some(x=>x.key===key) ? 'basket' : st;
          syncUI();
        });

        rowA.appendChild(b);
      }
      wrapA.appendChild(rowA);
      root.appendChild(wrapA);

      const wrapB = document.createElement('div');
      wrapB.className = 'rowLine';
      wrapB.innerHTML = `<div class="rowLabel">B</div>`;
      const rowB = document.createElement('div');
      rowB.className = 'seatsRow';
      for (let i=1;i<=18;i++){
        const key = `boxB-${i}`;
        const price = (seance?.prices?.p_boxes != null) ? Number(seance.prices.p_boxes)||0 : (SETTINGS?.pricing_defaults?.p_boxes||0);
        const lbl = `Ложа B • місце ${i}`;

        const b = document.createElement('button');
        b.className = 'seat';
        b.type = 'button';
        b.dataset.key = key;

        const base = seatStatus.get(key) || 'free';
        const inBasket = basket.some(x=>x.key===key);
        b.dataset.st = inBasket ? 'basket' : base;
        b.textContent = String(i);
        b.title = `${lbl}\n${price} ${currency}\nСтатус: ${base}`;

        if (isLockedStatus(base)) b.disabled = true;

        b.addEventListener('click', ()=>{
          const st = seatStatus.get(key) || 'free';
          if (isLockedStatus(st)) return;
          const idx = basket.findIndex(x=>x.key===key);
          if (idx>=0) basket.splice(idx,1);
          else basket.push({ key, label: lbl, price });
          b.dataset.st = basket.some(x=>x.key===key) ? 'basket' : st;
          syncUI();
        });

        rowB.appendChild(b);
      }
      wrapB.appendChild(rowB);
      root.appendChild(wrapB);
    }

    if (amphi.length) renderZone('Амфітеатр', amphi);
    if (balcony.length) renderZone('Балкон', balcony);

    setZoom(zoom);
  }

  // -------------------- UI sync --------------------
  function syncUI(){
    // basket
    const meta = qs('#basketMeta');
    const list = qs('#basketList');
    const totalEl = qs('#basketTotal');

    if (meta){
      meta.textContent = basket.length ? `Обрано: ${basket.length}` : 'Поки що нічого не обрано.';
    }
    if (totalEl) totalEl.textContent = String(totalBasket());
    renderBasket(list, basket, currency);

    // ops
    const opsList = qs('#opsList');
    renderOps(opsList, ops);

    // rerender hall seats statuses (fast update)
    // update all seat buttons data-st based on base+inbasket
    const hallRoot = qs('#hallRoot');
    if (hallRoot){
      hallRoot.querySelectorAll('.seat[data-key]').forEach(btn=>{
        const key = btn.dataset.key;
        const base = seatStatus.get(key) || 'free';
        const inB = basket.some(x=>x.key===key);
        btn.dataset.st = inB ? 'basket' : base;
        if (isLockedStatus(base)) btn.setAttribute('disabled','disabled'); else btn.removeAttribute('disabled');
      });
    }

    // currency
    const curEl = qs('#currency');
    if (curEl) curEl.textContent = currency;
  }

  // -------------------- actions --------------------
  function clearBasket(){
    basket = [];
    syncUI();
  }

  function applyToBasket(status){
    if (!current) { alert('Оберіть сеанс.'); return; }
    if (!basket.length) return;

    const seatKeys = basket.map(x=>x.key);
    for (const k of seatKeys){
      seatStatus.set(k, status);
    }
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

  function sell(){ applyToBasket('sold'); }
  function reserve(){ applyToBasket('reserved'); }
  function realize(){ applyToBasket('realization'); }
  function invite(){ applyToBasket('invite'); }

  function exportStateJson(){
    if (!current) { alert('Оберіть сеанс.'); return; }
    const obj = {};
    for (const [k,v] of seatStatus.entries()) obj[k]=v;
    downloadText(`backoffice_state_${current.id}_${current.date}.json`, JSON.stringify({
      show: current,
      seance,
      state: obj,
      ops
    }, null, 2));
  }

  function exportSalesCsv(){
    if (!current) { alert('Оберіть сеанс.'); return; }
    const rows = [['ts','action','seat','status','total','currency','showId','showDate']];
    for (const o of ops){
      // продажи: ПРОДАЖ
      if (o.action !== 'ПРОДАЖ') continue;
      for (const s of (o.seats||[])){
        rows.push([o.ts, o.action, s, o.status, o.total, o.currency, o.showId, current.date]);
      }
    }
    downloadText(`backoffice_sales_${current.id}_${current.date}.csv`, toCsv(rows));
  }

  function exportOpsCsv(){
    if (!current) { alert('Оберіть сеанс.'); return; }
    const rows = [['ts','action','count','total','currency','showId','seats']];
    for (const o of ops){
      rows.push([o.ts, o.action, o.count, o.total, o.currency, o.showId, (o.seats||[]).join(',')]);
    }
    downloadText(`backoffice_ops_${current.id}_${current.date}.csv`, toCsv(rows));
  }

  function exportOpsJson(){
    if (!current) { alert('Оберіть сеанс.'); return; }
    downloadText(`backoffice_ops_${current.id}_${current.date}.json`, JSON.stringify(ops, null, 2));
  }

  function clearOps(){
    if (!current) return;
    ops = [];
    saveOps();
    syncUI();
  }

  function resetLocal(){
    if (!current) return;
    localStorage.removeItem(lsKey('seatStatus'));
    localStorage.removeItem(lsKey('ops'));
    loadLocalState();
    renderHall();
  }

  // -------------------- data loading --------------------
  async function loadSettings(){
    try{
      SETTINGS = await fetchJson('../data/settings.json');

      // currency
      currency = SETTINGS?.theatre?.currency || 'грн';
      setText('#boTitle', SETTINGS?.theatre?.name ? `Білетний відділ — ${SETTINGS.theatre.name}` : 'Білетний відділ');

      // IMPORTANT: даже если в settings.json нет supabase_anon_key — нам плевать.
      return SETTINGS;
    }catch(e){
      console.warn('settings.json не прочитался', e);
      SETTINGS = { theatre:{}, pricing_defaults:{} };
      currency = 'грн';
      return SETTINGS;
    }
  }

  async function loadAfisha(){
    AFISHA = await fetchJson('../data/afisha.json');
    return AFISHA;
  }

  function fillShowSelect(){
    const sel = qs('#showSelect');
    if (!sel) return;

    sel.innerHTML = '<option value="">— обрати —</option>';
    for (const s of AFISHA){
      const opt = document.createElement('option');
      opt.value = `${s.id}__${s.date}`;
      opt.textContent = `${s.title} — ${s.date}, ${s.time}`;
      sel.appendChild(opt);
    }

    sel.addEventListener('change', async ()=>{
      const v = sel.value || '';
      if (!v){
        current = null; seance=null; hall=null;
        setText('#seanceMeta', 'Оберіть сеанс.');
        renderHall();
        loadLocalState();
        return;
      }
      const [id, date] = v.split('__');
      const found = AFISHA.find(x=>x.id===id && x.date===date) || AFISHA.find(x=>x.id===id) || null;
      if (!found) return;

      await loadSeance(found);
    });
  }

  async function loadSeance(show){
    current = show;

    // 1) seance json by convention: /data/seances/{id}-{date}.json
    const seanceUrl = `../data/seances/${show.id}-${show.date}.json`;
    try{
      seance = await fetchJson(seanceUrl);
    }catch(e){
      console.error('Cannot load seance:', seanceUrl, e);
      alert(`Не можу завантажити сеанс: ${seanceUrl}\nПеревір: чи є файл у /data/seances/`);
      seance = null;
      return;
    }

    // 2) hall by seance.hall_id
    const hallId = seance.hall_id || seance.hallId || 'shevchenko-big';
    const hallUrl = `../data/halls/${hallId}.json`;
    try{
      hall = await fetchJson(hallUrl);
    }catch(e){
      console.error('Cannot load hall:', hallUrl, e);
      alert(`Не можу завантажити зал: ${hallUrl}`);
      hall = null;
      return;
    }

    // 3) init base statuses from seance.places (если есть)
    seatStatus = new Map();

    // сначала дефолт: free
    // затем применяем seance.places (sold/reserved/blocked/...)
    const places = seance.places || {};
    for (const [k, v] of Object.entries(places)){
      const st = v?.status || 'free';
      // нормализуем
      let norm = st;
      if (st === 'hold') norm = 'reserved';
      if (st === 'boxoffice') norm = 'sold';
      seatStatus.set(k, norm);
    }

    // 4) применяем локальные поверх (если есть)
    const rawLocal = localStorage.getItem(lsKey('seatStatus'));
    if (rawLocal){
      try{
        const obj = JSON.parse(rawLocal);
        for (const [k,v] of Object.entries(obj)){
          seatStatus.set(k, v);
        }
      }catch{}
    }

    // ops local
    const rawOps = localStorage.getItem(lsKey('ops'));
    ops = [];
    if (rawOps){
      try{ ops = JSON.parse(rawOps) || []; }catch{ ops=[]; }
    }

    basket = [];

    // header
    setText('#seanceMeta', `${show.title} • ${show.date} ${show.time} • hall_id: ${hallId}`);

    // render
    saveSeatStatus(); // фиксируем чтобы UI был консистентный
    saveOps();
    renderHall();
    syncUI();
  }

  // -------------------- init --------------------
  function initToolbar(){
    qs('#btnZoomIn')?.addEventListener('click', ()=>setZoom(zoom + 0.1));
    qs('#btnZoomOut')?.addEventListener('click', ()=>setZoom(zoom - 0.1));
    qs('#btnHome')?.addEventListener('click', ()=>{ const w=qs('#hallWrap'); if(w) w.scrollTo({top:0,left:0,behavior:'smooth'}); });
    qs('#btnList')?.addEventListener('click', ()=>qs('#opsList')?.scrollIntoView({behavior:'smooth'}));

    qs('#btnSell')?.addEventListener('click', sell);
    qs('#btnReserve')?.addEventListener('click', reserve);
    qs('#btnRealize')?.addEventListener('click', realize);
    qs('#btnInvite')?.addEventListener('click', invite);
    qs('#btnClearBasket')?.addEventListener('click', clearBasket);

    qs('#btnExportStateJson')?.addEventListener('click', exportStateJson);
    qs('#btnExportSalesCsv')?.addEventListener('click', exportSalesCsv);

    qs('#btnExportOpsCsv')?.addEventListener('click', exportOpsCsv);
    qs('#btnExportOpsJson')?.addEventListener('click', exportOpsJson);
    qs('#btnClearOps')?.addEventListener('click', clearOps);

    qs('#btnResetLocal')?.addEventListener('click', resetLocal);

    // dates
    const from = qs('#rangeFrom');
    const to = qs('#rangeTo');
    const today = new Date();
    const pad = (n)=>String(n).padStart(2,'0');
    const y = today.getFullYear(), m=pad(today.getMonth()+1), d=pad(today.getDate());
    if (from) from.value = `${y}-${m}-01`;
    if (to) to.value = `${y}-${m}-${d}`;
  }

  async function init(){
    initToolbar();
    await loadSettings();
    await loadAfisha();
    fillShowSelect();

    // initial empty
    setText('#seanceMeta', 'Оберіть сеанс.');
    renderHall();
    syncUI();
    setZoom(1);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    init().catch(e=>{
      console.error(e);
      alert('Помилка ініціалізації Backoffice. Відкрий консоль (F12) і покажи помилку.');
    });
  });

})();
