// supabase уже существует глобально

const tbody = document.querySelector("#invites-table tbody");

async function loadInvites() {
  const { data, error } = await supabase
    .from("cash_ops")
    .select("*")
    .eq("payload->>type", "invite")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
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

    tbody.appendChild(tr);
  });
}

loadInvites();
