import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

let SETTINGS = null;
let supabase = null;

const el = (id)=>document.getElementById(id);

function showErr(msg){
  const box = el('loginError');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

async function loadSettings(){
  const r = await fetch('../data/settings.json', { cache:'no-store' });
  if(!r.ok) throw new Error('Не можу прочитати /data/settings.json (HTTP '+r.status+')');
  const json = await r.json(); // упадёт если JSON битый
  SETTINGS = json;
  return json;
}

function initSupabase(){
  const url = SETTINGS?.supabase_url;
  const key = SETTINGS?.supabase_anon_key;
  if(!url || !key) throw new Error('У settings.json немає supabase_url або supabase_anon_key');
  supabase = createClient(url, key, { auth: { persistSession:true }});
}

function setLoggedUI(user){
  const loginCard = el('loginCard');
  const appCard = el('appCard');
  const userBox = el('userBox');
  const userEmail = el('userEmail');
  const theatreName = el('theatreName');

  if (SETTINGS?.theatre?.name) theatreName.textContent = SETTINGS.theatre.name + ' — Білетний відділ';

  if(user){
    if (loginCard) loginCard.hidden = true;
    if (appCard) appCard.hidden = false;
    if (userBox) userBox.hidden = false;
    if (userEmail) userEmail.textContent = user.email || '';
  }else{
    if (loginCard) loginCard.hidden = false;
    if (appCard) appCard.hidden = true;
    if (userBox) userBox.hidden = true;
    if (userEmail) userEmail.textContent = '';
  }
}

function isAllowedEmail(email){
  const allowed = SETTINGS?.backoffice?.allowed_emails;
  if(!allowed || !Array.isArray(allowed) || allowed.length===0) return true;
  return allowed.map(x=>String(x).toLowerCase()).includes(String(email||'').toLowerCase());
}

/* tabs */
let currentTab = 'orders';

function setTab(tab){
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab===tab);
  });

  el('panel-orders').hidden   = tab!=='orders';
  el('panel-tickets').hidden  = tab!=='tickets';
  el('panel-bookings').hidden = tab!=='bookings';
  el('panel-settings').hidden = tab!=='settings';

  const statusSel = el('filterStatus');
  statusSel.innerHTML = '<option value="">— всі —</option>';

  const opts = tab==='orders'
    ? ['created','paid','cancelled']
    : tab==='bookings'
      ? ['hold','cancelled','converted']
      : [];

  for (const s of opts){
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    statusSel.appendChild(o);
  }

  refresh();
}

/* helpers */
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function badge(status){
  const cls =
    status==='paid' || status==='converted' ? 'ok' :
    status==='created' || status==='hold' ? 'warn' :
    status==='cancelled' ? 'bad' : '';
  return `<span class="badge ${cls}">${escapeHtml(status||'—')}</span>`;
}
function fmtDT(ts){
  try{ return new Date(ts).toLocaleString('uk-UA'); }catch{ return String(ts||'—'); }
}
function fmtMoney(n){
  if(n==null) return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return escapeHtml(String(n));
  return x.toFixed(2);
}

/* load data */
async function refresh(){
  const show = el('filterShow').value.trim();
  const st = el('filterStatus').value.trim();

  if(currentTab==='orders')  return loadOrders(show, st);
  if(currentTab==='tickets') return loadTickets(show);
  if(currentTab==='bookings')return loadBookings(show, st);
  if(currentTab==='settings')return loadBoSettings();
}

async function loadOrders(show_slug, status){
  const root = el('panel-orders');
  root.innerHTML = `<div class="muted">Завантажую…</div>`;

  let q = supabase.from('orders')
    .select('order_id,show_slug,amount,currency,status,buyer_email,buyer_name,created_at')
    .order('created_at', { ascending:false })
    .limit(200);

  if(show_slug) q = q.eq('show_slug', show_slug);
  if(status) q = q.eq('status', status);

  const { data, error } = await q;
  if(error){ root.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`; return; }

  root.innerHTML = `
    <table class="table">
      <thead><tr>
        <th>Час</th><th>order_id</th><th>show</th><th>сума</th><th>статус</th><th>покупець</th>
      </tr></thead>
      <tbody>
        ${(data||[]).map(r=>`
          <tr>
            <td>${fmtDT(r.created_at)}</td>
            <td><code>${escapeHtml(r.order_id)}</code></td>
            <td>${escapeHtml(r.show_slug||'')}</td>
            <td>${fmtMoney(r.amount)} ${escapeHtml(r.currency||'')}</td>
            <td>${badge(r.status)}</td>
            <td>${escapeHtml(r.buyer_email||'—')}</td>
          </tr>
        `).join('') || `<tr><td colspan="6" class="muted">Нічого не знайдено.</td></tr>`}
      </tbody>
    </table>
  `;
}

async function loadTickets(show_slug){
  const root = el('panel-tickets');
  root.innerHTML = `<div class="muted">Завантажую…</div>`;

  let q = supabase.from('tickets')
    .select('order_id,show_slug,seat_label,price,buyer_email,pdf_url,email_status,emailed_at,checked_in_at,checked_in_by,created_at')
    .order('created_at', { ascending:false })
    .limit(300);

  if(show_slug) q = q.eq('show_slug', show_slug);

  const { data, error } = await q;
  if(error){ root.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`; return; }

  root.innerHTML = `
    <table class="table">
      <thead><tr>
        <th>Час</th><th>show</th><th>місце</th><th>ціна</th><th>order</th><th>pdf</th><th>email</th><th>check-in</th>
      </tr></thead>
      <tbody>
        ${(data||[]).map(t=>`
          <tr>
            <td>${fmtDT(t.created_at)}</td>
            <td>${escapeHtml(t.show_slug||'')}</td>
            <td><code>${escapeHtml(t.seat_label||'')}</code></td>
            <td>${fmtMoney(t.price)} грн</td>
            <td><code>${escapeHtml(t.order_id||'')}</code></td>
            <td>${t.pdf_url ? `<a href="${t.pdf_url}" target="_blank" rel="noopener">PDF</a>` : '—'}</td>
            <td>${escapeHtml(t.email_status||'—')}<br><span class="muted">${t.emailed_at?fmtDT(t.emailed_at):''}</span></td>
            <td>${t.checked_in_at ? `<span class="badge ok">OK</span> ${fmtDT(t.checked_in_at)}<br><span class="muted">${escapeHtml(t.checked_in_by||'')}</span>` : `<span class="badge">—</span>`}</td>
          </tr>
        `).join('') || `<tr><td colspan="8" class="muted">Нічого не знайдено.</td></tr>`}
      </tbody>
    </table>
  `;
}

