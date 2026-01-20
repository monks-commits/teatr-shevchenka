const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

function todayRange() {
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date();
  end.setHours(23,59,59,999);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function loadSummary() {
  const { start, end } = todayRange();

  // Продажи за сегодня
  const { data: orders } = await supabase
    .from("orders")
    .select("order_id, amount")
    .eq("status", "paid")
    .gte("created_at", start)
    .lte("created_at", end);

  const sum = (orders || []).reduce((s,o)=>s+Number(o.amount||0),0);
  document.getElementById("sum-today").textContent = sum + " ₴";
  document.getElementById("orders-today").textContent = (orders||[]).length;

  // Запрошення (0 грн)
  const invites = (orders||[]).filter(o => Number(o.amount) === 0).length;
  document.getElementById("invites-today").textContent = invites;

  // Квитки за сьогодні
  const orderIds = (orders||[]).map(o=>o.order_id);
  let ticketsCount = 0;
  if (orderIds.length) {
    const { count } = await supabase
      .from("tickets")
      .select("*", { count:"exact", head:true })
      .in("order_id", orderIds);
    ticketsCount = count || 0;
  }
  document.getElementById("tickets-today").textContent = ticketsCount;
}

loadSummary();
