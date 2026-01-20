// === НАСТРОЙКИ ===
const SUPABASE_URL = "https://ТВОЙ_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "ТВОЙ_PUBLIC_ANON_KEY";

// =================

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadJournal() {
  const { data, error } = await supabase
    .from("cash_ops")
    .select("op_id, created_at, payload")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    alert("Помилка завантаження журналу");
    console.error(error);
    return;
  }

  const tbody = document.querySelector("#ops-table tbody");
  tbody.innerHTML = "";

  data.forEach(op => {
    const payload = op.payload || {};
    const type = payload.type || "—";
    const seats = payload.seats ? payload.seats.length : 0;
    const seance = payload.seance_id || payload.show_slug || "—";
    const user = payload.user || "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(op.created_at).toLocaleString()}</td>
      <td class="type-${type}">${type}</td>
      <td>${seance}</td>
      <td>${seats}</td>
      <td>${user}</td>
    `;

    tbody.appendChild(tr);
  });
}

loadJournal();
