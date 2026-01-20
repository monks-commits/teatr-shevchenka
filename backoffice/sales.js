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

  if (!data || data.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="6" style="text-align:center;color:#666;">
        Поки що немає продажів
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  for (const order of data) {
    const isInvite = Number(order.amount) === 0;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(order.created_at).toLocaleString()}</td>
      <td>${order.seance_id || order.show_slug || "—"}</td>
      <td>—</td>
      <td>${order.amount} ₴</td>
      <td>${isInvite ? "Запрошення" : "Продаж"}</td>
      <td>${order.status}</td>
    `;

    tbody.appendChild(tr);
  }
}

loadSales();
