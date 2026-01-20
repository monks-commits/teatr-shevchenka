const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";

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
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;color:#666;">
          Поки що немає продажів
        </td>
      </tr>
    `;
    return;
  }

  for (const order of data) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";

    tr.innerHTML = `
      <td>${new Date(order.created_at).toLocaleString()}</td>
      <td>${order.seance_id || order.show_slug || "—"}</td>
      <td>—</td>
      <td>${order.amount} ₴</td>
      <td>${Number(order.amount) === 0 ? "Запрошення" : "Продаж"}</td>
      <td>${order.status}</td>
    `;

    tr.addEventListener("click", () => {
      loadSaleDetails(order.order_id);
    });

    tbody.appendChild(tr);
  }
}

async function loadSaleDetails(orderId) {
  const detailsEl = document.getElementById("sale-details");
  detailsEl.innerHTML = "Завантаження…";

  const { data, error } = await supabase
    .from("tickets")
    .select(`
      seat_label,
      price,
      seance_id
    `)
    .eq("order_id", orderId);

  if (error) {
    detailsEl.innerHTML = "Помилка завантаження деталей";
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    detailsEl.innerHTML = "Немає квитків";
    return;
  }

  const seats = data.map(t => t.seat_label).join(", ");
  const total = data.reduce((s, t) => s + Number(t.price || 0), 0);

  detailsEl.innerHTML = `
    <strong>Замовлення:</strong> ${orderId}<br>
    <strong>Місця:</strong> ${seats}<br>
    <strong>Кількість:</strong> ${data.length}<br>
    <strong>Сума:</strong> ${total} ₴
  `;
}

loadSales();
