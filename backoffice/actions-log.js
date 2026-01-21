const SUPABASE_URL = "https://fhusjlkneckbvnrdhbil.supabase.co";
const SUPABASE_ANON_KEY = "ВСТАВЬ_ANON_PUBLIC_KEY";

const supabase = supabaseJs.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadLog() {
  const { data, error } = await supabase
    .from("cash_ops")
    .select("created_at, payload")
    .order("created_at", { ascending: false });

  if (error) {
    alert("Помилка завантаження журналу");
    return;
  }

  const tbody = document.querySelector("#log-table tbody");
  tbody.innerHTML = "";

  data.forEach(row => {
    const p = row.payload || {};
    const type = p.type || "unknown";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleString()}</td>
      <td><span class="tag ${type}">${type}</span></td>
      <td>${p.seance_id || ""}</td>
      <td>${(p.seats || []).join(", ")}</td>
      <td>${p.comment || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

loadLog();
