// admin/admin.js

// ===== Глобальні налаштування =====
let SETTINGS = null;
let CURRENCY = 'грн';
let PRICING_DEFAULTS = {};
let PRICE_PALETTE = {}; // "200" -> "seat--p200"

const LS_PREFIX = 'shev_admin_v3_';

// Пам'ять
let hallSchema = null;
let afisha = [];
let currentShowId = '';  // выбранный спектакль

// состояние мест: per-show
// key = "row-seat-zone" -> 'free' | 'sold' | 'reserved' | 'inactive'
const seatState = new Map();

// корзина: [{key,row,seat,zone,price,label}]
let basket = [];

// реестр брони: per-show
// [{id, showId, who, seats:[{row,seat,zone,price,key,label}], total, createdAt}]
let reserves = [];

// журнал операций (export): per-show
// [{ts, showId, action, who, seats, total}]
let ops = [];

// ===== Utils =====
function nowIso() { return new Date().toISOString(); }
function fmtDT(ts){ try { return new Date(ts).toLocaleString('uk-UA'); } catch { return ts; } }

function seatKey(row, seat, zone){
  return `${zone}:${row}-${seat}`;
}
function parseSeatKey(key){
  // "parter:10-12"
  const [zone, rs] = key.split(':');
  const [row, seat] = rs.split('-').map(Number);
  return { zone, row, seat };
}

function lsKey(name){
  return `${LS_PREFIX}${name}_${currentShowId || 'no_show'}`;
}

function downloadText(filename, text){
  const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 500);
}

