const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, created_at, show_slug, seance_id, seats, expires_at, status")
    .eq("status", "hold")
    .order("expires_at", { ascending: true });

  const tbody = document.querySelector("#bookings-table tbody");
  tbody.innerHTML = "";

  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="6">Активних бронювань немає</td></tr>`;
    return;
  }

  data.forEach(b => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(b.created_at).toLocaleString()}</td>
      <td>${b.seance_id || b.show_slug}</td>
      <td>${Array.isArray(b.seats) ? b.seats.join(", ") : "—"}</td>
      <td>${new Date(b.expires_at).toLocaleString()}</td>
      <td>
        <button data-act="sell">Продати</button>
        <button data-act="cancel">Скасувати</button>
      </td>
    `;

    tr.querySelector('[data-act="sell"]').onclick = () => sellBooking(b);
    tr.querySelector('[data-act="cancel"]').onclick = () => cancelBooking(b.id);

    tbody.appendChild(tr);
  });
}

async function cancelBooking(id) {
  if (!confirm("Скасувати бронювання?")) return;
  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
  loadBookings();
}

async function sellBooking(booking) {
  // 1. создаём заказ
  const orderId = "BO-" + Date.now();

  await supabase.from("orders").insert({
    order_id: orderId,
    show_slug: booking.show_slug,
    seance_id: booking.seance_id,
    amount: 0,
    status: "paid"
  });

  // 2. создаём билеты
  for (const seat of booking.seats) {
    await supabase.from("tickets").insert({
      order_id: orderId,
      show_slug: booking.show_slug,
      seance_id: booking.seance_id,
      seat_label: seat,
      price: 0
    });
  }

  // 3. закрываем бронь
  await supabase.from("bookings").update({ status: "converted" }).eq("id", booking.id);

  loadBookings();
}

loadBookings();
