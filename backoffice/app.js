import { loadSupabaseFromSettings } from "./supabaseClient.js";
import { renderOrders, renderDetails } from "./ui.js";
import { downloadText, toCsv } from "./utils.js";

let supabase = null;
let orders = [];
let activeOrder = null;
let activeTickets = [];

const $ = (id)=>document.getElementById(id);

async function ensure(){
  if(!supabase) supabase = await loadSupabaseFromSettings();
  return supabase;
}

async function setUIAuthed(user){
  $("loginCard").style.display = user ? "none" : "block";
  $("appCard").style.display = user ? "block" : "none";
  $("btnLogout").style.display = user ? "inline-block" : "none";
  $("whoami").textContent = user ? `👤 ${user.email}` : "";
}

async function login(){
  $("loginMsg").textContent = "…";
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value.trim();
  try{
    const sb = await ensure();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error;
    $("loginMsg").textContent = "OK";
    await setUIAuthed(data.user);
  }catch(e){
    console.error(e);
    $("loginMsg").textContent = "Помилка: " + (e?.message || e);
  }
}

async function logout(){
  const sb = await ensure();
  await sb.auth.signOut();
  orders = [];
  activeOrder = null;
  activeTickets = [];
  $("ordersList").innerHTML = "";
  $("details").innerHTML = `<div class="muted">Оберіть замовлення зі списку.</div>`;
  $("statusLine").textContent = "";
}

function normQ(q){ return (q||"").trim(); }

async function search(){
  const q = normQ($("q").value);
  if(!q){ $("statusLine").textContent = "Введіть запит."; return; }

  $("statusLine").textContent = "Шукаю…";
  orders = [];
  activeOrder = null;
  activeTickets = [];
  renderOrders($("ordersList"), [], "", ()=>{});
  renderDetails($("details"), null, []);

  const sb = await ensure();

  // ✅ ВАЖНО: ниже я использую предположительные поля.
  // ТЫ ОЧЕНЬ БЫСТРО УВИДИШЬ в консоли, если названия отличаются, и мы поправим.
  try{
    // 1) Поиск заказов
    // Ищем по order_id, email, phone (или как у тебя называются)
    const { data: ord, error: e1 } = await sb
      .from("orders")
      .select("*")
      .or(`order_id.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("created_at", { ascending:false })
      .limit(50);

    if(e1) throw e1;

    // 2) Если не нашли — пробуем искать по tickets (id/qr_payload) и подтянуть order
    if(!ord || ord.length === 0){
      const { data: tks, error: e2 } = await sb
        .from("tickets")
        .select("id,order_id,qr_payload")
        .or(`id.ilike.%${q}%,qr_payload.ilike.%${q}%`)
        .limit(20);
      if(e2) throw e2;

      const orderIds = [...new Set((tks||[]).map(x=>x.order_id).filter(Boolean))];
      if(orderIds.length){
        const { data: ord2, error: e3 } = await sb
          .from("orders")
          .select("*")
          .in("order_id", orderIds)
          .order("created_at", { ascending:false });
        if(e3) throw e3;
        orders = ord2 || [];
      }else{
        orders = [];
      }
    }else{
      orders = ord;
    }

    $("statusLine").textContent = `Знайдено: ${orders.length}`;
    renderOrders($("ordersList"), orders, activeOrder?.id, pickOrder);
  }catch(e){
    console.error(e);
    $("statusLine").textContent = "Помилка пошуку: " + (e?.message || e);
  }
}

async function pickOrder(order){
  activeOrder = order;
  $("statusLine").textContent = `Обрано: ${order.order_id || order.id}`;

  const sb = await ensure();
  try{
    const oid = order.order_id || order.id;

    // Пытаемся по order_id
    let { data: tks, error } = await sb
      .from("tickets")
      .select("*")
      .eq("order_id", oid)
      .order("created_at", { ascending:true });

    // Если вдруг у тебя order_id в tickets хранится иначе (например order_uuid)
    // — это сразу увидишь и мы поправим.
    if(error) throw error;

    activeTickets = tks || [];
    renderOrders($("ordersList"), orders, activeOrder?.id, pickOrder);
    renderDetails($("details"), activeOrder, activeTickets);
  }catch(e){
    console.error(e);
    $("statusLine").textContent = "Помилка завантаження квитків: " + (e?.message || e);
  }
}

function clearAll(){
  $("q").value = "";
  $("statusLine").textContent = "";
  orders = [];
  activeOrder = null;
  activeTickets = [];
  $("ordersList").innerHTML = "";
  $("details").innerHTML = `<div class="muted">Оберіть замовлення зі списку.</div>`;
}

function exportVisibleCsv(){
  if(!orders.length){
    alert("Немає даних для експорту.");
    return;
  }
  // Экспорт заказов (видимых)
  const cols = ["order_id","status","channel","amount","currency","email","phone","created_at"];
  const rows = [cols];
  for(const o of orders){
    rows.push(cols.map(c=>o?.[c] ?? ""));
  }
  downloadText(`orders_export_${Date.now()}.csv`, toCsv(rows));
}

async function boot(){
  const sb = await ensure();

  // init session
  const { data } = await sb.auth.getSession();
  await setUIAuthed(data?.session?.user || null);

  sb.auth.onAuthStateChange((_evt, session)=>{
    setUIAuthed(session?.user || null);
  });

  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);
  $("btnSearch").addEventListener("click", search);
  $("btnClear").addEventListener("click", clearAll);
  $("btnExportCsv").addEventListener("click", exportVisibleCsv);

  $("q").addEventListener("keydown", (e)=>{
    if(e.key === "Enter") search();
  });
}

boot().catch(e=>{
  console.error(e);
  alert("Backoffice init error: " + (e?.message || e));
});
