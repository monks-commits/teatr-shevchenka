// === НАСТРОЙКИ ===
const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";
// ==================

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadSales() {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      order_id,
      created_at,
      show_slug,
      seance_id,
      amount,
      status
    `)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    alert("Помилка завантаження продажів");
    console.error(error);
    return;
  }

  const tbody = document.querySelector("#sales-table tbody");
  tbody.innerHTML = "";

  for (const order of data) {
    // считаем количество билетов по order_id
    const { count } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("order_id", order.order_id);

    const tr = document.createElement("tr");

    const isInvite = Number(order.amount) === 0;

    tr.innerHTML = `
      <td>${new Date(order.created_at).toLocaleString()}</td>
      <td>${order.seance_id || order.show_slug || "—"}</td>
      <td>${count || 0}</td>
      <td class="money ${isInvite ? "zero" : ""}">
        ${order.amount} ₴
      </td>
      <td>${isInvite ? "Запрошення" : "Продаж"}</td>
      <td>${order.status}</td>
    `;

    tbody.appendChild(tr);
  }
}

loadSales();
