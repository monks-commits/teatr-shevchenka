const SUPABASE_URL = "https://fhusjlkneckbvnrdhbil.supabase.co";
const SUPABASE_ANON_KEY = "ВСТАВЬ_ANON_PUBLIC_KEY";

const supabase = supabaseJs.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadInvites() {
  const { data, error } = await supabase
    .from("cash_ops")
    .select("created_at, payload")
    .eq("payload->>type", "invite")
    .order("created_at", { ascending: false });

  if (error) {
    alert("Помилка завантаження журналу");
    return;
  }

  const tbody = document.querySelector("#invite-table tbody");
  tbody.innerHTML = "";

  data.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleString()}</td>
      <td>${row.payload.seance_id || ""}</td>
      <td>${(row.payload.seats || []).join(", ")}</td>
      <td>${row.payload.comment || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

loadInvites();
