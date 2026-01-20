const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("created_at, show_slug, seance_id, seats, expires_at, status")
    .eq("status", "hold")
    .order("expires_at", { ascending: true })
    .limit(100);

  if (error) {
    alert("Помилка завантаження бронювань");
    console.error(error);
    return;
  }

  const tbody = document.querySelector("#bookings-table tbody");
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;color:#666;">
          Активних бронювань немає
        </td>
      </tr>
    `;
    return;
  }

  const now = Date.now();

  data.forEach(b => {
    const exp = new Date(b.expires_at).getTime();
    const mins = Math.round((exp - now) / 60000);
    let statusText = "Активна";
    let cls = "";

    if (mins <= 10) { statusText = "Скоро згорить"; cls = "soon"; }
    if (mins <= 0)  { statusText = "Прострочена"; cls = "expired"; }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(b.created_at).toLocaleString()}</td>
      <td>${b.seance_id || b.show_slug || "—"}</td>
      <td>${Array.isArray(b.seats) ? b.seats.join(", ") : "—"}</td>
      <td>${new Date(b.expires_at).toLocaleString()}</td>
      <td class="${cls}">${statusText}</td>
    `;
    tbody.appendChild(tr);
  });
}

loadBookings();