// ===== Load settings.json =====
async function loadSettings(){
  if (SETTINGS) return SETTINGS;

  try{
    const res = await fetch('../data/settings.json', {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    SETTINGS = await res.json();

    if (SETTINGS.theatre?.currency) CURRENCY = SETTINGS.theatre.currency;
    if (SETTINGS.pricing_defaults) PRICING_DEFAULTS = SETTINGS.pricing_defaults;
    if (SETTINGS.price_palette) PRICE_PALETTE = SETTINGS.price_palette;

  }catch(e){
    console.warn('settings.json не прочитался, используем дефолты', e);
    SETTINGS = {};
  }
  return SETTINGS;
}

// ===== Load hall schema =====
async function loadHallSchema(){
  if (hallSchema) return hallSchema;
  const res = await fetch('../data/halls/shevchenko-big.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Cannot load hall schema: ' + res.status);
  hallSchema = await res.json();
  return hallSchema;
}

// ===== Load afisha =====
async function loadAfisha(){
  const res = await fetch('../data/afisha.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Cannot load afisha: ' + res.status);
  afisha = await res.json();
  return afisha;
}

// ===== Price helpers =====
function getPriceForRow(rowInfo){
  // приоритет: rowInfo.price -> pricing_defaults[group]
  if (rowInfo.price != null) return Number(rowInfo.price) || 0;
  const g = rowInfo.price_group;
  if (g && PRICING_DEFAULTS[g] != null) return Number(PRICING_DEFAULTS[g]) || 0;
  return 0;
}

function getPriceClass(price){
  const key = String(price);
  return PRICE_PALETTE?.[key] || '';
}

function getZoneLabel(zone){
  switch(zone){
    case 'parter': return 'Партер';
    case 'amphi': return 'Амфітеатр';
    case 'balcony': return 'Балкон';
    case 'lodge': return 'Ложа';
    default: return zone;
  }
}

// ===== Sellable policy (ВАЖНО: как ты сказал) =====
// В Театре Шевченко продаём ТОЛЬКО партер.
// Амфи/балкон показываем серыми и НЕ продаём.
function isSellable(zone){
  return zone === 'parter' || zone === 'lodge'; // если ложи у вас в партере — разрешаем
}

// ===== Ticket printing (batch = одна страница) =====
function openPrintBatch(items, show){
  // делаем отдельное окно с пачкой билетов (одна печать)
  const orderPrefix = 'ORD-' + Date.now();

  const safe = (s)=>String(s ?? '').replace(/[<>]/g,'');
  const showTitle = safe(show?.title || 'Назва вистави');
  const showStage = safe(show?.stage || '');
  const showDT = safe(`${show?.date || ''} ${show?.time || ''}`.trim());

  const ticketsHtml = items.map((it, idx) => {
    const order = `${orderPrefix}-${idx+1}`;
    return `
      <div class="ticket">
        <div class="ticket-header">
          <div class="brand">
            <div class="logo">Ш</div>
            <div class="brand-text">
              <div class="brand-name">Театр ім. Т. Г. Шевченка</div>
              <div class="brand-tagline">Офіційний онлайн-продаж квитків</div>
            </div>
          </div>
          <div class="ord">${order}</div>
        </div>

        <div class="title">${showTitle}</div>
        <div class="sub">${showStage}</div>

        <div class="row">
          <div class="dt">${showDT}</div>
          <div class="zone"><strong>${safe(getZoneLabel(it.zone))}</strong></div>
        </div>

        <div class="dash"></div>

        <div class="grid">
          <div><div class="lbl">Ряд</div><div class="val">${it.row}</div></div>
          <div><div class="lbl">Місце</div><div class="val">${it.seat}</div></div>
          <div><div class="lbl">Ціна</div><div class="val">${it.price} ${safe(CURRENCY)}</div></div>
          <div><div class="lbl">Канал</div><div class="val">Каса</div></div>
        </div>

        <div class="dash"></div>

        <div class="legal">
          Квиток дійсний на одну особу. Повернення та обмін квитків відбувається згідно з правилами театру.
          Зберігайте квиток до кінця вистави.
        </div>

        <div class="qr">QR / штрих-код (пізніше можна буде підставити з системи)</div>
      </div>
    `;
  }).join('');

  const html = `
  <!doctype html>
  <html lang="uk">
  <head>
    <meta charset="utf-8"/>
    <title>Друк квитків</title>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <style>
      @page { size: 80mm 200mm; margin: 5mm; }
      body{ margin:0; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; background:#fff; }
      .wrap{ padding:8px; display:flex; flex-direction:column; gap:10px; }

      .ticket{
        width: 72mm;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 10px 10px 9px;
        box-sizing:border-box;
        page-break-after: always;
      }
      .ticket:last-child{ page-break-after: auto; }

      .ticket-header{ display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
      .brand{ display:flex; gap:8px; align-items:center; }
      .logo{ width:28px; height:28px; border-radius:999px; background:#111827; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; }
      .brand-name{ font-size:11px; font-weight:700; color:#111827; line-height:1.1; }
      .brand-tagline{ font-size:9px; color:#6b7280; line-height:1.1; }
      .ord{ font-size:9px; color:#6b7280; text-align:right; }

      .title{ margin-top:8px; font-weight:800; text-transform:uppercase; font-size:12px; color:#111827; }
      .sub{ margin-top:2px; font-size:10px; color:#374151; }

      .row{ margin-top:6px; display:flex; justify-content:space-between; font-size:10px; color:#111827; }
      .dash{ margin:8px 0; border-bottom:1px dashed #d1d5db; }

      .grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; }
      .lbl{ font-size:8px; color:#6b7280; text-transform:uppercase; letter-spacing:.08em; }
      .val{ font-size:10px; font-weight:700; color:#111827; }

      .legal{ font-size:8px; color:#6b7280; line-height:1.25; }
      .qr{ margin-top:8px; height:50px; border:1px dashed #d1d5db; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:8px; color:#9ca3af; }
      @media print { .wrap{ padding:0; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${ticketsHtml}
    </div>
    <script>
      setTimeout(()=>window.print(), 350);
    </script>
  </body>
  </html>
  `;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ===== DOM helpers =====
function findSeatButtonByKey(key){
  return document.querySelector(`.seat[data-key="${CSS.escape(key)}"]`);
}

function updateBasketUI(){
  const listEl = document.getElementById('basket-list');
  const totalEl = document.getElementById('basket-total');
  const curEl = document.getElementById('basket-currency');
  const subEl = document.getElementById('basket-sub');

  if (curEl) curEl.textContent = CURRENCY;

  if (!listEl || !totalEl) return;

  if (!basket.length){
    if (subEl) subEl.textContent = 'Поки що нічого не обрано.';
    listEl.innerHTML = '';
  }else{
    if (subEl) subEl.textContent = `Обрано місць: ${basket.length}`;
    const ul = document.createElement('ul');
    ul.style.paddingLeft = '18px';
    ul.style.margin = '4px 0';

    for (const it of basket){
      const li = document.createElement('li');
      li.textContent = `${it.label} — ${it.price} ${CURRENCY}`;
      ul.appendChild(li);
    }
    listEl.innerHTML = '';
    listEl.appendChild(ul);
  }

  const total = basket.reduce((s,i)=>s+(i.price||0),0);
  totalEl.textContent = String(total);
}

function renderPriceLegend(){
  const el = document.getElementById('priceLegend');
  if(!el) return;

  // показываем только те цены, которые есть в palette (и которые реально используем)
  const prices = Object.keys(PRICE_PALETTE || {}).map(Number).sort((a,b)=>a-b);
  el.innerHTML = '';
  for (const p of prices){
    const chip = document.createElement('div');
    chip.className = 'price-chip';
    const dot = document.createElement('span');
    dot.className = 'price-dot ' + (PRICE_PALETTE[String(p)] || '');
    chip.appendChild(dot);
    const txt = document.createElement('span');
    txt.textContent = `${p}`;
    chip.appendChild(txt);
    el.appendChild(chip);
  }
}

// ===== Seat element =====
function createSeatElement(rowInfo, rowNumber, seatNumber, zone, pos){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'seat';
  btn.textContent = seatNumber;

  const price = getPriceForRow(rowInfo);
  const key = seatKey(rowNumber, seatNumber, zone);

  btn.dataset.row = String(rowNumber);
  btn.dataset.seat = String(seatNumber);
  btn.dataset.zone = zone;
  btn.dataset.price = String(price);
  btn.dataset.key = key;

  // базовый цвет по цене (только для продаваемых зон)
  if (isSellable(zone)){
    const pc = getPriceClass(price);
    if (pc) btn.classList.add(pc);
  }else{
    btn.classList.add('seat--inactive');
  }

  // проходы
  if (zone === 'parter' && rowInfo.aisle_after && pos === rowInfo.aisle_after){
    btn.classList.add('seat--gap-right');
  }
  if (zone === 'balcony' && rowInfo.aisle_after && pos === rowInfo.aisle_after){
    btn.classList.add('seat--gap-right');
  }

  // статус из карты
  const st = seatState.get(key) || (isSellable(zone) ? 'free' : 'inactive');
  applyStatusClass(btn, st);

  // click
  btn.addEventListener('click', ()=>{
    const status = seatState.get(key) || (isSellable(zone) ? 'free' : 'inactive');
    if (status === 'sold' || status === 'inactive') return;

    const idx = basket.findIndex(x=>x.key===key);
    if (idx >= 0){
      basket.splice(idx,1);
      btn.classList.remove('seat--selected');
    }else{
      const label = `${getZoneLabel(zone)}: ряд ${rowNumber}, місце ${seatNumber}`;
      basket.push({ key, row: rowNumber, seat: seatNumber, zone, price, label });
      btn.classList.add('seat--selected');
    }

    updateBasketUI();
  });

  return btn;
}

function applyStatusClass(btn, status){
  btn.classList.remove('seat--sold','seat--reserved','seat--inactive');
  if (status === 'sold') btn.classList.add('seat--sold');
  else if (status === 'reserved') btn.classList.add('seat--reserved');
  else if (status === 'inactive') btn.classList.add('seat--inactive');
}

// ===== Render zones =====
function renderParter(container, rows){
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Партер та ложі';
  section.appendChild(title);

  const wrap = document.createElement('div');
  wrap.className = 'parter-wrap';

  // Ложа Б (зліва) — как “службові/не продаються” если нет данных
  const lodgeB = document.createElement('div');
  lodgeB.className = 'hall-lodge';
  lodgeB.innerHTML = `<div class="hall-lodge-label">Ложа Б</div>`;
  const lodgeBSeats = document.createElement('div');
  lodgeBSeats.className = 'hall-lodge-seats';
  for (let i=1;i<=18;i++){
    const b = document.createElement('div');
    b.className = 'seat seat--inactive';
    b.textContent = i;
    lodgeBSeats.appendChild(b);
  }
  lodgeB.appendChild(lodgeBSeats);

  // центр
  const center = document.createElement('div');
  for (const r of rows){
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';

    const seatsCount = r.seats || 0;
    for (let i=1;i<=seatsCount;i++){
      sr.appendChild(createSeatElement(r, r.row, i, 'parter', i));
    }

    line.appendChild(sr);
    center.appendChild(line);
  }

  // Ложа А (справа)
  const lodgeA = document.createElement('div');
  lodgeA.className = 'hall-lodge';
  lodgeA.innerHTML = `<div class="hall-lodge-label">Ложа А</div>`;
  const lodgeASeats = document.createElement('div');
  lodgeASeats.className = 'hall-lodge-seats';
  for (let i=1;i<=18;i++){
    const b = document.createElement('div');
    b.className = 'seat seat--inactive';
    b.textContent = i;
    lodgeASeats.appendChild(b);
  }
  lodgeA.appendChild(lodgeASeats);

  wrap.appendChild(lodgeB);
  wrap.appendChild(center);
  wrap.appendChild(lodgeA);

  section.appendChild(wrap);
  container.appendChild(section);
}

function renderAmphi(container, rows){
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Амфітеатр';
  section.appendChild(title);

  for (const r of rows){
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';

    // если у вас есть split
    if (r.seats_left != null || r.seats_right != null){
      const left = r.seats_left || 0;
      const right = r.seats_right || 0;

      for (let i=1;i<=left;i++) sr.appendChild(createSeatElement(r, r.row, i, 'amphi', i));

      const gap = document.createElement('div');
      gap.className = 'amphi-gap';
      sr.appendChild(gap);

      for (let i=1;i<=right;i++){
        const sn = left + i;
        sr.appendChild(createSeatElement(r, r.row, sn, 'amphi', sn));
      }
    }else{
      const seatsCount = r.seats || 0;
      for (let i=1;i<=seatsCount;i++){
        sr.appendChild(createSeatElement(r, r.row, i, 'amphi', i));
      }
    }

    line.appendChild(sr);
    section.appendChild(line);
  }

  container.appendChild(section);
}

function renderBalcony(container, rows){
  const section = document.createElement('section');
  section.className = 'hall-section';

  const title = document.createElement('div');
  title.className = 'hall-section-title';
  title.textContent = 'Балкон';
  section.appendChild(title);

  for (const r of rows){
    const line = document.createElement('div');
    line.className = 'row-line';

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = String(r.row);
    line.appendChild(lab);

    const sr = document.createElement('div');
    sr.className = 'seats-row';

    if (r.seats_left != null && r.seats_right != null){
      const left = r.seats_left;
      const right = r.seats_right;

      for (let i=1;i<=left;i++) sr.appendChild(createSeatElement(r, r.row, i, 'balcony', i));

      const gap = document.createElement('div');
      gap.className = 'amphi-gap';
      sr.appendChild(gap);

      for (let i=1;i<=right;i++){
        const sn = left + i;
        sr.appendChild(createSeatElement(r, r.row, sn, 'balcony', sn));
      }
    }else{
      const seatsCount = r.seats || 0;
      for (let i=1;i<=seatsCount;i++){
        sr.appendChild(createSeatElement(r, r.row, i, 'balcony', i));
      }
    }

    line.appendChild(sr);
    section.appendChild(line);
  }

  container.appendChild(section);
}

function renderHall(schema){
  const root = document.getElementById('hall-root');
  if(!root) return;
  root.innerHTML = '';

  const rowsParter = schema.rows.filter(r=>r.zone==='parter');
  const rowsAmphi  = schema.rows.filter(r=>r.zone==='amphi');
  const rowsBalcony= schema.rows.filter(r=>r.zone==='balcony');

  renderParter(root, rowsParter);
  renderAmphi(root, rowsAmphi);
  renderBalcony(root, rowsBalcony);
}

// ===== Persist per-show =====
function loadStateForShow(){
  seatState.clear();
  basket = [];
  reserves = [];
  ops = [];

  // seat statuses
  try{
    const raw = localStorage.getItem(lsKey('seatState'));
    if(raw){
      const obj = JSON.parse(raw);
      for (const [k,v] of Object.entries(obj)){
        seatState.set(k, v);
      }
    }
  }catch(e){ console.warn(e); }

  // reserves
  try{
    const raw = localStorage.getItem(lsKey('reserves'));
    if(raw) reserves = JSON.parse(raw) || [];
  }catch(e){ console.warn(e); reserves=[]; }

  // ops
  try{
    const raw = localStorage.getItem(lsKey('ops'));
    if(raw) ops = JSON.parse(raw) || [];
  }catch(e){ console.warn(e); ops=[]; }

  updateBasketUI();
  renderRegistry();
}

function saveSeatState(){
  const obj = {};
  for (const [k,v] of seatState.entries()) obj[k]=v;
  localStorage.setItem(lsKey('seatState'), JSON.stringify(obj));
}
function saveReserves(){
  localStorage.setItem(lsKey('reserves'), JSON.stringify(reserves));
}
function saveOps(){
  localStorage.setItem(lsKey('ops'), JSON.stringify(ops));
}

// ===== Registry =====
function groupReserves(){
  const map = new Map(); // who -> items[]
  for (const r of reserves){
    const key = r.who || '—';
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function renderRegistry(){
  const root = document.getElementById('reserveRegistry');
  if(!root) return;
  root.innerHTML = '';

  if(!currentShowId){
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">Оберіть спектакль, щоб бачити броні.</div>';
    return;
  }

  if(!reserves.length){
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">Поки що броней немає.</div>';
    return;
  }

  const groups = groupReserves();
  for (const [who, items] of groups.entries()){
    // агрегируем
    const allSeats = items.flatMap(x=>x.seats);
    const total = allSeats.reduce((s,i)=>s+(i.price||0),0);

    const card = document.createElement('div');
    card.className = 'registry-card';

    const head = document.createElement('div');
    head.className = 'registry-head';
    head.innerHTML = `
      <div>
        <div class="registry-who">${who}</div>
        <div class="registry-meta">Броней: ${items.length} • Місць: ${allSeats.length} • Сума: ${total} ${CURRENCY}</div>
      </div>
      <div class="registry-meta">${fmtDT(items[0]?.createdAt || '')}</div>
    `;
    card.appendChild(head);

    const rows = document.createElement('div');
    rows.className = 'registry-rows';
    rows.textContent = allSeats.map(s=>`${getZoneLabel(s.zone)} ${s.row}-${s.seat}`).join(', ');
    card.appendChild(rows);

    const actions = document.createElement('div');
    actions.className = 'registry-actions';

    const btnSell = document.createElement('button');
    btnSell.className = 'btn btn-primary';
    btnSell.textContent = 'Продати + друк';
    btnSell.addEventListener('click', ()=>{
      // продать все места из группы и распечатать пачкой
      const show = afisha.find(x=>x.id===currentShowId);
      for (const s of allSeats){
        seatState.set(s.key, 'sold');
      }
      saveSeatState();

      // удалить эти брони
      reserves = reserves.filter(r => r.who !== who);
      saveReserves();

      ops.push({ ts: nowIso(), showId: currentShowId, action:'sell_from_reserve', who, seats: allSeats, total });
      saveOps();

      // обновить UI
      for (const s of allSeats){
        const btn = findSeatButtonByKey(s.key);
        if(btn){
          btn.classList.remove('seat--selected','seat--reserved');
          btn.classList.add('seat--sold');
        }
      }
      renderRegistry();

      openPrintBatch(allSeats, show);
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-secondary';
    btnCancel.textContent = 'Скасувати бронь';
    btnCancel.addEventListener('click', ()=>{
      for (const s of allSeats){
        seatState.set(s.key, 'free');
        const btn = findSeatButtonByKey(s.key);
        if(btn){
          btn.classList.remove('seat--reserved','seat--selected','seat--sold');
          // вернуть цвет цены (если sellable)
          if(!isSellable(s.zone)){
            btn.classList.add('seat--inactive');
          }
        }
      }
      saveSeatState();

      reserves = reserves.filter(r => r.who !== who);
      saveReserves();

      ops.push({ ts: nowIso(), showId: currentShowId, action:'cancel_reserve', who, seats: allSeats, total });
      saveOps();

      renderRegistry();
    });

    actions.appendChild(btnSell);
    actions.appendChild(btnCancel);
    card.appendChild(actions);

    root.appendChild(card);
  }
}

// ===== Actions =====
function clearBasketOnly(){
  for (const it of basket){
    const btn = findSeatButtonByKey(it.key);
    if(btn) btn.classList.remove('seat--selected');
  }
  basket = [];
  updateBasketUI();
}

function applyReserve(){
  if(!currentShowId){ alert('Спочатку оберіть спектакль.'); return; }
  if(!basket.length) return;

  const who = prompt('Хто бронює? (ПІБ / телефон / організація)', '');
  if(!who) return;

  const sellableOnly = basket.filter(x=>isSellable(x.zone));
  if(!sellableOnly.length){
    alert('У кошику немає місць, доступних до продажу/бронювання.');
    return;
  }

  for (const it of sellableOnly){
    seatState.set(it.key, 'reserved');
    const btn = findSeatButtonByKey(it.key);
    if(btn){
      btn.classList.remove('seat--selected','seat--sold');
      btn.classList.add('seat--reserved');
    }
  }
  saveSeatState();

  const total = sellableOnly.reduce((s,i)=>s+(i.price||0),0);
  reserves.push({
    id: 'R-' + Date.now(),
    showId: currentShowId,
    who,
    seats: sellableOnly.map(x=>({ ...x })),
    total,
    createdAt: nowIso()
  });
  saveReserves();

  ops.push({ ts: nowIso(), showId: currentShowId, action:'reserve', who, seats: sellableOnly, total });
  saveOps();

  basket = [];
  updateBasketUI();
  renderRegistry();
}

function applyUnreserve(){
  if(!currentShowId){ alert('Спочатку оберіть спектакль.'); return; }
  if(!basket.length) return;

  // снимаем бронь только с reserved
  const targets = basket.map(x=>x).filter(x=>seatState.get(x.key)==='reserved');
  if(!targets.length){ clearBasketOnly(); return; }

  for (const it of targets){
    seatState.set(it.key, 'free');
    const btn = findSeatButtonByKey(it.key);
    if(btn){
      btn.classList.remove('seat--selected','seat--reserved','seat--sold');
      // восстановить цвет цены (если sellable)
      if(!isSellable(it.zone)) btn.classList.add('seat--inactive');
    }
  }
  saveSeatState();

  ops.push({ ts: nowIso(), showId: currentShowId, action:'unreserve_from_map', who:'', seats: targets, total: targets.reduce((s,i)=>s+(i.price||0),0) });
  saveOps();

  basket = [];
  updateBasketUI();
  renderRegistry();
}

function applySell(){
  if(!currentShowId){ alert('Спочатку оберіть спектакль.'); return; }
  if(!basket.length) return;

  const show = afisha.find(x=>x.id===currentShowId);

  // продаём только sellable
  const items = basket.filter(x=>isSellable(x.zone));
  if(!items.length){
    alert('У кошику немає місць, доступних до продажу.');
    return;
  }

  for (const it of items){
    seatState.set(it.key, 'sold');
    const btn = findSeatButtonByKey(it.key);
    if(btn){
      btn.classList.remove('seat--selected','seat--reserved');
      btn.classList.add('seat--sold');
    }
  }
  saveSeatState();

  const total = items.reduce((s,i)=>s+(i.price||0),0);
  ops.push({ ts: nowIso(), showId: currentShowId, action:'sell', who:'', seats: items, total });
  saveOps();

  basket = [];
  updateBasketUI();

  // печать пачкой одной страницей
  openPrintBatch(items, show);
}

// ===== Export CSV =====
function csvEscape(v){
  const s = String(v ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function toCsv(rows){
  return rows.map(r=>r.map(csvEscape).join(';')).join('\n');
}

function exportReserves(){
  if(!currentShowId){ alert('Оберіть спектакль.'); return; }
  const rows = [['createdAt','who','zone','row','seat','price','currency','showId']];
  for (const r of reserves){
    for (const s of r.seats){
      rows.push([r.createdAt, r.who, getZoneLabel(s.zone), s.row, s.seat, s.price, CURRENCY, r.showId]);
    }
  }
  downloadText(`reserves_${currentShowId}.csv`, toCsv(rows));
}

function exportSales(){
  if(!currentShowId){ alert('Оберіть спектакль.'); return; }
  const rows = [['ts','action','zone','row','seat','price','currency','showId']];
  for (const o of ops.filter(x=>x.action==='sell' || x.action==='sell_from_reserve')){
    for (const s of o.seats){
      rows.push([o.ts, o.action, getZoneLabel(s.zone), s.row, s.seat, s.price, CURRENCY, o.showId]);
    }
  }
  downloadText(`sales_${currentShowId}.csv`, toCsv(rows));
}

function exportOps(){
  if(!currentShowId){ alert('Оберіть спектакль.'); return; }
  const rows = [['ts','action','who','count','total','showId','seats']];
  for (const o of ops){
    const seatsStr = (o.seats||[]).map(s=>`${s.zone}:${s.row}-${s.seat}`).join(',');
    rows.push([o.ts, o.action, o.who || '', (o.seats||[]).length, o.total || 0, o.showId, seatsStr]);
  }
  downloadText(`ops_${currentShowId}.csv`, toCsv(rows));
}

// ===== Show selector =====
function fillShowSelect(){
  const sel = document.getElementById('showSelect');
  if(!sel) return;

  sel.innerHTML = '<option value="">— обрати —</option>';

  for (const s of afisha){
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.title} — ${s.date}, ${s.time}`;
    sel.appendChild(opt);
  }

  sel.value = currentShowId || '';
  sel.addEventListener('change', ()=>{
    currentShowId = sel.value || '';
    setCurrentShowHeader();
    loadStateForShow();
    // перерисовать зал с нужными статусами
    renderHall(hallSchema);
    renderPriceLegend();
  });
}

function setCurrentShowHeader(){
  const showEl = document.getElementById('admin-current-show');
  if(!showEl) return;

  const s = afisha.find(x=>x.id===currentShowId);
  if(!s){
    showEl.textContent = 'Сеанс: (не обрано)';
    return;
  }
  showEl.textContent = `Сеанс: ${s.title} — ${s.date}, ${s.time}`;
}

// ===== Init =====
async function initAdminPage(){
  await loadSettings();
  await loadAfisha();
  const schema = await loadHallSchema();

  // header
  const nameEl = document.getElementById('admin-theatre-name');
  if(nameEl && SETTINGS.theatre?.name) nameEl.textContent = SETTINGS.theatre.name;

  const dateEl = document.getElementById('admin-current-date');
  if(dateEl) dateEl.textContent = new Date().toLocaleString('uk-UA');

  // show dropdown
  fillShowSelect();

  // start: if only 2 shows – можно авто выбрать первый (опционально)
  // currentShowId = afisha[0]?.id || '';
  // document.getElementById('showSelect').value = currentShowId;

  setCurrentShowHeader();

  // load show state
  loadStateForShow();

  // render
  renderHall(schema);
  renderPriceLegend();
  updateBasketUI();
  renderRegistry();

  // buttons
  document.getElementById('btn-sell')?.addEventListener('click', applySell);
  document.getElementById('btn-reserve')?.addEventListener('click', applyReserve);
  document.getElementById('btn-unreserve')?.addEventListener('click', applyUnreserve);
  document.getElementById('btn-clear')?.addEventListener('click', clearBasketOnly);

  document.getElementById('btn-export-reserves')?.addEventListener('click', exportReserves);
  document.getElementById('btn-export-sales')?.addEventListener('click', exportSales);
  document.getElementById('btn-export-ops')?.addEventListener('click', exportOps);
}

document.addEventListener('DOMContentLoaded', ()=>{
  initAdminPage().catch(err=>{
    console.error('Помилка ініціалізації адмінки', err);
    alert('Помилка ініціалізації адмінки. Відкрий консоль (F12) і покажи помилку.');
  });
});
