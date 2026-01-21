const tbody = document.getElementById("booking-body");

function readLocalBookings() {
  const keys = ["cash_booking_log", "booking_log", "reservations_log"];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
  }
  return [];
}

function renderBookings() {
  const rows = readLocalBookings();
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="6" class="muted">
        Поки що немає бронювань (localStorage)
      </td>`;
    tbody.appendChild(tr);
    return;
  }

  rows
    .slice()
    .reverse()
    .forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.date || ""}</td>
        <td>${r.seance || ""}</td>
        <td>${(r.seats || []).join(", ")}</td>
        <td class="right">${(r.seats || []).length}</td>
        <td>${r.client || r.comment || ""}</td>
        <td>${r.status || "бронь"}</td>
      `;
      tbody.appendChild(tr);
    });
}

renderBookings();