async function loadBookings(show_slug, status){
  const root = el('panel-bookings');
  root.innerHTML = `<div class="muted">Завантажую…</div>`;

  let q = supabase.from('bookings')
    .select('id,order_id,show_slug,amount,status,buyer_email,expires_at,created_at,seats')
    .order('created_at', { ascending:false })
    .limit(200);

  if(show_slug) q = q.eq('show_slug', show_slug);
  if(status) q = q.eq('status', status);

  const { data, error } = await q;
  if(error){ root.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`; return; }

  root.innerHTML = `
    <table class="table">
      <thead><tr>
        <th>Час</th><th>show</th><th>сума</th><th>статус</th><th>expire</th><th>місця</th>
      </tr></thead>
      <tbody>
        ${(data||[]).map(b=>`
          <tr>
            <td>${fmtDT(b.created_at)}</td>
            <td>${escapeHtml(b.show_slug||'')}</td>
            <td>${fmtMoney(b.amount)} грн</td>
            <td>${badge(b.status)}</td>
            <td>${fmtDT(b.expires_at)}</td>
            <td class="muted">${escapeHtml(JSON.stringify(b.seats||[]))}</td>
          </tr>
        `).join('') || `<tr><td colspan="6" class="muted">Нічого не знайдено.</td></tr>`}
      </tbody>
    </table>
  `;
}

async function loadBoSettings(){
  const root = el('panel-settings');
  root.innerHTML = `<div class="muted">Завантажую…</div>`;

  const { data, error } = await supabase.from('settings')
    .select('id,online_sales_enabled,updated_at')
    .limit(1)
    .maybeSingle();

  if(error){ root.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`; return; }
  if(!data){ root.innerHTML = `<div class="err">У таблиці settings немає рядка (зроби INSERT).</div>`; return; }

  root.innerHTML = `
    <div class="muted">Перемикач, який не ламає схему, а керує продажами централізовано.</div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <label style="display:flex;gap:10px;align-items:center;">
        <input id="toggleOnline" type="checkbox" ${data.online_sales_enabled ? 'checked' : ''} />
        <strong>online_sales_enabled</strong>
      </label>
      <span class="muted">updated: ${fmtDT(data.updated_at)}</span>
      <button class="btn btn-primary" id="btnSaveSettings">Зберегти</button>
      <div class="muted" id="settingsMsg"></div>
    </div>
  `;

  el('btnSaveSettings').addEventListener('click', async ()=>{
    const v = el('toggleOnline').checked;
    el('settingsMsg').textContent = 'Зберігаю…';
    const { error: e2 } = await supabase
      .from('settings')
      .update({ online_sales_enabled: v, updated_at: new Date().toISOString() })
      .eq('id', data.id);
    el('settingsMsg').textContent = e2 ? ('Помилка: ' + e2.message) : 'OK';
  });
}

/* auth */
async function login(){
  showErr('');
  const email = el('email').value.trim();
  const password = el('password').value;

  if(!email || !password){ showErr('Введи email та пароль.'); return; }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error){ showErr(error.message); return; }

  const user = data?.user;
  if(user && !isAllowedEmail(user.email)){
    await supabase.auth.signOut();
    showErr('Цей email не має доступу (перевір settings.json → backoffice.allowed_emails).');
    return;
  }

  setLoggedUI(user);
  setTab('orders');
}

async function logout(){
  await supabase.auth.signOut();
  setLoggedUI(null);
}

/* init */
async function init(){
  await loadSettings();
  initSupabase();

  // tabs
  document.querySelectorAll('.tab').forEach(b=> b.addEventListener('click', ()=>setTab(b.dataset.tab)));

  el('btnRefresh')?.addEventListener('click', refresh);
  el('btnLogin')?.addEventListener('click', login);
  el('btnLogout')?.addEventListener('click', logout);

  const { data: s } = await supabase.auth.getSession();
  const user = s?.session?.user || null;

  if(user && !isAllowedEmail(user.email)){
    await supabase.auth.signOut();
    setLoggedUI(null);
    showErr('Цей email не має доступу.');
    return;
  }

  setLoggedUI(user);
  if(user) setTab('orders');
}

init().catch(err=>{
  console.error(err);
  showErr(err.message || String(err));
});
