const SUPABASE_URL = "https://fhusjlkneckbvnrdhbil.supabase.co";
const SUPABASE_KEY = "sb_secret_hLujX
p6PckIjxJch1RA_jA__bupqSCf";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const tbody = document.querySelector("#invites-table tbody");
const details = document.getElementById("details");

async function loadInvites() {
  const { data, error } = await supabase
    .from("cash_ops")
    .select("*")
    .eq("payload->>type", "invite")
    .order("created_at", { ascending: false });

  if (error) {
    alert(error.message);
    return;
  }

  tbody.innerHTML = "";

  data.forEach(row => {
    const p = row.payload || {};

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleString()}</td>
      <td>${p.seance || "—"}</td>
      <td>${(p.seats || []).join(", ")}</td>
      <td>${p.comment || "—"}</td>
    `;

    tr.onclick = () => {
      details.textContent = JSON.stringify(row, null, 2);
    };

    tbody.appendChild(tr);
  });
}

loadInvites();
